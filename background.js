import { memoryBaselines, globalSettings, lastActiveTabId, setLastActiveTabId, groupCache, peekWindows, evictionGraveyard, recreationRegistry, groupClosureTracker, windowBatchTracker, closingWindowIds, ntpTabCache, sessionVault, setSessionVault, tabSets, updateSettings } from './state.js';
import { NONE_GROUP, NTP_URL } from './constants.js';
import { getCanonicalUrl, safeDiscard } from './utils.js';
import { ensureLoaded, initializeState, processTab, applyAutoGrouping, applyAutoCollapse, syncBaselinesToStorage, syncVaultToStorage, syncSetsToStorage, saveSnapshot, restoreVault } from './services/tabService.js';
import { handleSearchItems, executeAction } from './services/paletteService.js';
import { cleanupPeekWindow, handleOpenPeek, handlePromotePeek, handleCheckPeekStatus } from './services/peekService.js';

// --- INITIALIZATION ---
chrome.runtime.onStartup.addListener(() => {
    initializeState(true);
    // Ruthless Clean: schedule hourly check
    chrome.alarms.create('tabs-plus-auto-archive', { periodInMinutes: 60 });
});
chrome.runtime.onInstalled.addListener(() => {
    initializeState(false);
    chrome.alarms.create('tabs-plus-auto-archive', { periodInMinutes: 60 });
});

// --- WINDOW LISTENERS ---
chrome.windows.onRemoved.addListener((windowId) => {
    cleanupPeekWindow(windowId);
    windowBatchTracker.delete(windowId);
    closingWindowIds.delete(windowId);
    chrome.windows.getAll({ windowTypes: ['normal'] }).then(remaining => {
        if (remaining.length === 0) { syncBaselinesToStorage(true); saveSnapshot(); }
    }).catch(() => {});
});

