import { memoryBaselines, globalSettings, sessionVault, vaultCanonicalUrls, tabSets, groupCache, setInitialized, setSessionVault, setTabSets, isInitialized, ntpTabCache, evictionGraveyard, peekWindows, autoGroupRegistry, discardedTabs, savedPrompts, setSavedPrompts } from '../state.js';
import { getCanonicalUrl, safeDiscard } from '../utils.js';
import { NONE_GROUP, GROUPING_RULES, NTP_URL } from '../constants.js';

const domainRuleMap = new Map();
for (const rule of GROUPING_RULES) {
    for (const d of rule.domains) {
        domainRuleMap.set(d, rule);
    }
}
const aiRule = GROUPING_RULES.find(r => r.title === 'AI');
// Smart Group titles (Dev/Design/AI/Media/News/Social) — pre-built once so
// regrouping can distinguish extension-managed groups from manual/custom ones.
const ruleTitles = new Set(GROUPING_RULES.map(r => r.title));

function findRuleByHost(host) {
    let rule = domainRuleMap.get(host);
    if (rule) return rule;
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
        rule = domainRuleMap.get(parts.slice(i).join('.'));
        if (rule) return rule;
    }
    return null;
}

// Resolves when the tab reaches status:'complete', or rejects after timeoutMs.
// One-shot listener: registers, fires once, removes itself. Used by
// safeHibernate to guarantee a reset-to-baseline navigation has committed to
// Chrome's session store before the tab is discarded (BUG-006).
function waitForTabComplete(tabId, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const listener = (tId, changeInfo) => {
            if (tId === tabId && changeInfo.status === 'complete' && !settled) {
                settled = true;
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timer);
                resolve();
            }
        };
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error('waitForTabComplete timeout'));
            }
        }, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
    });
}

export async function safeHibernate(tab) {
    if (tab.discarded) return;
    const baseline = memoryBaselines.get(tab.id);
    const needsReset = baseline && baseline.url && (tab.pinned || baseline.groupId !== NONE_GROUP);
    if (needsReset) {
        const currentUrl = tab.pendingUrl || tab.url;
        if (currentUrl !== baseline.url) {
            try {
                // Navigate back to baseline AND wait for the page to finish
                // loading before discarding. Previously this was fire-and-forget,
                // so the discard could land while status was still 'loading' and
                // the baseline URL hadn't committed — and attemptDiscard's own
                // targetUrl navigation then created a double-navigation race
                // (BUG-006). We now pass NO targetUrl to safeDiscard so the
                // second navigation never fires.
                await chrome.tabs.update(tab.id, { url: baseline.url });
                await waitForTabComplete(tab.id, 8000);
            } catch (e) {
                // Update threw or waitForTabComplete timed out (slow/hung site).
                // Fall through and discard anyway — no worse than today.
            }
        }
    }
    safeDiscard(tab.id);
}

// Hibernate a tab that is currently ACTIVE. Chrome forbids discarding the
// focused tab, so we must move focus elsewhere first. We activate an NTP
// (resolving it via the same cache → query → create pattern the Focus Guard
// uses), wait for the activation to land, then safeHibernate the original.
// Used by the `hibernate_current` and `hibernate_pinned` palette commands.
// (BUG-003 / BUG-004: previously these silently no-op'd because safeDiscard
// aborts on the active tab.)
export async function hibernateActiveTab(tab) {
    if (!tab || tab.discarded) return;
    const windowId = tab.windowId;

    // 1. Resolve + activate an NTP to receive focus.
    let activated = false;
    try {
        if (globalSettings.useDefaultNtp) {
            // Native NTP: always create fresh (no canonical NTP URL to reuse).
            await chrome.tabs.create({ active: true, windowId, index: 9999 });
            activated = true;
        } else {
            // Tabs++ NTP: reuse cached → query existing → create.
            const cachedNtpId = ntpTabCache.get(windowId);
            if (cachedNtpId) {
                try {
                    await chrome.tabs.update(cachedNtpId, { active: true });
                    activated = true;
                } catch (e) {
                    // Cached NTP is gone — fall through to query/create.
                    ntpTabCache.delete(windowId);
                }
            }
            if (!activated) {
                const existing = await chrome.tabs.query({ url: NTP_URL, windowId });
                if (existing && existing.length > 0) {
                    ntpTabCache.set(windowId, existing[0].id);
                    await chrome.tabs.update(existing[0].id, { active: true });
                    activated = true;
                } else {
                    const c = await chrome.tabs.create({ url: NTP_URL, active: true, windowId, index: 9999 });
                    ntpTabCache.set(windowId, c.id);
                    if (c.groupId !== NONE_GROUP && chrome.tabGroups) {
                        chrome.tabs.ungroup(c.id).catch(() => {});
                    }
                    activated = true;
                }
            }
        }
    } catch (e) {
        // NTP activation failed — abort rather than risk throwing on discard.
        return;
    }

    // 2. By now the target tab is no longer active. safeHibernate re-checks
    //    tab.active via safeDiscard, so a timing race degrades to a safe no-op.
    await safeHibernate(tab);
}

