import { memoryBaselines, globalSettings, lastActiveTabId, setLastActiveTabId, groupCache, peekWindows, blurredSourceTabs, evictionGraveyard, recreationRegistry, groupClosureTracker, windowBatchTracker, closingWindowIds, ntpTabCache, sessionVault, vaultCanonicalUrls, setSessionVault, tabSets, updateSettings, pomoTimer, setPomoTimer, launchingWindowIds, pendingLaunches, decrementPendingLaunches, discardedTabs, recentlyAwakened, pendingFocusGuardWindowIds, savedPrompts, setSavedPrompts } from './state.js';
import { NONE_GROUP, NTP_URL, SEARCH_ENGINES } from './constants.js';
import { getCanonicalUrl, safeDiscard, getBaseDomain, clearPendingDiscard } from './utils.js';
import { ensureLoaded, initializeState, processTab, applyAutoGrouping, applyAutoCollapse, syncBaselinesToStorage, syncVaultToStorage, syncSetsToStorage, syncPromptsToStorage, restoreVault, safeHibernate, updateCleanupAlarms, evictUnprotectedBaselines, registerProtectedBaselines, persistProtectedSnapshot, pruneProtectedHost } from './services/tabService.js';
import { stopPomoTimer, broadcastPomoState } from './services/pomoService.js';
import { handleSearchItems, executeAction } from './services/paletteService.js';
import { cleanupPeekWindow, handleOpenPeek, handlePromotePeek, handleCheckPeekStatus } from './services/peekService.js';
import { performSaveSet, performLaunchSet, performSummonSet, performDeleteSet, performReplaceSet } from './services/setService.js';

// Marks a tab as having just inherited a group so the onUpdated inheritance
// guard can suppress Chrome re-assigning it. Auto-expires after 3s.
function markInherited(tabId) {
    evictionGraveyard.set(`inheritance_${tabId}`, true);
    setTimeout(() => evictionGraveyard.delete(`inheritance_${tabId}`), 3000);
}
// permissionService.js exports only FEATURE_PERMISSIONS now; popup.js imports
// it directly for the request-on-toggle-on flow. No background-side revocation.

// --- INITIALIZATION ---
chrome.runtime.onStartup.addListener(async () => {
    await initializeState(true);
    updateCleanupAlarms();
});
chrome.runtime.onInstalled.addListener(async (details) => {
    await initializeState(false);
    updateCleanupAlarms();
    // The permission-refactor migration (preserving previously-working features
    // for updating users) lives inside ensureLoaded()'s critical section in
    // tabService.js, so it runs before any concurrent message handler can read
    // a stale globalSettings. See ensureLoaded() for why.
});

// --- WINDOW LISTENERS ---
// Intercepts new window creation BEFORE any tab events fire.
// If a Set launch is in flight (pendingLaunches > 0), we claim this window
// and stamp it into launchingWindowIds so the auto-grouping engine is
// completely suppressed for all tabs in it.
chrome.windows.onCreated.addListener((win) => {
    if (pendingLaunches > 0) {
        decrementPendingLaunches();
        launchingWindowIds.add(win.id);
    }
});

chrome.windows.onRemoved.addListener((windowId) => {
    cleanupPeekWindow(windowId);
    windowBatchTracker.delete(windowId);
    closingWindowIds.delete(windowId);
    launchingWindowIds.delete(windowId);
    ntpTabCache.delete(windowId);
    pendingFocusGuardWindowIds.delete(windowId);
    chrome.windows.getAll({ windowTypes: ['normal'] }).then(remaining => {
        if (remaining.length === 0) { syncBaselinesToStorage(true); }
    }).catch(() => {});
});

