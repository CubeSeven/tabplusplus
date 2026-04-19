import { memoryBaselines, globalSettings, sessionVault, tabSets, groupCache, setInitialized, setSessionVault, setLastSession, setTabSets, isInitialized, ntpTabCache, evictionGraveyard, peekWindows } from '../state.js';
import { getCanonicalUrl, safeDiscard } from '../utils.js';
import { NONE_GROUP, GROUPING_RULES, NTP_URL } from '../constants.js';

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
        chrome.storage.local.set({ baselines: Object.fromEntries(memoryBaselines) });
        saveSnapshot();
        return;
    }
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        chrome.storage.local.set({ baselines: Object.fromEntries(memoryBaselines) });
        saveSnapshot();
    }, 1000);
}

export function saveSnapshot() {
    chrome.storage.local.set({ lastSession: Array.from(memoryBaselines.values()) });
}

let loadPromise = null;
export async function ensureLoaded() {
    if (isInitialized) return;
    if (!loadPromise) {
        loadPromise = chrome.storage.local.get(['baselines', 'settings', 'vault', 'lastSession', 'tabSets']).then((data) => {
            if (data.settings) Object.assign(globalSettings, data.settings);
            setSessionVault(data.vault || []);
            setLastSession(data.lastSession || []);
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
    const currentUrls = new Set(tabs.map(t => getCanonicalUrl(t.url || t.pendingUrl)));
    let changed = false;

    for (const [id, data] of memoryBaselines.entries()) {
        if (!currentActiveIds.has(id)) {
            if (data?.url) {
                const canonical = getCanonicalUrl(data.url);
                if (!currentUrls.has(canonical) && !sessionVault.some(t => getCanonicalUrl(t.url) === canonical)) {
                    data.savedAt = Date.now();
                    sessionVault.push(data);
                    changed = true;
                }
            }
            memoryBaselines.delete(id);
            changed = true;
        }
    }

    if (changed) syncVaultToStorage();
    for (const tab of tabs) { if (processTab(tab)) changed = true; }
    if (changed) syncBaselinesToStorage();
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

    // Only message non-discarded, non-chrome tabs
    if (url && !url.startsWith('chrome') && !tab.discarded) {
        chrome.tabs.sendMessage(tab.id, { action: 'update-tab-status', isProtected }).catch(() => {});
    }

    let changed = false;
    const data = memoryBaselines.get(tab.id);

    if (isProtected) {
        const title = (tab.groupId !== NONE_GROUP && groupCache.has(tab.groupId)) ? groupCache.get(tab.groupId).title : '';
        const color = (tab.groupId !== NONE_GROUP && groupCache.has(tab.groupId)) ? groupCache.get(tab.groupId).color : 'grey';

        if (!data || data.url !== url || data.pinned !== tab.pinned || data.groupId !== tab.groupId || data.index !== tab.index || data.windowId !== tab.windowId) {
            memoryBaselines.set(tab.id, { url, index: tab.index, windowId: tab.windowId, pinned: tab.pinned, groupId: tab.groupId, groupTitle: title, groupColor: color });
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
        matchedRule = GROUPING_RULES.find(rule => rule.domains.some(d => host === d || host.endsWith('.' + d)));
        if (!matchedRule && host.endsWith('.ai')) matchedRule = GROUPING_RULES.find(r => r.title === 'AI');
    } catch (e) { return; }

    if (!matchedRule) return;
    // Clear inheritance suppression — auto-grouping wins
    evictionGraveyard.delete(`inheritance_${tab.id}`);

    try {
        const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: matchedRule.title });
        const groupIdToUse = groups?.length > 0 ? groups[0].id : null;
        if (groupIdToUse !== null) {
            await chrome.tabs.group({ tabIds: tab.id, groupId: groupIdToUse });
        } else {
            const gid = await chrome.tabs.group({ tabIds: tab.id });
            await chrome.tabGroups.update(gid, { title: matchedRule.title, color: matchedRule.color });
        }
    } catch (e) {
        const msg = e.message || '';
        if ((msg.includes('dragging') || msg.includes('edited right now')) && retryCount < 3) {
            setTimeout(() => { chrome.tabs.get(tab.id, (t) => { if (t) applyAutoGrouping(t, retryCount + 1); }); }, 400);
        }
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