// Helper to dynamically update the auto-cleanup alarms based on timeout settings
export function updateCleanupAlarms() {
    const alarms = [
        { name: 'tabs-plus-auto-close', raw: globalSettings.archiveThresholdRaw || '12h' },
        { name: 'tabs-plus-auto-hibernate', raw: globalSettings.hibernateThresholdRaw || '1h' }
    ];

    alarms.forEach(alarmInfo => {
        let period = 15;
        const match = alarmInfo.raw.match(/^(\d+(?:\.\d+)?)\s*(m|h)$/i);
        if (match) {
            const val = parseFloat(match[1]);
            const unit = match[2].toLowerCase();
            let ms = 0;
            if (unit === 'm') ms = val * 60 * 1000;
            if (unit === 'h') ms = val * 60 * 60 * 1000;

            if (ms <= 15 * 60 * 1000) period = 1;      // <= 15m -> check every minute
            else if (ms <= 60 * 60 * 1000) period = 5; // <= 1h -> check every 5 minutes
            else period = 15;                          // > 1h -> check every 15 minutes
        }
        chrome.alarms.clear(alarmInfo.name, () => {
            chrome.alarms.create(alarmInfo.name, { periodInMinutes: period });
        });
    });
}

// Set used to track tabs pending eviction (avoids polluting stored baseline data)
const pendingEvictionIds = new Set();

export function syncVaultToStorage() {
    chrome.storage.local.set({ vault: sessionVault }).catch(() => {});
}

export function syncSetsToStorage() {
    chrome.storage.local.set({ tabSets: tabSets }).catch(() => {});
}

export function syncPromptsToStorage() {
    chrome.storage.local.set({ savedPrompts }).catch(() => {});
}

let syncTimeout = null;
export function syncBaselinesToStorage(force = false) {
    if (force) {
        if (syncTimeout) clearTimeout(syncTimeout);
        chrome.storage.local.set({
            baselines: Object.fromEntries(memoryBaselines)
        }).catch(() => {});
        return;
    }
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        chrome.storage.local.set({
            baselines: Object.fromEntries(memoryBaselines)
        }).catch(() => {});
    }, 2000);
}

// Durable crash-recovery snapshot of protected (pinned/grouped) tabs.
// Hostname-keyed so it survives SW death and tabId churn. Written automatically
// by processTab on every baseline change — no manual save button.
//
// recentlyPruned: hosts deliberately closed within the last 60s. Prevents
// Ghost Prevention auto-reopen from re-adding them to the crash recovery list.
let protectedSnapshot = {};
const recentlyPruned = new Map();
let persistTimeout = null;

export function persistProtectedSnapshot() {
    if (persistTimeout) clearTimeout(persistTimeout);
    persistTimeout = setTimeout(() => {
        const snap = {};
        const now = Date.now();
        for (const b of memoryBaselines.values()) {
            if (!b.url || b.url.startsWith('chrome://') || b.url.startsWith('chrome-extension://')) continue;
            const isProtected = (b.pinned) || (b.groupId !== -1 && b.groupId !== undefined);
            if (!isProtected) continue;
            try {
                const host = new URL(b.url).hostname;
                // Skip hosts that were just deliberately closed. Ghost Prevention
                // reopens them moments later, but we must NOT re-persist them.
                const prunedAt = recentlyPruned.get(host);
                if (prunedAt && (now - prunedAt) < 60000) continue;
                snap[host] = { url: b.url, pinned: !!b.pinned, groupId: b.groupId ?? -1, groupTitle: b.groupTitle || '', groupColor: b.groupColor || 'grey' };
            } catch { /* skip malformed */ }
        }
        protectedSnapshot = snap;
        chrome.storage.local.set({ protectedSnapshot: snap }).catch(() => {});
    }, 500);
}