// --- TAB LISTENERS (CONSOLIDATED) ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await ensureLoaded();
    setLastActiveTabId(activeInfo.tabId);

    // Neighbor Guard for Focus NTP: If Focus Guard is redirecting to the NTP,
    // Chrome briefly activates the neighbor tab first. If that neighbor was hibernated,
    // it will wake up. We intercept this native activation and instantly put it back to sleep.
    if (pendingFocusGuardWindowIds.has(activeInfo.windowId)) {
        const cachedNtpId = ntpTabCache.get(activeInfo.windowId);
        if (activeInfo.tabId !== cachedNtpId) {
            const isDiscarded = discardedTabs.has(activeInfo.tabId);
            const awakenedTime = recentlyAwakened.get(activeInfo.tabId);
            const recentlyAwoke = awakenedTime && (Date.now() - awakenedTime < 1000);
            
            if (isDiscarded || recentlyAwoke) {
                chrome.tabs.discard(activeInfo.tabId).catch(() => {});
            }
        } else {
            // Focus Guard reached its destination (NTP). Clear the flag.
            pendingFocusGuardWindowIds.delete(activeInfo.windowId);
        }
    }

    // Auto-Collapse sibling guard: when a tab in a group is closed, Chrome
    // auto-focuses a sibling. If that sibling is in a group currently being
    // closed (groupClosureTracker is alive), redirect focus to NTP and
    // re-discard the sibling so collapse can proceed cleanly.
    if (globalSettings.autoCollapseGroups && chrome.tabGroups) {
        chrome.tabs.get(activeInfo.tabId, async (tab) => {
            if (chrome.runtime.lastError || !tab || tab.groupId === NONE_GROUP) return;
            if (!groupClosureTracker.has(tab.groupId)) return;
            // Move focus away so the sibling can be discarded
            try {
                const cachedNtpId = globalSettings.useDefaultNtp ? null : ntpTabCache.get(tab.windowId);
                if (cachedNtpId) {
                    await chrome.tabs.update(cachedNtpId, { active: true });
                } else {
                    const existing = await chrome.tabs.query({ url: NTP_URL, windowId: tab.windowId });
                    if (existing && existing.length > 0) {
                        ntpTabCache.set(tab.windowId, existing[0].id);
                        await chrome.tabs.update(existing[0].id, { active: true });
                    } else {
                        const createOpts = globalSettings.useDefaultNtp
                            ? { active: true, windowId: tab.windowId, index: 9999 }
                            : { url: NTP_URL, active: true, windowId: tab.windowId, index: 9999 };
                        const c = await chrome.tabs.create(createOpts);
                        if (!globalSettings.useDefaultNtp) ntpTabCache.set(tab.windowId, c.id);
                        if (c.groupId !== NONE_GROUP) chrome.tabs.ungroup(c.id).catch(() => {});
                    }
                }
            } catch (e) {}
            safeDiscard(tab.id);
        });
    }

    // Peek blur cleanup: if the activated tab was a peek source and no peek
    // window is still open for it, ensure the blur overlay is removed. This
    // recovers from lost remove-parent-blur messages (e.g. the peek window was
    // closed while the source tab was discarded or its content script busy).
    if (blurredSourceTabs.has(activeInfo.tabId)) {
        let stillPeeking = false;
        for (const [, data] of peekWindows.entries()) {
            if (data.sourceTabId === activeInfo.tabId) { stillPeeking = true; break; }
        }
        if (!stillPeeking) {
            chrome.tabs.sendMessage(activeInfo.tabId, { action: 'remove-parent-blur' }).catch(() => {});
            blurredSourceTabs.delete(activeInfo.tabId);
        }
    }
});

const pendingInheritanceCheck = new Set();

// Track palette fallback tabs that are about to close programmatically.
// Prevents Focus Guard from spawning a new NTP when the fallback closes.
const paletteFallbackClosingIds = new Set();