// --- TAB LISTENERS (CONSOLIDATED) ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await ensureLoaded();
    setLastActiveTabId(activeInfo.tabId);

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
                const cachedNtpId = ntpTabCache.get(tab.windowId);
                if (cachedNtpId) {
                    await chrome.tabs.update(cachedNtpId, { active: true });
                } else {
                    const c = await chrome.tabs.create({ url: NTP_URL, active: true, windowId: tab.windowId, index: 9999 });
                    ntpTabCache.set(tab.windowId, c.id);
                    if (c.groupId !== NONE_GROUP) chrome.tabs.ungroup(c.id).catch(() => {});
                }
            } catch (e) {}
            safeDiscard(tab.id);
        });
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ensureLoaded();
    if (changeInfo.status === 'complete' || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined || changeInfo.discarded !== undefined) {
        if (processTab(tab)) syncBaselinesToStorage();
    }
    if (globalSettings.enableAutoGroup && changeInfo.url && !tab.pinned && tab.groupId === NONE_GROUP) {
        if (!evictionGraveyard.has(`inheritance_${tabId}`)) applyAutoGrouping(tab);
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
    const isProtectedTab = memoryBaselines.has(tabId);
    if (globalSettings.focusNTPOnClose && tabId === lastActiveTabId && !removeInfo.isWindowClosing && !isProtectedTab) {
        if (!peekWindows.has(removeInfo.windowId)) {
            const cachedNtpId = ntpTabCache.get(removeInfo.windowId);
            if (cachedNtpId) {
                chrome.tabs.update(cachedNtpId, { active: true }).catch(() => ntpTabCache.delete(removeInfo.windowId));
            } else {
                chrome.tabs.create({ url: NTP_URL, active: true, windowId: removeInfo.windowId, index: 9999 })
                    .then(c => {
                        ntpTabCache.set(removeInfo.windowId, c.id);
                        if (c.groupId !== NONE_GROUP && chrome.tabGroups) chrome.tabs.ungroup(c.id).catch(() => {});
                    });
            }
        }
    }

    // NTP cache cleanup
    for (const [winId, ntpId] of ntpTabCache.entries()) {
        if (ntpId === tabId) { ntpTabCache.delete(winId); break; }
    }

    await ensureLoaded();

    let data = memoryBaselines.get(tabId);
    if (!data && evictionGraveyard.has(tabId)) {
        data = evictionGraveyard.get(tabId).data;
        clearTimeout(evictionGraveyard.get(tabId).timeout);
        evictionGraveyard.delete(tabId);
    }

    // Group closure detection
    if (data && data.url && data.groupId !== NONE_GROUP) {
        let tracker = groupClosureTracker.get(data.groupId);
        if (!tracker) {
            let baselineCount = 0;
            for (const b of memoryBaselines.values()) { if (b.groupId === data.groupId) baselineCount++; }
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
            const windowBaselines = Array.from(memoryBaselines.values()).filter(d => d.windowId === removeInfo.windowId && d.url);
            for (const d of windowBaselines) {
                if (!sessionVault.some(t => getCanonicalUrl(t.url) === getCanonicalUrl(d.url))) {
                    d.savedAt = Date.now();
                    sessionVault.push(d);
                }
            }
            if (windowBaselines.length > 0) syncVaultToStorage();
        }
        return;
    }

    if (data && data.url) {
        memoryBaselines.delete(tabId);
        syncBaselinesToStorage();

        setTimeout(async () => {
            // Batch close → vault, no restore
            const bt = windowBatchTracker.get(removeInfo.windowId);
            if (bt && bt.count > 1) {
                if (!sessionVault.some(t => getCanonicalUrl(t.url) === getCanonicalUrl(data.url))) {
                    data.savedAt = Date.now();
                    sessionVault.push(data);
                    syncVaultToStorage();
                }
                return;
            }

            // Entire group deliberately closed → vault, no restore
            if (data.groupId !== NONE_GROUP) {
                const tracker = groupClosureTracker.get(data.groupId);
                if (tracker && tracker.closedIds.size >= tracker.baselineCount) {
                    if (!sessionVault.some(t => getCanonicalUrl(t.url) === getCanonicalUrl(data.url))) {
                        data.savedAt = Date.now();
                        sessionVault.push(data);
                        syncVaultToStorage();
                    }
                    return;
                }
            }

            // Last active tab in group closed, all remaining are hibernated
            // → restore the tab as a hibernated member of the group, then collapse.
            // We must NOT skip restoration here — that would permanently remove the
            // tab from the group, which is the bug we're fixing.
            if (data.groupId !== NONE_GROUP && globalSettings.autoCollapseGroups && chrome.tabGroups) {
                try {
                    const remaining = await chrome.tabs.query({ groupId: data.groupId });
                    if (remaining.length > 0 && remaining.every(t => t.discarded)) {
                        // Fall through to the RESTORE block below, then after
                        // the tab is recreated & discarded, collapse the group.
                        // We signal this with a flag so the restore block can collapse afterwards.
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
                    const groupKey = `${removeInfo.windowId}|${data.groupTitle}`;
                    if (recreationRegistry.has(groupKey)) {
                        const existingGid = await recreationRegistry.get(groupKey);
                        await chrome.tabs.group({ tabIds: [newTab.id], groupId: existingGid }).catch(() => {});
                    } else {
                        const promise = (async () => {
                            const existing = await chrome.tabGroups.query({ windowId: removeInfo.windowId, title: data.groupTitle });
                            if (existing.length > 0) {
                                await chrome.tabs.group({ tabIds: [newTab.id], groupId: existing[0].id }).catch(() => {});
                                return existing[0].id;
                            }
                            const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                            await chrome.tabGroups.update(gid, { title: data.groupTitle || '', color: data.groupColor || 'grey' });
                            return gid;
                        })();
                        recreationRegistry.set(groupKey, promise);
                        setTimeout(() => recreationRegistry.delete(groupKey), 3000);
                        await promise;
                    }
                }

                memoryBaselines.set(newTab.id, { ...data, _restoredAt: Date.now() });
                syncBaselinesToStorage();
                // safeDiscard waits for status:complete before discarding so the
                // URL is committed to Chrome's session store. Immediate discard
                // on an unloaded tab causes about:blank.
                // If flagged, collapse the group immediately after the tab is discarded
                // so applyAutoCollapse's "all discarded" guard passes correctly.
                const collapseAfter = data._collapseAfterRestore && data.groupId !== NONE_GROUP
                    ? () => applyAutoCollapse(data.groupId, removeInfo.windowId)
                    : null;
                safeDiscard(newTab.id, collapseAfter);


            } catch (e) { /* Tab restore failed silently */ }
        }, 100);
    }
});