// Prune a host from the snapshot on deliberate close. Batch-safe: accumulates
// deletions across a synchronous burst of onRemoved events (e.g. Close Group)
// and writes once after the event loop settles, so racing get/set pairs don't
// let last-write-wins resurrect already-deleted hosts.
// Also marks the host recentlyPruned so persistProtectedSnapshot doesn't re-add
// it when Ghost Prevention reopens the tab ~100ms later.
let pruneTimer = null;
export function pruneProtectedHost(host) {
    delete protectedSnapshot[host];
    recentlyPruned.set(host, Date.now());
    if (pruneTimer) clearTimeout(pruneTimer);
    pruneTimer = setTimeout(() => {
        pruneTimer = null;
        chrome.storage.local.set({ protectedSnapshot }).catch(() => {});
    }, 150);
}

chrome.runtime.onSuspend.addListener(() => {
    if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
        chrome.storage.local.set({
            baselines: Object.fromEntries(memoryBaselines)
        }).catch(() => {});
    }
});

let loadPromise = null;
export async function ensureLoaded() {
    if (isInitialized) return;
    if (!loadPromise) {
        loadPromise = chrome.storage.local.get(['baselines', 'settings', 'vault', 'tabSets', 'savedPrompts', 'permMigrationDone', 'protectedSnapshot']).then(async (data) => {
            // Permission-refactor migration — runs inside the load critical
            // section so in-memory settings are correct BEFORE isInitialized
            // flips true. Without this, a concurrent palette search during SW
            // startup would read enablePomo=false etc. and miss results.
            // One-time per profile, guarded by permMigrationDone.
            let settings = data.settings || {};
            if (!data.permMigrationDone) {
                // Seed ALL optional-permission toggles on for existing users so
                // their experience is unchanged after the required→optional move.
                // We detect "existing user" conservatively: they must have stored
                // settings AND those settings must predate this refactor (i.e.
                // lack the new enableHistory key). A brand-new install has no
                // stored settings and keeps the lean DEFAULT_SETTINGS.
                const isPreRefactorUser = !!data.settings && !('enableHistory' in data.settings);
                if (isPreRefactorUser) {
                    const preserve = [
                        'enablePomo', 'enableMediaExtractor',
                        'enableHistory', 'enableBookmarks',
                        'enableRecentlyClosed', 'enablePanicClose'
                    ];
                    for (const key of preserve) settings[key] = true;
                    await chrome.storage.local.set({ settings, permMigrationDone: true }).catch(() => {});
                } else {
                    await chrome.storage.local.set({ permMigrationDone: true }).catch(() => {});
                }
            }
            Object.assign(globalSettings, settings);
            setSessionVault(data.vault || []);
            vaultCanonicalUrls.clear();
            for (const t of sessionVault) { vaultCanonicalUrls.add(getCanonicalUrl(t.url)); }
            setTabSets(data.tabSets || {});
            setSavedPrompts(data.savedPrompts || []);
            const stored = data.baselines || {};
            memoryBaselines.clear();
            for (const [key, value] of Object.entries(stored)) {
                memoryBaselines.set(parseInt(key, 10), value);
            }
            if (data.protectedSnapshot) protectedSnapshot = data.protectedSnapshot;
            setInitialized(true);
        });
    }
    return loadPromise;
}