chrome.tabs.onCreated.addListener(async (tab) => {
    await ensureLoaded();
    if (!tab.openerTabId) return;

    try {
        const opener = await chrome.tabs.get(tab.openerTabId);
        const openerInGroup = opener && opener.groupId !== NONE_GROUP;
        const openerProtected = openerInGroup || (globalSettings.protectPinned && opener.pinned);

        if (openerProtected) {
            // Force standalone if it already inherited a group
            if (tab.groupId !== NONE_GROUP) {
                await chrome.tabs.ungroup(tab.id).catch(() => {});
            }
            // Set guard so onUpdated catches Chrome assigning the group later
            markInherited(tab.id);
        }

        if (tab.groupId !== NONE_GROUP) {
            // Cross-domain check for non-protected openers or when auto-grouping is on
            const pendingUrl = tab.pendingUrl || tab.url;
            if (pendingUrl && !pendingUrl.startsWith('chrome')) {
                if (!openerProtected) {
                    try {
                        if (opener && opener.url && !opener.url.startsWith('chrome')) {
                            const newHost = getBaseDomain(new URL(pendingUrl).hostname);
                            const openerHost = getBaseDomain(new URL(opener.url).hostname);
                            if (newHost !== openerHost) {
                                await chrome.tabs.ungroup(tab.id).catch(() => {});
                                markInherited(tab.id);
                            }
                        }
                    } catch (e) {}
                }
            } else if (!pendingUrl) {
                pendingInheritanceCheck.add(tab.id);
            }
        }
    } catch (e) {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ensureLoaded();

    // Redirect Chrome's native NTP to Tabs++ NTP when user wants it.
    // Restored tabs (Ctrl+Shift+T) skip chrome://newtab entirely — they
    // resolve straight to the restored URL, so they're never caught here.
    if (changeInfo.url && changeInfo.url.startsWith('chrome://newtab') && !globalSettings.useDefaultNtp) {
        try {
            const existing = await chrome.tabs.query({ url: NTP_URL, windowId: tab.windowId });
            const reusable = existing.filter(t => !(t.url || '').includes('?action=palette'));
            if (reusable.length > 0) {
                await chrome.tabs.update(reusable[0].id, { active: true });
                chrome.tabs.remove(tabId).catch(() => {});
            } else {
                await chrome.tabs.create({ url: NTP_URL + '?focused=true', windowId: tab.windowId, active: true });
                chrome.tabs.remove(tabId).catch(() => {});
            }
            return;
        } catch (e) {}
    }
    
    if (pendingInheritanceCheck.has(tabId) && changeInfo.url) {
        pendingInheritanceCheck.delete(tabId);
        if (!changeInfo.url.startsWith('chrome') && tab.groupId !== NONE_GROUP && tab.openerTabId) {
            if (!globalSettings.enableAutoGroup && !tab.pinned) {
                await chrome.tabs.ungroup(tabId).catch(() => {});
                tab.groupId = NONE_GROUP;
                markInherited(tabId);
            } else {
                try {
                    const opener = await chrome.tabs.get(tab.openerTabId);
                    if (opener && opener.url && !opener.url.startsWith('chrome')) {
                        const newHost = getBaseDomain(new URL(changeInfo.url).hostname);
                        const openerHost = getBaseDomain(new URL(opener.url).hostname);
                        if (newHost !== openerHost) {
                            await chrome.tabs.ungroup(tabId).catch(() => {});
                            tab.groupId = NONE_GROUP;
                            markInherited(tabId);
                        }
                    }
                } catch (e) {}
            }
        }
    }

    if (changeInfo.discarded !== undefined) {
        if (changeInfo.discarded) {
            discardedTabs.add(tabId);
            recentlyAwakened.delete(tabId);
        } else {
            discardedTabs.delete(tabId);
            recentlyAwakened.set(tabId, Date.now());
        }
    }

    // Inheritance Suppression: catch Chrome natively re-assigning a group after we ungrouped
    // Must run BEFORE processTab so the tab isn't registered as protected before we ungroup it
    if (changeInfo.groupId !== undefined && tab.groupId !== NONE_GROUP && evictionGraveyard.has(`inheritance_${tabId}`)) {
        chrome.tabs.ungroup(tabId).catch(() => {});
        tab.groupId = NONE_GROUP;
    }
    if (changeInfo.status === 'complete' || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined || changeInfo.discarded !== undefined) {
        if (processTab(tab)) syncBaselinesToStorage();
    }
    if (changeInfo.status === 'complete' && tab.url?.startsWith(NTP_URL) && !tab.url.includes('?action=palette')) {
        chrome.tabs.query({ windowId: tab.windowId }, (allTabs) => {
            const ntps = allTabs.filter(t =>
                t.id !== tabId && (t.url || '').startsWith(NTP_URL) && !(t.url || '').includes('?action=palette')
            );
            if (ntps.length > 0) {
                chrome.tabs.update(ntps[0].id, { active: true }).catch(() => {});
                chrome.tabs.remove(tabId).catch(() => {});
            }
        });
    }
    if (globalSettings.enableAutoGroup && changeInfo.url && !tab.pinned) {
        // Skip auto-grouping entirely for windows currently being populated by a Set Launch.
        // This is the core of the Window Launch Lock — deterministic suppression before
        // any tab URL events can race against performLaunchSet's grouping pass.
        // Grouped tabs also pass through: applyAutoGrouping decides whether to relocate
        // them to a different-category Smart Group or leave them in place (BUG-007).
        if (!launchingWindowIds.has(tab.windowId) && !evictionGraveyard.has(`inheritance_${tabId}`)) applyAutoGrouping(tab);
    }
    if (changeInfo.discarded === true && tab.groupId !== NONE_GROUP) {
        applyAutoCollapse(tab.groupId, tab.windowId);
    }
});

// Tab ID replacement on hibernation restore
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    await ensureLoaded();
    const data = memoryBaselines.get(removedTabId);
    if (data) {
        memoryBaselines.delete(removedTabId);
        memoryBaselines.set(addedTabId, data);
        syncBaselinesToStorage();
    }
});