// --- MESSAGE DISPATCHER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'search-items':
            handleSearchItems(request, sender, sendResponse);
            return true;

        case 'execute-browser-action':
            executeAction(request.commandId, request.args).then(() => sendResponse({ success: true }));
            return true;

        case 'open-peek': handleOpenPeek(request, sender, sendResponse); return true;
        case 'promote-peek': handlePromotePeek(request, sender, sendResponse); return true;
        case 'check-peek-status': handleCheckPeekStatus(sender, sendResponse); return true;

        case 'update-settings':
            updateSettings(request.settings);
            chrome.storage.local.set({ settings: globalSettings });
            sendResponse({ success: true });
            return true;

        case 'get-settings':
            sendResponse({ settings: globalSettings });
            return true;

        case 'switch-to-tab':
            chrome.tabs.update(request.tabId, { active: true });
            chrome.windows.update(request.windowId, { focused: true });
            sendResponse({ success: true });
            return true;

        case 'open-url':
            if (request.url === 'virtual:restore-vault') {
                ensureLoaded().then(async () => {
                    const success = await restoreVault(sessionVault);
                    if (success) { setSessionVault([]); syncVaultToStorage(); }
                    sendResponse({ success });
                });
                return true;
            }
            chrome.tabs.create({ url: request.url, active: true }, (tab) => {
                if (tab) chrome.windows.update(tab.windowId, { focused: true });
            });
            sendResponse({ success: true });
            return true;

        case 'open-query': {
            const q = request.query || '';
            const isUrl = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\\/\w \.-]*)*\/?$/.test(q.toLowerCase()) || q.startsWith('localhost');
            let url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
            if (isUrl) url = q.startsWith('http') ? q : 'https://' + q;
            chrome.tabs.create({ url, active: true }, (tab) => {
                if (tab) chrome.windows.update(tab.windowId, { focused: true });
            });
            sendResponse({ success: true });
            return true;
        }

        case 'get-sets':
            ensureLoaded().then(() => sendResponse({ sets: tabSets }));
            return true;

        case 'save-set':
            ensureLoaded().then(async () => {
                const tabs = await chrome.tabs.query({ windowId: request.windowId || chrome.windows.WINDOW_ID_CURRENT });
                const protectedTabs = [];
                for (const t of tabs) {
                    const shouldSave = request.setType === 'group'
                        ? t.groupId === request.groupId
                        : (t.pinned || t.groupId !== NONE_GROUP);
                    if (shouldSave) {
                        const tabData = { url: t.url, pinned: t.pinned, groupId: t.groupId !== NONE_GROUP ? t.groupId : -1 };
                        if (t.groupId !== NONE_GROUP && chrome.tabGroups) {
                            try { const g = await chrome.tabGroups.get(t.groupId); tabData.groupTitle = g.title; tabData.groupColor = g.color; } catch (e) {}
                        }
                        protectedTabs.push(tabData);
                    }
                }
                tabSets[request.name] = { type: request.setType || 'workspace', tabs: protectedTabs };
                syncSetsToStorage();
                sendResponse({ success: true, sets: tabSets });
            });
            return true;

        case 'launch-set':
            ensureLoaded().then(async () => {
                const setObj = tabSets[request.name];
                if (!setObj?.tabs?.length) { sendResponse({ success: false }); return; }
                const newWin = await chrome.windows.create({ focused: true });
                const groupMap = {};
                for (const data of setObj.tabs) {
                    const newTab = await chrome.tabs.create({ url: data.url, pinned: data.pinned, windowId: newWin.id, active: false });
                    if (data.groupId !== -1 && chrome.tabGroups) {
                        const gk = `${data.groupTitle}-${data.groupColor}`;
                        if (!groupMap[gk]) {
                            const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                            await chrome.tabGroups.update(gid, { title: data.groupTitle || '', color: data.groupColor || 'grey' });
                            groupMap[gk] = gid;
                        } else { await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[gk] }); }
                    }
                    if (!data.active) safeDiscard(newTab.id);
                }
                const allTabs = await chrome.tabs.query({ windowId: newWin.id });
                if (allTabs.length > setObj.tabs.length) chrome.tabs.remove(allTabs[0].id).catch(() => {});
                sendResponse({ success: true });
            });
            return true;

        case 'summon-set':
            ensureLoaded().then(async () => {
                const setObj = tabSets[request.name];
                if (!setObj?.tabs?.length) { sendResponse({ success: false }); return; }
                const targetWinId = request.windowId || chrome.windows.WINDOW_ID_CURRENT;
                const existing = chrome.tabGroups ? await chrome.tabGroups.query({ windowId: targetWinId }) : [];
                const groupMap = {};
                existing.forEach(g => { groupMap[`${g.title || ''}-${g.color || 'grey'}`] = g.id; });
                for (const data of setObj.tabs) {
                    const newTab = await chrome.tabs.create({ url: data.url, pinned: data.pinned, windowId: targetWinId, active: false });
                    if (data.groupId !== -1 && chrome.tabGroups) {
                        const gk = `${data.groupTitle || ''}-${data.groupColor || 'grey'}`;
                        if (!groupMap[gk]) {
                            const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                            await chrome.tabGroups.update(gid, { title: data.groupTitle || '', color: data.groupColor || 'grey' });
                            groupMap[gk] = gid;
                        } else { await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[gk] }); }
                    }
                    if (!data.active) safeDiscard(newTab.id);
                }
                sendResponse({ success: true });
            });
            return true;

        case 'delete-set':
            ensureLoaded().then(() => {
                delete tabSets[request.name];
                syncSetsToStorage();
                sendResponse({ success: true, sets: tabSets });
            });
            return true;

        case 'import-sets':
            ensureLoaded().then(() => {
                const imported = request.sets;
                if (imported && typeof imported === 'object') {
                    for (const key in imported) {
                        tabSets[key] = Array.isArray(imported[key]) ? { type: 'workspace', tabs: imported[key] } : imported[key];
                    }
                    syncSetsToStorage();
                    sendResponse({ success: true, sets: tabSets });
                } else { sendResponse({ success: false }); }
            });
            return true;

        case 'restore-vault':
            ensureLoaded().then(async () => {
                if (!sessionVault?.length) { sendResponse({ success: false }); return; }
                const success = await restoreVault(sessionVault);
                if (success) { setSessionVault([]); syncVaultToStorage(); }
                sendResponse({ success });
            });
            return true;

        case 'clear-vault':
            ensureLoaded().then(() => {
                setSessionVault([]);
                syncVaultToStorage();
                sendResponse({ success: true });
            });
            return true;

        case 'check-tab-status': {
            const tab = sender.tab;
            if (tab) {
                const isProt = (globalSettings.protectPinned && tab.pinned) ||
                    (globalSettings.protectGrouped && tab.groupId !== NONE_GROUP);
                sendResponse({ isProtected: isProt });
            } else { sendResponse({ isProtected: false }); }
            return true;
        }
    }
});