export async function initializeState(isFreshStartup = false) {
    await ensureLoaded();
    if (isFreshStartup) {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);
        setSessionVault(sessionVault.filter(v => v.savedAt && v.savedAt > cutoff));
        vaultCanonicalUrls.clear();
        for (const t of sessionVault) { vaultCanonicalUrls.add(getCanonicalUrl(t.url)); }
    }

    const tabs = await chrome.tabs.query({});
    if (chrome.tabGroups) {
        try {
            const groups = await chrome.tabGroups.query({});
            groupCache.clear();
            groups.forEach(g => groupCache.set(g.id, { title: g.title, color: g.color }));
        } catch (e) {}
    }

    const currentActiveIds = new Set(tabs.map(t => t.id));
    let changed = false;

    // --- URL-FIRST RECONCILIATION ---
    // After a browser restart, Chrome reopens tabs at the same URLs but assigns
    // brand-new Tab IDs. Without this pass, all stored baselines would be
    // considered "orphaned" and deleted, wiping all protection data.
    //
    // Strategy: for each stored baseline whose old Tab ID is gone, check if any
    // living tab has the same canonical URL. If yes, re-bind the baseline data
    // to the new Tab ID so protection is fully preserved across restarts.
    const claimedNewIds = new Set(); // prevent double-binding two old baselines to the same new tab
    const liveTabsByCanonical = new Map();
    const liveTabsByDomain = new Map(); // hostname -> [tabs]
    for (const tab of tabs) {
        if (!currentActiveIds.has(tab.id)) continue;
        const canonical = getCanonicalUrl(tab.url || tab.pendingUrl);
        if (canonical && !liveTabsByCanonical.has(canonical)) {
            liveTabsByCanonical.set(canonical, tab);
        }
        try {
            const host = new URL(tab.url || tab.pendingUrl).hostname;
            if (host) {
                if (!liveTabsByDomain.has(host)) liveTabsByDomain.set(host, []);
                if (!liveTabsByDomain.get(host).some(t => t.id === tab.id)) {
                    liveTabsByDomain.get(host).push(tab);
                }
            }
        } catch {}
    }

    for (const [oldId, data] of memoryBaselines.entries()) {
        if (currentActiveIds.has(oldId)) continue; // Tab ID still alive, no action needed
        if (!data?.url) { memoryBaselines.delete(oldId); changed = true; continue; }

        const canonical = getCanonicalUrl(data.url);
        let matchingTab = liveTabsByCanonical.get(canonical);

        if (matchingTab && !claimedNewIds.has(matchingTab.id)) {
            // Re-bind the baseline to the new Tab ID — protection is preserved!
            memoryBaselines.delete(oldId);
            // Only re-bind if not already registered under the new ID
            if (!memoryBaselines.has(matchingTab.id)) {
                memoryBaselines.set(matchingTab.id, { ...data, windowId: matchingTab.windowId, index: matchingTab.index });
            }
            claimedNewIds.add(matchingTab.id);
            changed = true;
        } else {
            // Exact canonical match failed. Fallback: match by domain for pinned/grouped
            // baselines whose URL drifted (e.g., user was watching a video on a pinned
            // YouTube tab when the browser was closed — on restart Chrome reopens the
            // video URL, but the baseline is the homepage).
            let domainMatched = false;
            try {
                const baseHost = new URL(data.url).hostname;
                const sameHostTabs = liveTabsByDomain.get(baseHost);
                if (sameHostTabs) {
                    const candidates = sameHostTabs.filter(t => {
                        if (claimedNewIds.has(t.id)) return false;
                        if (data.pinned) return t.pinned;
                        if (data.groupId !== NONE_GROUP && data.groupTitle) {
                            if (t.groupId === NONE_GROUP) return false;
                            const g = groupCache.get(t.groupId);
                            return g && g.title === data.groupTitle;
                        }
                        return false;
                    });
                    if (candidates.length === 1) {
                        const matchTab = candidates[0];
                        memoryBaselines.delete(oldId);
                        if (!memoryBaselines.has(matchTab.id)) {
                            memoryBaselines.set(matchTab.id, { ...data, windowId: matchTab.windowId, index: matchTab.index });
                        }
                        claimedNewIds.add(matchTab.id);
                        changed = true;
                        domainMatched = true;
                    }
                }
            } catch {}
            if (domainMatched) continue;

            // Truly orphaned — tab is gone. Save to vault if not already there.
            if (!vaultCanonicalUrls.has(canonical)) {
                data.savedAt = Date.now();
                sessionVault.push(data);
                vaultCanonicalUrls.add(canonical);
            }
            memoryBaselines.delete(oldId);
            changed = true;
        }
    }

    for (const tab of tabs) {
        if (tab.discarded) discardedTabs.add(tab.id);
        if (processTab(tab)) changed = true;
    }
    if (changed) {
        chrome.storage.local.set({
            vault: sessionVault,
            baselines: Object.fromEntries(memoryBaselines)
        }).catch(() => {});
    }

    // --- STARTUP HIBERNATE ---
    // On a fresh browser open, all background tabs are loaded by Chrome by default,
    // consuming RAM immediately. We discard every non-active tab right after the
    // reconciliation pass so the browser opens light and fast.
    // Rules:
    //   - Skip the active tab in each window (user can see it)
    //   - Skip already-discarded tabs (nothing to do)
    //   - Skip chrome:// tabs (can't discard them anyway)
    if (isFreshStartup) {
        // Stagger discards slightly so Chrome doesn't choke on a bulk operation
        const toHibernate = tabs.filter(t =>
            !t.active &&
            !t.discarded &&
            t.url &&
            !t.url.startsWith('chrome://') &&
            !t.url.startsWith('chrome-extension://')
        );
        toHibernate.forEach((tab, i) => {
            setTimeout(() => {
                // safeHibernate resets protected tabs to their baseline URL before
                // discarding, so a restarted pinned/grouped tab wakes at its clean
                // home URL — not whatever page Chrome session-restored it onto.
                // (BUG-001) The discarded:true onUpdated listener handles
                // discardedTabs.add, so no manual tracking is needed here.
                safeHibernate(tab).catch(() => {});
            }, i * 50); // 50ms stagger between each discard
        });
    }
}