// --- TAB GROUP LISTENERS — keep groupCache live ---
// Without these, auto-created groups have no title/color in cache,
// causing restored tabs to be placed in a new unnamed group instead
// of re-joining the original auto-group.
if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener((group) => {
        groupCache.set(group.id, { title: group.title || '', color: group.color || 'grey' });
    });

    chrome.tabGroups.onUpdated.addListener((group) => {
        groupCache.set(group.id, { title: group.title || '', color: group.color || 'grey' });
        // Back-fill baselines for all tabs in this group so stored
        // groupTitle/groupColor stays accurate
        chrome.tabs.query({ groupId: group.id }, (tabs) => {
            let changed = false;
            for (const tab of tabs) {
                const data = memoryBaselines.get(tab.id);
                if (data && (data.groupTitle !== group.title || data.groupColor !== group.color)) {
                    memoryBaselines.set(tab.id, { ...data, groupTitle: group.title || '', groupColor: group.color || 'grey' });
                    changed = true;
                }
            }
            if (changed) syncBaselinesToStorage();
        });
    });

    chrome.tabGroups.onRemoved.addListener((group) => {
        groupCache.delete(group.id);
    });
}

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const now = Date.now();
    let batchTracker = windowBatchTracker.get(removeInfo.windowId);
    if (!batchTracker || now - batchTracker.timestamp > 400) {
        batchTracker = { count: 0, timestamp: now };
        windowBatchTracker.set(removeInfo.windowId, batchTracker);
    }
    batchTracker.count++;

    // Focus Guard — skip Peek windows AND protected tabs (they will be restored,
    // so creating an NTP would leave an unwanted extra tab open).
    // Also skip when a palette fallback tab closes programmatically after executing
    // an action — the user expects to land on the action result, not another NTP.
    // NOTE: isProtectedTab must be checked synchronously (no await) — the
    // pendingFocusGuardWindowIds.add() below must execute before Chrome fires
    // onActivated, which the Neighbor Guard depends on. On cold SW start,
    // memoryBaselines is empty so this returns false — acceptable because
    // focusNTPOnClose also defaults to false until settings load.
    const isProtectedTab = memoryBaselines.has(tabId);
    const isPaletteClosing = paletteFallbackClosingIds.has(tabId);
    if (isPaletteClosing) paletteFallbackClosingIds.delete(tabId);
    if (!isPaletteClosing && !isProtectedTab && globalSettings.focusNTPOnClose && tabId === lastActiveTabId && !removeInfo.isWindowClosing) {
        pendingFocusGuardWindowIds.add(removeInfo.windowId);
        if (!peekWindows.has(removeInfo.windowId)) {
            const cachedNtpId = globalSettings.useDefaultNtp ? null : ntpTabCache.get(removeInfo.windowId);
            if (cachedNtpId) {
                chrome.tabs.update(cachedNtpId, { active: true }).catch(() => ntpTabCache.delete(removeInfo.windowId));
            } else {
                // Cache miss: query for any existing NTP tab in this window before
                // creating a new one, to avoid spawning duplicate NTP tabs when the
                // cache is stale (e.g. user manually closed the cached NTP tab).
                chrome.tabs.query({ url: NTP_URL, windowId: removeInfo.windowId }, (existing) => {
                    if (existing && existing.length > 0) {
                        ntpTabCache.set(removeInfo.windowId, existing[0].id);
                        chrome.tabs.update(existing[0].id, { active: true }).catch(() => {});
                    } else {
                        const createOpts = globalSettings.useDefaultNtp
                            ? { active: true, windowId: removeInfo.windowId, index: 9999 }
                            : { url: NTP_URL, active: true, windowId: removeInfo.windowId, index: 9999 };
                        chrome.tabs.create(createOpts)
                            .then(c => {
                                if (!globalSettings.useDefaultNtp) ntpTabCache.set(removeInfo.windowId, c.id);
                                if (c.groupId !== NONE_GROUP && chrome.tabGroups) chrome.tabs.ungroup(c.id).catch(() => {});
                            })
                            .catch(() => {});
                    }
                });
            }
        }
    }

    // NTP cache cleanup
    for (const [winId, ntpId] of ntpTabCache.entries()) {
        if (ntpId === tabId) { ntpTabCache.delete(winId); break; }
    }

    discardedTabs.delete(tabId);
    recentlyAwakened.delete(tabId);
    clearPendingDiscard(tabId);
    pendingInheritanceCheck.delete(tabId);
    blurredSourceTabs.delete(tabId);

    await ensureLoaded();

    // Baseline lookup.
    const data = memoryBaselines.get(tabId);
    evictionGraveyard.delete(`inheritance_${tabId}`); // eager cleanup (3s auto-delete timer is backup)

    // Prune durable crash-recovery snapshot (protectedSnapshot) on a DELIBERATE
    // close of a pinned/grouped tab. A force-kill (real crash) does NOT fire
    // onRemoved, so those hosts survive in storage and the popup Restore button
    // still recovers them. Any normal close — deleting a pinned tab, a grouped
    // tab, or a whole group — is deliberate and must not be resurrected.
    // Uses pruneProtectedHost (batch-safe: coalesces Close-Group bursts).
    if (data && (data.pinned || data.groupId !== NONE_GROUP)) {
        try {
            const host = new URL(data.url).hostname;
            pruneProtectedHost(host);
        } catch { /* ignore malformed urls */ }
    }

    // Group closure detection — count baselines EXCLUDING the closing tab itself,
    // so that closing the ONLY tab in a group (baselineCount=0 after exclusion)
    // does NOT look like a "full group close" and instead falls through to restore.
    if (data && data.url && data.groupId !== NONE_GROUP) {
        let tracker = groupClosureTracker.get(data.groupId);
        if (!tracker) {
            let baselineCount = 0;
            for (const [bid, b] of memoryBaselines.entries()) {
                if (b.groupId === data.groupId) baselineCount++;
            }
            tracker = { closedIds: new Set(), baselineCount };
            groupClosureTracker.set(data.groupId, tracker);
            setTimeout(() => groupClosureTracker.delete(data.groupId), 250);
        }
        tracker.closedIds.add(tabId);
    }

    // Window closing: bulk-save entire window's baselines to vault
    if (removeInfo.isWindowClosing) {
        if (!closingWindowIds.has(removeInfo.windowId)) {
            closingWindowIds.add(removeInfo.windowId);
            const windowBaselines = Array.from(memoryBaselines.entries()).filter(([id, d]) => d.windowId === removeInfo.windowId && d.url);
            for (const [bid, d] of windowBaselines) {
                const canonicalUrl = getCanonicalUrl(d.url);
                if (!vaultCanonicalUrls.has(canonicalUrl)) {
                    d.savedAt = Date.now();
                    sessionVault.push(d);
                    vaultCanonicalUrls.add(canonicalUrl);
                }
                memoryBaselines.delete(bid);
            }
            if (windowBaselines.length > 0) syncVaultToStorage();
        }
        return;
    }

    // Legacy chrome:// baseline (e.g. chrome://newtab/ saved before the
    // processTab guard existed). Redirect the restore to our NTP instead of
    // silently dropping it, so Ctrl+Shift+T lands on NTP rather than looping.
    if (data && data.url && data.url.startsWith('chrome://')) {
        memoryBaselines.delete(tabId);
        syncBaselinesToStorage();
        if (!globalSettings.useDefaultNtp) {
            chrome.tabs.create({ url: NTP_URL, windowId: removeInfo.windowId, active: false, index: data.index }).catch(() => {});
        }
        return;
    }

    if (data && data.url && !data.url.startsWith('chrome://') && !data.url.startsWith('chrome-extension://')) {

        memoryBaselines.delete(tabId);
        syncBaselinesToStorage();

        setTimeout(async () => {
            // Batch close → vault, no restore.
            // Pinned tabs are exempt: each Ctrl+W is a deliberate individual close,
            // so a pinned tab caught in a rapid-close batch should still restore.
            // Grouped tabs keep the batch-vault behavior (e.g. Close Group, Ctrl+W spam).
            const bt = windowBatchTracker.get(removeInfo.windowId);
            if (bt && bt.count > 1 && !data.pinned) {
                const canonicalUrl = getCanonicalUrl(data.url);
                if (!vaultCanonicalUrls.has(canonicalUrl)) {
                    data.savedAt = Date.now();
                    sessionVault.push(data);
                    vaultCanonicalUrls.add(canonicalUrl);
                    syncVaultToStorage();
                }
                return;
            }

            // Entire group deliberately closed → vault, no restore
            if (data.groupId !== NONE_GROUP) {
                const tracker = groupClosureTracker.get(data.groupId);
                if (tracker && tracker.baselineCount > 1 && tracker.closedIds.size >= tracker.baselineCount) {
                    const canonicalUrl = getCanonicalUrl(data.url);
                    if (!vaultCanonicalUrls.has(canonicalUrl)) {
                        data.savedAt = Date.now();
                        sessionVault.push(data);
                        vaultCanonicalUrls.add(canonicalUrl);
                        syncVaultToStorage();
                    }
                    return;
                }
            }

            // Last active tab in group closed, all remaining are hibernated
            // → restore the tab as a hibernated member of the group, then collapse.
            if (data.groupId !== NONE_GROUP && globalSettings.autoCollapseGroups && chrome.tabGroups) {
                try {
                    const remaining = await chrome.tabs.query({ groupId: data.groupId });
                    if (remaining.length > 0 && remaining.every(t => t.discarded)) {
                        data._collapseAfterRestore = true;
                    }
                } catch (e) {}
            }

            // Protected tab single close: RESTORE
            try {
                const newTab = await chrome.tabs.create({
                    url: data.url, pinned: data.pinned,
                    windowId: removeInfo.windowId, active: false, index: data.index
                });

                if (data.groupId !== NONE_GROUP && chrome.tabGroups) {
                    const groupKey = `${removeInfo.windowId}|${data.groupId}`;
                    if (recreationRegistry.has(groupKey)) {
                        const existingGid = await recreationRegistry.get(groupKey);
                        await chrome.tabs.group({ tabIds: [newTab.id], groupId: existingGid }).catch(() => {});
                    } else {
                        const promise = (async () => {
                            try {
                                const byId = await chrome.tabGroups.get(data.groupId);
                                if (byId) {
                                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: byId.id }).catch(() => {});
                                    return byId.id;
                                }
                            } catch (e) { /* group no longer exists */ }

                            if (data.groupTitle && data.groupTitle.trim() !== '') {
                                const existing = await chrome.tabGroups.query({ windowId: removeInfo.windowId, title: data.groupTitle });
                                if (existing.length > 0) {
                                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: existing[0].id }).catch(() => {});
                                    return existing[0].id;
                                }
                            }

                            const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                            if (data.groupTitle && data.groupTitle.trim() !== '') {
                                await chrome.tabGroups.update(gid, { title: data.groupTitle, color: data.groupColor || 'grey' }).catch(() => {});
                            } else if (data.groupColor) {
                                await chrome.tabGroups.update(gid, { color: data.groupColor }).catch(() => {});
                            }
                            return gid;
                        })().catch(e => { console.warn('Tabs++ Group Recreation Error:', e); return null; });
                        recreationRegistry.set(groupKey, promise);
                        setTimeout(() => recreationRegistry.delete(groupKey), 3000);
                        await promise;
                    }
                }

                memoryBaselines.set(newTab.id, { ...data, _restoredAt: Date.now() });
                syncBaselinesToStorage();
                const collapseAfter = data._collapseAfterRestore && data.groupId !== NONE_GROUP
                    ? () => applyAutoCollapse(data.groupId, removeInfo.windowId)
                    : null;
                safeDiscard(newTab.id, collapseAfter, data.url);

            } catch (e) { /* Tab restore failed silently */ }
        }, 100);
    }
});