// --- COMMAND SHORTCUTS ---
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-palette') {
        await ensureLoaded();
        if (!globalSettings.enablePalette) return;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle-palette' }).catch(() => {
                    chrome.tabs.create({ url: NTP_URL + '?action=palette', active: true });
                });
            } else chrome.tabs.create({ url: NTP_URL + '?action=palette', active: true });
        });
    }
});

// --- RUTHLESS CLEAN (AUTO-ARCHIVE) ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'tabs-plus-auto-archive') return;
    await ensureLoaded();
    if (!globalSettings.enableAutoArchive) return;

    const cutoff = Date.now() - (12 * 60 * 60 * 1000); // 12 hours
    const tabs = await chrome.tabs.query({});
    const toClose = [];

    for (const tab of tabs) {
        // Never close: active, pinned, grouped, or protected tabs
        if (tab.active || tab.pinned) continue;
        if (tab.groupId !== NONE_GROUP) continue;
        if (memoryBaselines.has(tab.id)) continue;
        if (peekWindows.has(tab.windowId)) continue;
        // Use Chrome's native lastAccessed timestamp
        if (tab.lastAccessed && tab.lastAccessed < cutoff) {
            toClose.push(tab.id);
        }
    }

    if (toClose.length > 0) {
        // Save to vault before closing so user can recover
        for (const tabId of toClose) {
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            if (tab?.url && !tab.url.startsWith('chrome')) {
                const canonical = getCanonicalUrl(tab.url);
                if (!sessionVault.some(t => getCanonicalUrl(t.url) === canonical)) {
                    sessionVault.push({ url: tab.url, title: tab.title, savedAt: Date.now(), pinned: false, groupId: NONE_GROUP });
                }
            }
        }
        syncVaultToStorage();
        chrome.tabs.remove(toClose);
    }
});