export function processTab(tab) {
    if (peekWindows.has(tab.windowId)) return false;

    const url = tab.url || tab.pendingUrl;
    if (url?.startsWith(NTP_URL) || url === 'chrome://newtab/') {
        // Treat Chrome's native NTP the same as our custom NTP: never create a
        // baseline for it. Without this, a tab pinned while showing
        // chrome://newtab/ becomes unrestorable (onRemoved's restore guard
        // rejects chrome:// URLs) and Ctrl+Shift+T loops back to our NTP via
        // the onUpdated redirect. Returning early lets processTab re-seed the
        // baseline with a real URL once the tab navigates.
        if (url === 'chrome://newtab/') return false;
        ntpTabCache.set(tab.windowId, tab.id);
        return false;
    }

    const isProtected = (globalSettings.protectPinned && tab.pinned) ||
        (globalSettings.protectGrouped && tab.groupId !== NONE_GROUP);

    let changed = false;
    const data = memoryBaselines.get(tab.id);

    if (isProtected) {
        const title = (tab.groupId !== NONE_GROUP && groupCache.has(tab.groupId)) ? groupCache.get(tab.groupId).title : '';
        const color = (tab.groupId !== NONE_GROUP && groupCache.has(tab.groupId)) ? groupCache.get(tab.groupId).color : 'grey';

        // URL IMMUTABILITY (BUG-005): once a baseline has a real URL, it NEVER
        // changes automatically — not on navigation, not on session restore.
        // Only the manual palette actions (update_baseline / set_baseline_url)
        // may rewrite it. This serves the core invariant: the URL a tab was
        // pinned/grouped at is the URL it always restores and hibernates to.
        //
        // A baseline URL may be seeded/upgraded only when:
        // 1. No baseline exists yet (first registration)
        // 2. The stored baseline is a chrome:// / chrome-extension:// placeholder
        //    (the tab was grouped before it navigated to a real page)
        // The previous isDomainRoot rule (which rewrote the baseline whenever a
        // pinned tab landed on the hostname root) is intentionally REMOVED: it
        // silently captured drifted session-restored URLs and self-reinforced
        // across restarts because processTab runs before safeHibernate.
        const storedIsPlaceholder = data && (data.url?.startsWith('chrome://') || data.url?.startsWith('chrome-extension://'));
        const urlMayChange = !data || storedIsPlaceholder;
        const finalUrl = urlMayChange ? url : data.url;

        // Write when seeding/upgrading the URL, or when any non-URL field changed.
        if (urlMayChange || data.pinned !== tab.pinned || data.groupId !== tab.groupId || data.index !== tab.index || data.windowId !== tab.windowId || data._lastMessagedProtection !== isProtected) {
            memoryBaselines.set(tab.id, { url: finalUrl, index: tab.index, windowId: tab.windowId, pinned: tab.pinned, groupId: tab.groupId, groupTitle: title, groupColor: color, _lastMessagedProtection: isProtected });
            changed = true;
            // Auto-persist to durable storage so a force-kill can be recovered
            // (memoryBaselines vanishes when the SW dies). No manual save needed.
            if (changed) persistProtectedSnapshot();
        }
    } else if (data) {
        const restoredAge = data._restoredAt ? (Date.now() - data._restoredAt) : Infinity;
        if (restoredAge > 2000 && !pendingEvictionIds.has(tab.id)) {
            pendingEvictionIds.add(tab.id);
            setTimeout(() => {
                chrome.tabs.get(tab.id, (currentTab) => {
                    pendingEvictionIds.delete(tab.id);
                    if (chrome.runtime.lastError || !currentTab) return;
                    const stored = memoryBaselines.get(tab.id);
                    if (!stored) return;
                    // Re-check _restoredAt: async group assignment may still be
                    // in flight even though processTab already flagged the tab.
                    const ageNow = stored._restoredAt ? (Date.now() - stored._restoredAt) : Infinity;
                    if (ageNow < 2000) return; // still within grace period — back off
                    // Evict when the tab is no longer protected under current settings,
                    // not merely when it's ungrouped/unpinned. This ensures toggling
                    // protectGrouped/protectPinned off actually releases baselines for
                    // tabs that are still grouped/pinned.
                    const stillProtected = (globalSettings.protectPinned && currentTab.pinned) ||
                        (globalSettings.protectGrouped && currentTab.groupId !== NONE_GROUP);
                    if (!stillProtected) {
                        memoryBaselines.delete(tab.id);
                        syncBaselinesToStorage();
                    }
                });
            }, 500);
        }
    }
    return changed;
}

