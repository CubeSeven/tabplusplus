import { memoryBaselines, globalSettings, sessionVault, vaultCanonicalUrls, tabSets, groupCache, setInitialized, setSessionVault, setTabSets, isInitialized, ntpTabCache, evictionGraveyard, peekWindows, autoGroupRegistry, discardedTabs } from '../state.js';
import { getCanonicalUrl, safeDiscard } from '../utils.js';
import { NONE_GROUP, GROUPING_RULES, NTP_URL } from '../constants.js';

const domainRuleMap = new Map();
for (const rule of GROUPING_RULES) {
    for (const d of rule.domains) {
        domainRuleMap.set(d, rule);
    }
}
const aiRule = GROUPING_RULES.find(r => r.title === 'AI');

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

export async function safeHibernate(tab) {
    if (tab.discarded) return;
    const baseline = memoryBaselines.get(tab.id);
    if (baseline && baseline.url && (tab.pinned || baseline.groupId !== NONE_GROUP)) {
        const currentUrl = tab.pendingUrl || tab.url;
        if (currentUrl !== baseline.url) {
            await chrome.tabs.update(tab.id, { url: baseline.url });
        }
    }
    safeDiscard(tab.id);
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
    chrome.storage.local.set({ vault: sessionVault });
}

export function syncSetsToStorage() {
    chrome.storage.local.set({ tabSets: tabSets });
}

let syncTimeout = null;
export function syncBaselinesToStorage(force = false) {
    if (force) {
        if (syncTimeout) clearTimeout(syncTimeout);
        chrome.storage.local.set({
            baselines: Object.fromEntries(memoryBaselines),
            lastSession: Array.from(memoryBaselines.values())
        });
        return;
    }
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        chrome.storage.local.set({
            baselines: Object.fromEntries(memoryBaselines),
            lastSession: Array.from(memoryBaselines.values())
        });
    }, 2000);
}

export function saveSnapshot() {
    chrome.storage.local.set({ lastSession: Array.from(memoryBaselines.values()) });
}

chrome.runtime.onSuspend.addListener(() => {
    if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
        chrome.storage.local.set({
            baselines: Object.fromEntries(memoryBaselines),
            lastSession: Array.from(memoryBaselines.values())
        });
    }
});

let loadPromise = null;
export async function ensureLoaded() {
    if (isInitialized) return;
    if (!loadPromise) {
        loadPromise = chrome.storage.local.get(['baselines', 'settings', 'vault', 'tabSets']).then((data) => {
            if (data.settings) Object.assign(globalSettings, data.settings);
            setSessionVault(data.vault || []);
            vaultCanonicalUrls.clear();
            for (const t of sessionVault) { vaultCanonicalUrls.add(getCanonicalUrl(t.url)); }
            setTabSets(data.tabSets || {});
            const stored = data.baselines || {};
            memoryBaselines.clear();
            for (const [key, value] of Object.entries(stored)) {
                memoryBaselines.set(parseInt(key, 10), value);
            }
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
    for (const tab of tabs) {
        if (!currentActiveIds.has(tab.id)) continue;
        const canonical = getCanonicalUrl(tab.url || tab.pendingUrl);
        if (canonical && !liveTabsByCanonical.has(canonical)) {
            liveTabsByCanonical.set(canonical, tab);
        }
    }

    for (const [oldId, data] of memoryBaselines.entries()) {
        if (currentActiveIds.has(oldId)) continue; // Tab ID still alive, no action needed
        if (!data?.url) { memoryBaselines.delete(oldId); changed = true; continue; }

        const canonical = getCanonicalUrl(data.url);
        const matchingTab = liveTabsByCanonical.get(canonical);

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
            // Truly orphaned — tab is gone. Save to vault if not already there.
            // Use groupTitle as a secondary key so two different groups with the same
            // URL (e.g., two YouTube tabs in different groups) are both preserved.
            const vaultKey = `${canonical}|${data.groupTitle || ''}`;
            const alreadyInVault = sessionVault.some(t =>
                getCanonicalUrl(t.url) === canonical && (t.groupTitle || '') === (data.groupTitle || '')
            );
            if (!alreadyInVault) {
                data.savedAt = Date.now();
                sessionVault.push(data);
            }
            memoryBaselines.delete(oldId);
            changed = true;
        }
    }

    if (changed) syncVaultToStorage();
    for (const tab of tabs) {
        if (tab.discarded) discardedTabs.add(tab.id);
        if (processTab(tab)) changed = true;
    }
    if (changed) syncBaselinesToStorage();

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
                chrome.tabs.discard(tab.id).then(() => {
                    discardedTabs.add(tab.id);
                }).catch(() => {});
            }, i * 50); // 50ms stagger between each discard
        });
    }
}

export function processTab(tab) {
    if (peekWindows.has(tab.windowId)) return false;

    const url = tab.url || tab.pendingUrl;
    if (url?.startsWith(NTP_URL)) {
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

        const isUrlDiff = data && data.url !== url;
        // Allow URL update only when:
        // 1. No baseline exists yet (first registration)
        // 2. The stored baseline is a chrome:// placeholder (tab was grouped before it navigated)
        const storedIsPlaceholder = data && (data.url?.startsWith('chrome://') || data.url?.startsWith('chrome-extension://'));
        const autoUpdateUrl = !data || storedIsPlaceholder;

        if (!data || (isUrlDiff && autoUpdateUrl) || data.pinned !== tab.pinned || data.groupId !== tab.groupId || data.index !== tab.index || data.windowId !== tab.windowId || data._lastMessagedProtection !== isProtected) {
            const finalUrl = autoUpdateUrl ? url : (data ? data.url : url);
            memoryBaselines.set(tab.id, { url: finalUrl, index: tab.index, windowId: tab.windowId, pinned: tab.pinned, groupId: tab.groupId, groupTitle: title, groupColor: color, _lastMessagedProtection: isProtected });
            changed = true;
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
                    if (!currentTab.pinned && currentTab.groupId === NONE_GROUP) {
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
            safeDiscard(newTab.id);
        } catch (e) {}
    }
    syncBaselinesToStorage(true);
    return true;
}