// --- MESSAGE DISPATCHER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== 'object' || typeof request.action !== 'string') return;
    switch (request.action) {
        case 'search-items':
            handleSearchItems(request, sender, sendResponse);
            return true;

        case 'execute-browser-action':
            executeAction(request.commandId, request.args, sender.tab)
                .then(() => sendResponse({ success: true }))
                .catch(e => { console.warn('[Tabs++] execute-browser-action error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'capture-viewport':
            // Called by content script during screenshot loop — capture and return
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
                .then(dataUrl => sendResponse({ dataUrl }))
                .catch(e => sendResponse({ error: e.message }));
            return true;

        case 'download-media':
            // Authority check: the content script can only reach this point after
            // the user activated the extract_media action, but it holds no view of
            // globalSettings. Re-check here so a toggle-off mid-session (or any
            // stale content-script state) can't trigger downloads behind the user's
            // back. downloads permission may still be granted post-migration, so
            // the setting — not the permission — is the reliable gate.
            if (globalSettings.enableMediaExtractor && request.urls && request.urls.length > 0) {
                // Stagger downloads 150ms apart — Chrome silently drops rapid-fire concurrent requests
                (async () => {
                    for (const url of request.urls) {
                        try {
                            await chrome.downloads.download({ url });
                        } catch (e) {
                            console.warn('[Tabs++] download failed:', url, e.message);
                        }
                        await new Promise(r => setTimeout(r, 150));
                    }
                })();
                sendResponse({ success: true });
            } else {
                // Feature disabled or no URLs — still acknowledge so the caller's
                // message port doesn't hang open until the "port closed" timeout.
                sendResponse({ success: false });
            }
            return true;

        case 'open-peek': handleOpenPeek(request, sender, sendResponse); return true;
        case 'promote-peek': handlePromotePeek(request, sender, sendResponse); return true;
        case 'check-peek-status': handleCheckPeekStatus(sender, sendResponse); return true;

        case 'close-peek':
            if (sender.tab?.windowId) chrome.windows.remove(sender.tab.windowId).catch(() => {});
            return true;

        case 'palette-closing':
            if (sender.tab?.id) {
                paletteFallbackClosingIds.add(sender.tab.id);
            }
            return true;
            
        case 'update-settings':
            if (request.settings && typeof request.settings === 'object') {
                const oldProtectPinned = globalSettings.protectPinned;
                const oldProtectGrouped = globalSettings.protectGrouped;
                updateSettings(request.settings);
                chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                // When a protection toggle is switched off, evict baselines for
                // tabs that are no longer protected so they close normally
                // instead of being silently restored.
                if ((oldProtectPinned && !globalSettings.protectPinned) ||
                    (oldProtectGrouped && !globalSettings.protectGrouped)) {
                    evictUnprotectedBaselines().catch(() => {});
                }
                // When a protection toggle is switched on, register baselines
                // for existing tabs that are now protected but don't have one
                // yet. Without this, pre-existing pinned/grouped tabs would
                // only get a baseline on their next onUpdated event.
                if ((!oldProtectPinned && globalSettings.protectPinned) ||
                    (!oldProtectGrouped && globalSettings.protectGrouped)) {
                    registerProtectedBaselines().catch(() => {});
                }
            }
            sendResponse({ success: true });
            return true;

        case 'switch-to-tab':
            if (!Number.isFinite(request.tabId) || !Number.isFinite(request.windowId)) return;
            chrome.tabs.update(request.tabId, { active: true }).catch(() => {});
            chrome.windows.update(request.windowId, { focused: true }).catch(() => {});
            sendResponse({ success: true });
            return true;

        case 'open-url':
            if (typeof request.url !== 'string') return;
            if (request.url === 'virtual:restore-vault') {
                ensureLoaded().then(async () => {
                    const success = await restoreVault(sessionVault);
                    if (success) { setSessionVault([]); vaultCanonicalUrls.clear(); syncVaultToStorage(); }
                    sendResponse({ success });
                }).catch(e => { console.warn('[Tabs++] open-url restore-vault error:', e.message); sendResponse({ success: false }); });
                return true;
            }
            chrome.tabs.create({ url: request.url, active: true })
                .then(tab => {
                    if (tab) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
                })
                .catch(() => {});
            sendResponse({ success: true });
            return true;

        case 'open-query': {
            if (typeof request.query !== 'string') return;
            const q = request.query.trim();
            const isUrl = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\\/\w \.-]*)*\/?$/.test(q.toLowerCase()) || q.startsWith('localhost');
            const engine = SEARCH_ENGINES[globalSettings.searchEngine] || SEARCH_ENGINES.google;
            let url = engine.url + encodeURIComponent(q);
            if (isUrl) url = q.startsWith('http://') || q.startsWith('https://') ? q : 'https://' + q;
            chrome.tabs.create({ url, active: true })
                .then(tab => {
                    if (tab) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
                })
                .catch(() => {});
            sendResponse({ success: true });
            return true;
        }

        case 'get-sets':
            ensureLoaded().then(() => sendResponse({ sets: tabSets }))
                .catch(e => { console.warn('[Tabs++] get-sets error:', e.message); sendResponse({ sets: {} }); });
            return true;

        case 'save-set':
            performSaveSet(request)
                .then(sets => sendResponse({ success: true, sets }))
                .catch(e => { console.warn('[Tabs++] save-set error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'launch-set':
            if (typeof request.name !== 'string') { sendResponse({ success: false }); return true; }
            performLaunchSet(request.name)
                .then(success => sendResponse({ success }))
                .catch(e => { console.warn('[Tabs++] launch-set error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'summon-set':
            // windowId is optional — performSummonSet resolves the current window
            // when omitted (the popup's Summon button never sends one). Only the
            // name is required, mirroring replace-set.
            if (typeof request.name !== 'string') { sendResponse({ success: false }); return true; }
            performSummonSet(request.name, request.windowId)
                .then(result => sendResponse({ success: result ? result.success : false }))
                .catch(e => { console.warn('[Tabs++] summon-set error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'replace-set':
            if (typeof request.name !== 'string') { sendResponse({ success: false }); return true; }
            performReplaceSet(request.name, request.windowId)
                .then(success => sendResponse({ success }))
                .catch(e => { console.warn('[Tabs++] replace-set error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'delete-set':
            if (typeof request.name !== 'string') { sendResponse({ success: false }); return true; }
            performDeleteSet(request.name)
                .then(sets => sendResponse({ success: true, sets }))
                .catch(e => { console.warn('[Tabs++] delete-set error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'get-prompts':
            ensureLoaded().then(() => sendResponse({ prompts: savedPrompts }))
                .catch(e => { console.warn('[Tabs++] get-prompts error:', e.message); sendResponse({ prompts: [] }); });
            return true;

        case 'save-prompt': {
            const name = (typeof request.name === 'string' ? request.name : '').trim();
            const text = typeof request.text === 'string' ? request.text : '';
            if (!name || !text) { sendResponse({ success: false, error: 'name and text required' }); return true; }
            if (name.length > 200) { sendResponse({ success: false, error: 'name too long' }); return true; }
            if (text.length > 1_000_000) { sendResponse({ success: false, error: 'text too large' }); return true; }
            ensureLoaded().then(() => {
                const prompt = { id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, text, createdAt: Date.now() };
                const updated = [...savedPrompts, prompt];
                setSavedPrompts(updated);
                syncPromptsToStorage();
                sendResponse({ success: true, prompts: updated });
            }).catch(e => { console.warn('[Tabs++] save-prompt error:', e.message); sendResponse({ success: false }); });
            return true;
        }

        case 'delete-prompt': {
            if (typeof request.id !== 'string' || !request.id || request.id.length > 64) { sendResponse({ success: false }); return true; }
            ensureLoaded().then(() => {
                const updated = savedPrompts.filter(p => p.id !== request.id);
                if (updated.length === savedPrompts.length) { sendResponse({ success: false, error: 'not found' }); return; }
                setSavedPrompts(updated);
                syncPromptsToStorage();
                sendResponse({ success: true, prompts: updated });
            }).catch(e => { console.warn('[Tabs++] delete-prompt error:', e.message); sendResponse({ success: false }); });
            return true;
        }

        case 'import-sets':
            ensureLoaded().then(() => {
                const imported = request.sets;
                if (imported && typeof imported === 'object' && !Array.isArray(imported)) {
                    for (const key in imported) {
                        tabSets[key] = Array.isArray(imported[key]) ? { type: 'workspace', tabs: imported[key] } : imported[key];
                    }
                    syncSetsToStorage();
                    sendResponse({ success: true, sets: tabSets });
                } else { sendResponse({ success: false }); }
            }).catch(e => { console.warn('[Tabs++] import-sets error:', e.message); sendResponse({ success: false }); });
            return true;

        case 'stop-pomo-timer': {
            stopPomoTimer();
            sendResponse({ success: true });
            return true;
        }

        case 'get-pomo-status':
            sendResponse({ pomoTimer });
            return true;
    }
});


// --- COMMAND SHORTCUTS ---
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'hibernate-background') {
        await executeAction('hibernate_all');
        return;
    }

    if (command === 'toggle-palette') {
        await ensureLoaded();
        if (!globalSettings.enablePalette) return;

        // Use Promise-based query — avoids callback race where service worker
        // can be terminated before the async callback body runs.
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const windowId = tabs.length > 0 ? tabs[0].windowId : chrome.windows.WINDOW_ID_CURRENT;

        if (tabs.length > 0) {
            const tab = tabs[0];
            try {
                await chrome.tabs.sendMessage(tab.id, { action: 'toggle-palette' });
            } catch (_) {
                // sendMessage failed — either restricted page or stale context after reload.
                const isInjectablePage = tab.url &&
                    !tab.url.startsWith('chrome://') &&
                    !tab.url.startsWith('chrome-extension://') &&
                    !tab.url.startsWith('about:') &&
                    !tab.url.startsWith('edge://');

                if (isInjectablePage) {
                    try {
                        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
                        // Brief pause for the script to initialize its listeners
                        await new Promise(r => setTimeout(r, 150));
                        try {
                            await chrome.tabs.sendMessage(tab.id, { action: 'toggle-palette' });
                        } catch (_retryErr) {
                            await focusOrCreateNtpWithPalette(windowId);
                        }
                    } catch (_injectErr) {
                        await focusOrCreateNtpWithPalette(windowId);
                    }
                } else {
                    await focusOrCreateNtpWithPalette(windowId);
                }
            }
        } else {
            await focusOrCreateNtpWithPalette(windowId);
        }
    }
});

/**
 * Focuses an existing NTP in the given window and toggles its palette,
 * or creates a new NTP only if none is found.
 * Prevents duplicate NTPs when the palette shortcut fires on restricted pages.
 */
async function focusOrCreateNtpWithPalette(windowId) {
    const cachedNtpId = ntpTabCache.get(windowId);
    if (cachedNtpId) {
        try {
            await chrome.tabs.update(cachedNtpId, { active: true });
            await chrome.tabs.sendMessage(cachedNtpId, { action: 'toggle-palette' }).catch(() => {});
        } catch (_) {
            // Cached NTP no longer exists — clear and fall through to query
            ntpTabCache.delete(windowId);
            await queryOrCreateNtpWithPalette(windowId);
        }
    } else {
        await queryOrCreateNtpWithPalette(windowId);
    }
}

async function queryOrCreateNtpWithPalette(windowId) {
    const existing = await chrome.tabs.query({ url: NTP_URL, windowId });
    if (existing && existing.length > 0) {
        ntpTabCache.set(windowId, existing[0].id);
        await chrome.tabs.update(existing[0].id, { active: true }).catch(() => {});
        await chrome.tabs.sendMessage(existing[0].id, { action: 'toggle-palette' }).catch(() => {});
    } else {
        const created = await chrome.tabs.create({ url: NTP_URL + '?action=palette', active: true }).catch(() => null);
        if (created) ntpTabCache.set(windowId, created.id);
    }
}

// --- ALARMS ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'pomo-timer') {
        // Capture type BEFORE clearing state, as notification reads it
        const completedType = pomoTimer.type;
        setPomoTimer({ endTime: null, type: null, isActive: false, minutes: null });
        broadcastPomoState();
        chrome.notifications.create('pomo-done', {
            type: 'basic',
            iconUrl: 'assets/icon128.png',
            title: completedType === 'work' ? 'Time for a break!' : 'Break over, let\'s focus!',
            message: completedType === 'work' ? 'You completed your Pomodoro session.' : 'Ready to start working again?',
            priority: 2
        }).catch(() => {});
        return;
    }
    if (alarm.name === 'tabs-plus-auto-hibernate') {
        await ensureLoaded();
        if (!globalSettings.enableAutoHibernate) return;

        let ms = 60 * 60 * 1000; // default 1h
        const raw = globalSettings.hibernateThresholdRaw || '1h';
        const match = raw.match(/^(\d+(?:\.\d+)?)\s*(m|h)$/i);
        if (match) {
            const val = parseFloat(match[1]);
            if (match[2].toLowerCase() === 'm') ms = val * 60 * 1000;
            if (match[2].toLowerCase() === 'h') ms = val * 60 * 60 * 1000;
        }
        const cutoff = Date.now() - ms;
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.active || tab.pinned || tab.groupId !== NONE_GROUP || memoryBaselines.has(tab.id) || peekWindows.has(tab.windowId)) continue;
            if (tab.lastAccessed && tab.lastAccessed < cutoff) {
                await safeHibernate(tab);
            }
        }
        return;
    }

    if (alarm.name === 'tabs-plus-auto-close') {
        await ensureLoaded();
        if (!globalSettings.enableAutoArchive) return;

        let ms = 12 * 60 * 60 * 1000; // default 12h
        const raw = globalSettings.archiveThresholdRaw || '12h';
        const match = raw.match(/^(\d+(?:\.\d+)?)\s*(m|h)$/i);
        if (match) {
            const val = parseFloat(match[1]);
            if (match[2].toLowerCase() === 'm') ms = val * 60 * 1000;
            if (match[2].toLowerCase() === 'h') ms = val * 60 * 60 * 1000;
        }
        const cutoff = Date.now() - ms;
        const tabs = await chrome.tabs.query({});
        const toClose = [];

        for (const tab of tabs) {
            if (tab.active || tab.pinned || tab.groupId !== NONE_GROUP || memoryBaselines.has(tab.id) || peekWindows.has(tab.windowId)) continue;
            if (tab.lastAccessed && tab.lastAccessed < cutoff) {
                toClose.push(tab);
            }
        }

        if (toClose.length > 0) {
            for (const tab of toClose) {
                if (tab.url && !tab.url.startsWith('chrome')) {
                    const canonical = getCanonicalUrl(tab.url);
                    if (!vaultCanonicalUrls.has(canonical)) {
                        sessionVault.push({ url: tab.url, title: tab.title, savedAt: Date.now(), pinned: false, groupId: NONE_GROUP });
                        vaultCanonicalUrls.add(canonical);
                    }
                }
            }
            syncVaultToStorage();
            chrome.tabs.remove(toClose.map(t => t.id)).catch(() => {});
        }
    }
});