export async function applyAutoGrouping(tab, retryCount = 0) {
    if (!tab.url) return;
    try {
        const win = await chrome.windows.get(tab.windowId);
        if (win.type !== 'normal') return;
    } catch (e) { return; }

    let matchedRule = null;
    try {
        const host = new URL(tab.url).hostname;
        matchedRule = findRuleByHost(host);
        if (!matchedRule && host.endsWith('.ai')) matchedRule = aiRule;
    } catch (e) { return; }

    if (!matchedRule) return;

    // Regrouping: an already-grouped tab that navigated to a new URL. Only
    // relocate when its current group is a Smart Group of a DIFFERENT category.
    //   - same category        → no-op (avoids thrash on in-category navigation)
    //   - manual/custom/unnamed → respect user intent, never fight it
    //   - different category    → fall through; chrome.tabs.group moves the tab
    // A tab belongs to exactly one group, so grouping it into the destination
    // group automatically removes it from the old one.
    if (tab.groupId !== NONE_GROUP) {
        const currentTitle = groupCache.get(tab.groupId)?.title;
        if (!currentTitle || !ruleTitles.has(currentTitle)) return;   // manual group
        if (currentTitle === matchedRule.title) return;               // same category
    }

    // Clear inheritance suppression — auto-grouping wins
    evictionGraveyard.delete(`inheritance_${tab.id}`);

    try {
        const groupKey = `${tab.windowId}|${matchedRule.title}`;
        
        if (autoGroupRegistry.has(groupKey)) {
            const existingGid = await autoGroupRegistry.get(groupKey);
            if (existingGid) {
                await chrome.tabs.group({ tabIds: tab.id, groupId: existingGid }).catch(() => {});
                return;
            }
        }

        const promise = (async () => {
            const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: matchedRule.title });
            const groupIdToUse = groups?.length > 0 ? groups[0].id : null;
            if (groupIdToUse !== null) {
                await chrome.tabs.group({ tabIds: tab.id, groupId: groupIdToUse });
                return groupIdToUse;
            } else {
                const gid = await chrome.tabs.group({ tabIds: tab.id });
                // Immediately populate cache so processTab (which might trigger on grouping) sees the name
                groupCache.set(gid, { title: matchedRule.title, color: matchedRule.color });
                await chrome.tabGroups.update(gid, { title: matchedRule.title, color: matchedRule.color });
                return gid;
            }
        })().catch(e => {
            const msg = e.message || '';
            if ((msg.includes('dragging') || msg.includes('edited right now')) && retryCount < 3) {
                setTimeout(() => { chrome.tabs.get(tab.id, (t) => { if (t) applyAutoGrouping(t, retryCount + 1); }); }, 400);
            }
            return null;
        });

        autoGroupRegistry.set(groupKey, promise);
        setTimeout(() => autoGroupRegistry.delete(groupKey), 5000);
        await promise;
    } catch (e) {
        // Fallback or ignore
    }
}

export function applyAutoCollapse(groupId, windowId) {
    if (!globalSettings.autoCollapseGroups || !chrome.tabGroups) return;
    chrome.tabs.query({ groupId }, (tabs) => {
        if (!tabs.length) return;
        if (tabs.every(t => t.discarded) && !tabs.some(t => t.active)) {
            chrome.tabGroups.update(groupId, { collapsed: true }).catch(() => {});
        }
    });
}

// NOTE: also invoked via the command palette ("Restore N protected tabs" →
// virtual:restore-vault routed through the open-url handler), so this stays live.
export async function restoreVault(vaultData) {
    if (!vaultData?.length) return false;
    for (const data of vaultData) {
        try {
            const newTab = await chrome.tabs.create({ url: data.url, pinned: data.pinned, active: false });
            memoryBaselines.set(newTab.id, { ...data, _restoredAt: Date.now() });
            if (data.groupId !== NONE_GROUP && chrome.tabGroups) {
                const groups = await chrome.tabGroups.query({ windowId: newTab.windowId, title: data.groupTitle });
                if (groups.length > 0) {
                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: groups[0].id });
                } else {
                    const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                    await chrome.tabGroups.update(gid, { title: data.groupTitle, color: data.groupColor });
                }
            }
            safeDiscard(newTab.id, null, data.url);
        } catch (e) {}
    }
    syncBaselinesToStorage(true);
    return true;
}

// Immediate eviction of baselines for tabs that are no longer protected under
// current settings. Called when protectPinned/protectGrouped is toggled OFF so
// those tabs close normally instead of being silently restored. Respects the
// 2s restore grace period so tabs mid-restore (group assignment in flight) are
// not evicted prematurely.
export async function evictUnprotectedBaselines() {
    const tabs = await chrome.tabs.query({});
    const tabMap = new Map(tabs.map(t => [t.id, t]));
    let changed = false;
    for (const [tabId, data] of memoryBaselines.entries()) {
        const tab = tabMap.get(tabId);
        if (!tab) {
            memoryBaselines.delete(tabId);
            changed = true;
            continue;
        }
        const stillProtected = (globalSettings.protectPinned && tab.pinned) ||
            (globalSettings.protectGrouped && tab.groupId !== NONE_GROUP);
        const restoredAge = data._restoredAt ? (Date.now() - data._restoredAt) : Infinity;
        if (!stillProtected && restoredAge > 2000) {
            memoryBaselines.delete(tabId);
            changed = true;
        }
    }
    if (changed) syncBaselinesToStorage();
}

// Symmetric counterpart to evictUnprotectedBaselines: when protectPinned or
// protectGrouped is toggled ON, register baselines for existing tabs that are
// now protected but don't have one yet. Without this, tabs that were already
// pinned/grouped before the toggle would only get a baseline on their next
// onUpdated event — meaning closing them before visiting/navigating would
// silently destroy them.
export async function registerProtectedBaselines() {
    const tabs = await chrome.tabs.query({});
    let changed = false;
    for (const tab of tabs) {
        if (peekWindows.has(tab.windowId)) continue;
        const url = tab.url || tab.pendingUrl || '';
        if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith(NTP_URL)) continue;

        const isProtected = (globalSettings.protectPinned && tab.pinned) ||
            (globalSettings.protectGrouped && tab.groupId !== NONE_GROUP);
        if (!isProtected) continue;
        if (memoryBaselines.has(tab.id)) continue; // already tracked

        const title = (tab.groupId !== NONE_GROUP && groupCache.has(tab.groupId)) ? groupCache.get(tab.groupId).title : '';
        const color = (tab.groupId !== NONE_GROUP && groupCache.has(tab.groupId)) ? groupCache.get(tab.groupId).color : 'grey';
        memoryBaselines.set(tab.id, {
            url, index: tab.index, windowId: tab.windowId,
            pinned: tab.pinned, groupId: tab.groupId,
            groupTitle: title, groupColor: color,
            _lastMessagedProtection: true
        });
        changed = true;
    }
    if (changed) syncBaselinesToStorage();
}
