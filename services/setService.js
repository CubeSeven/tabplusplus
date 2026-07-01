import { tabSets, launchingWindowIds, incrementPendingLaunches, decrementPendingLaunches } from '../state.js';
import { syncSetsToStorage, ensureLoaded } from './tabService.js';
import { NONE_GROUP } from '../constants.js';
import { safeDiscard, getCanonicalUrl } from '../utils.js';

// ────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES — Single source of truth for group resolution and tab
// creation logic. Both Launch and Summon use these, eliminating the
// copy-pasted code paths that caused inconsistent behavior.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Finds an existing group by title (globally) or creates a new one.
 * Returns the resolved group ID, or null on failure.
 *
 * @param {string}   title           - Group title to search/create
 * @param {string}   color           - Group color fallback
 * @param {number}   tabId           - First tab to seed the group with
 * @param {number}   windowId        - Target window
 * @param {Array}    allGlobalGroups - Pre-fetched snapshot of all browser groups
 * @param {Object}   groupMap        - Title-keyed cache of already-resolved groups
 * @returns {Promise<number|null>}   - Resolved group ID
 */
async function resolveOrCreateGroup(title, color, tabId, windowId, allGlobalGroups, groupMap) {
    const titleKey = (title || '').trim().toLowerCase();

    // Already resolved in this operation — just add to existing group
    if (groupMap[titleKey] != null) {
        await chrome.tabs.group({ tabIds: [tabId], groupId: groupMap[titleKey] }).catch(() => {});
        return groupMap[titleKey];
    }

    // Search globally by title
    const uniqueTitle = (title || '').trim();
    const match = uniqueTitle
        ? allGlobalGroups.find(g => (g.title || '').trim() === uniqueTitle)
        : null;

    if (match) {
        // Move existing group to target window if needed
        if (match.windowId !== windowId) {
            await chrome.tabGroups.move(match.id, { windowId, index: -1 }).catch(() => {});
            match.windowId = windowId; // Prevent re-moving in future loop iterations
        }
        if (color) {
            await chrome.tabGroups.update(match.id, { color }).catch(() => {});
        }
        await chrome.tabs.group({ tabIds: [tabId], groupId: match.id }).catch(() => {});
        groupMap[titleKey] = match.id;
        return match.id;
    }

    // No match — create fresh group
    const gid = await chrome.tabs.group({ tabIds: [tabId] }).catch(() => null);
    if (gid != null) {
        await chrome.tabGroups.update(gid, { title: uniqueTitle, color: color || 'grey' }).catch(() => {});
        groupMap[titleKey] = gid;
    }
    return gid;
}

/**
 * Creates tabs from a set definition into a target window.
 * Pinned tabs are always created first (Chrome requires this ordering).
 * Grouped tabs are assigned via the shared resolveOrCreateGroup util.
 *
 * @param {Array}   tabDefs          - Tab definitions from the set
 * @param {number}  windowId         - Target window ID
 * @param {Object}  [opts]           - Options
 * @param {boolean} [opts.dedupe]    - If true, skip creation for existing matching tabs
 * @returns {Promise<{managedTabIds: Set, groupMap: Object}>}
 */
export async function materializeTabs(tabDefs, windowId, opts = {}) {
    const { dedupe = false } = opts;
    const groupMap = {};
    const managedTabIds = new Set();
    const tabsToDiscard = [];

    // Pre-fetch browser state once
    const allGlobalGroups = chrome.tabGroups ? await chrome.tabGroups.query({}).catch(() => []) : [];
    // Index open tabs by canonical URL once, so dedupe lookups are O(matching
    // candidates) instead of O(all open tabs) per tab-def. With a 100-tab set
    // landing into a window of 100+ tabs, this turns O(N×M) into ~O(M).
    let tabsByCanonical = null;
    if (dedupe) {
        const allTabs = await chrome.tabs.query({});
        tabsByCanonical = new Map();
        for (const t of allTabs) {
            const c = getCanonicalUrl(t.url);
            const arr = tabsByCanonical.get(c);
            if (arr) arr.push(t); else tabsByCanonical.set(c, [t]);
        }
    }

    // Split into pinned and unpinned. Chrome requires pinned tabs before unpinned.
    const pinnedDefs = tabDefs.filter(d => d.pinned);
    const unpinnedDefs = tabDefs.filter(d => !d.pinned);

    // --- Phase 1: Create pinned tabs sequentially (order matters) ---
    for (const data of pinnedDefs) {
        const { tab, isNew } = await createOrClaimTab(data, windowId, dedupe, tabsByCanonical, allGlobalGroups);
        managedTabIds.add(tab.id);
        if (isNew && !data.active) tabsToDiscard.push(tab.id);
    }

    // --- Phase 2: Create unpinned tabs concurrently (order doesn't matter) ---
    const unpinnedResults = await Promise.all(
        unpinnedDefs.map(data => createOrClaimTab(data, windowId, dedupe, tabsByCanonical, allGlobalGroups))
    );

    // --- Phase 3: Apply grouping sequentially (Chrome API limitation) ---
    for (let i = 0; i < unpinnedDefs.length; i++) {
        const data = unpinnedDefs[i];
        const { tab, isNew } = unpinnedResults[i];
        managedTabIds.add(tab.id);

        if (data.groupId !== -1 && chrome.tabGroups) {
            await resolveOrCreateGroup(
                data.groupTitle, data.groupColor,
                tab.id, windowId,
                allGlobalGroups, groupMap
            );
        }

        if (isNew && !data.active) tabsToDiscard.push(tab.id);
    }

    // --- Phase 4: Discard all background tabs AFTER creation + grouping ---
    // Deferring discards ensures Chrome has committed URLs before discarding,
    // preventing about:blank or stuck-loading tabs.
    for (const tabId of tabsToDiscard) {
        safeDiscard(tabId);
    }

    return { managedTabIds, groupMap };
}

/**
 * Creates a tab or claims an existing matching one (for deduplication).
 * `tabsByCanonical` is a Map<canonicalUrl, tab[]> built once in materializeTabs;
 * claimed tabs are spliced out of their per-URL array so they can't be claimed
 * twice by duplicate tab-defs in the same set.
 */
async function createOrClaimTab(data, windowId, dedupe, tabsByCanonical, allGlobalGroups) {
    if (dedupe) {
        const canonicalUrl = getCanonicalUrl(data.url);
        const candidates = tabsByCanonical?.get(canonicalUrl);
        let match = null;

        if (candidates && candidates.length) {
            if (data.pinned) {
                match = candidates.find(t => t.pinned && t.windowId === windowId);
            } else if (data.groupId !== -1) {
                const targetTitle = (data.groupTitle || '').trim().toLowerCase();
                match = candidates.find(t => {
                    if (t.groupId !== NONE_GROUP) {
                        const g = allGlobalGroups.find(group => group.id === t.groupId);
                        const gTitle = g ? (g.title || '').trim().toLowerCase() : '';
                        return gTitle === targetTitle;
                    }
                    return false;
                });
            } else {
                match = candidates.find(t => !t.pinned && t.groupId === NONE_GROUP && t.windowId === windowId);
            }
        }

        if (match) {
            // Remove the matched tab so we don't reuse it for multiple identical duplicate tabs in the set
            const index = candidates.indexOf(match);
            if (index > -1) candidates.splice(index, 1);
            return { tab: match, isNew: false };
        }
    }

    const tab = await chrome.tabs.create({
        url: data.url,
        pinned: data.pinned,
        windowId,
        active: data.active || false
    });
    return { tab, isNew: true };
}

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Shared new-window launch boilerplate: acquires the window-launch lock,
 * creates an empty window, materializes the given tab defs into it, then
 * removes the seed NTP tab. Consumed by performLaunchSet (sets) and
 * bookmarkService (bookmarks) so the lock/seed-tab dance has exactly one
 * implementation. Callers are responsible for any tab-count cap beforehand.
 *
 * @param {Array} tabDefs - already-prepared (and capped, if needed) tab defs
 * @returns {Promise<boolean>} success
 */
export async function launchInNewWindow(tabDefs) {
    if (!tabDefs || tabDefs.length === 0) return false;

    // --- WINDOW LAUNCH LOCK ---
    // Increment BEFORE chrome.windows.create so the windows.onCreated listener
    // in background.js sees pendingLaunches > 0 and claims the new window ID
    // into launchingWindowIds. Because onCreated fires strictly before any
    // onUpdated tab events, the auto-grouping engine will never run inside
    // this window — regardless of how fast the browser creates the tabs.
    incrementPendingLaunches();

    let newWin;
    try {
        // Create an EMPTY window first to get the Window ID BEFORE any real
        // tabs exist, closing the race condition completely.
        newWin = await chrome.windows.create({ focused: true });
        if (newWin?.id) launchingWindowIds.add(newWin.id);

        const windowId = newWin.id;

        // Track the initial empty NTP tab by ID — not by index position.
        // Promise.all tab creation means Chrome doesn't guarantee ordering,
        // so we can't rely on initialTabs[0] being the NTP.
        const ntpTabId = newWin.tabs?.[0]?.id ?? null;

        await materializeTabs(tabDefs, windowId);

        if (ntpTabId != null) {
            chrome.tabs.remove(ntpTabId).catch(() => {});
        }

    } catch (e) {
        console.warn('[Tabs++] launchInNewWindow error:', e.message);
        return false;
    } finally {
        // Release lock immediately — operation is done (or failed).
        decrementPendingLaunches();
        if (newWin?.id) launchingWindowIds.delete(newWin.id);
    }

    return true;
}

export async function performSaveSet(request) {
    await ensureLoaded();
    const tabs = await chrome.tabs.query({ windowId: request.windowId || chrome.windows.WINDOW_ID_CURRENT });
    const protectedTabs = [];

    // Pre-fetch all groups once instead of N individual API calls
    const allGroups = chrome.tabGroups ? await chrome.tabGroups.query({}).catch(() => []) : [];
    const groupLookup = new Map(allGroups.map(g => [g.id, g]));

    for (const t of tabs) {
        let shouldSave = false;
        if (request.setType === 'group') {
            shouldSave = t.groupId === request.groupId;
        } else if (request.setType === 'all') {
            shouldSave = true;
        } else {
            shouldSave = t.pinned || t.groupId !== NONE_GROUP;
        }

        if (shouldSave) {
            const tabData = { url: t.url, pinned: t.pinned, groupId: t.groupId !== NONE_GROUP ? t.groupId : -1 };
            if (t.groupId !== NONE_GROUP) {
                const g = groupLookup.get(t.groupId);
                if (g) {
                    tabData.groupTitle = g.title;
                    tabData.groupColor = g.color;
                }
            }
            protectedTabs.push(tabData);
        }
    }

    tabSets[request.name] = { type: request.setType || 'workspace', tabs: protectedTabs };
    syncSetsToStorage();
    return tabSets;
}

export async function performLaunchSet(name) {
    await ensureLoaded();
    const setObj = tabSets[name];
    if (!setObj?.tabs?.length) return false;
    return launchInNewWindow(setObj.tabs);
}

export async function performSummonSet(name, windowId) {
    await ensureLoaded();
    const setObj = tabSets[name];
    if (!setObj?.tabs?.length) return { success: false, claimedGroupIds: [], claimedTabIds: [] };

    let targetWinId = windowId;
    if (!targetWinId || targetWinId === chrome.windows.WINDOW_ID_CURRENT) {
        try {
            const currentWin = await chrome.windows.getCurrent();
            targetWinId = currentWin.id;
        } catch (e) {
            targetWinId = chrome.windows.WINDOW_ID_CURRENT;
        }
    }

    launchingWindowIds.add(targetWinId);

    try {
        // Summon uses deduplication to avoid duplicating existing pinned/grouped tabs
        const { managedTabIds, groupMap } = await materializeTabs(setObj.tabs, targetWinId, { dedupe: true });

        return {
            success: true,
            claimedGroupIds: Object.values(groupMap),
            claimedTabIds: Array.from(managedTabIds)
        };
    } catch (e) {
        console.warn('[Tabs++] performSummonSet error:', e.message);
        return { success: false, claimedGroupIds: [], claimedTabIds: [] };
    } finally {
        // Release lock immediately — no timer guesswork.
        launchingWindowIds.delete(targetWinId);
    }
}

export async function performDeleteSet(name) {
    await ensureLoaded();
    delete tabSets[name];
    syncSetsToStorage();
    return tabSets;
}

export async function performReplaceSet(name, windowId) {
    await ensureLoaded();
    const setObj = tabSets[name];
    if (!setObj?.tabs?.length) return false;

    let targetWinId = windowId;
    if (!targetWinId || targetWinId === chrome.windows.WINDOW_ID_CURRENT) {
        try {
            const currentWin = await chrome.windows.getCurrent();
            targetWinId = currentWin.id;
        } catch (e) {
            targetWinId = chrome.windows.WINDOW_ID_CURRENT;
        }
    }

    // Lock the window BEFORE querying old tabs — prevents the auto-grouping
    // engine from interfering during the entire replace operation.
    launchingWindowIds.add(targetWinId);

    try {
        // 1. Snapshot current tabs so we can nuke them after summon
        const oldTabs = await chrome.tabs.query({ windowId: targetWinId });

        // 2. Summon the set into this window (it inherits our lock)
        const summonResult = await performSummonSet(name, targetWinId);
        if (!summonResult?.success) return false;

        const claimedGroupIds = new Set(summonResult.claimedGroupIds);
        const claimedTabIds = new Set(summonResult.claimedTabIds || []);

        // 3. Re-query tabs — groupIds may have changed due to group merging
        const currentTabsAfterSummon = await chrome.tabs.query({ windowId: targetWinId });
        const oldTabIds = [];

        for (const tab of oldTabs) {
            const currentState = currentTabsAfterSummon.find(t => t.id === tab.id);
            if (!currentState) continue; // Already gone

            // If summon directly owns this tab (claimed existing or newly created), KEEP
            if (claimedTabIds.has(tab.id)) continue;

            // If the tab was pulled into a claimed group, KEEP
            if (currentState.groupId !== NONE_GROUP && claimedGroupIds.has(currentState.groupId)) continue;

            // Ungroup before removing to prevent Chrome from auto-focusing group siblings
            if (currentState.groupId !== NONE_GROUP && chrome.tabGroups) {
                await chrome.tabs.ungroup(tab.id).catch(() => {});
            }
            oldTabIds.push(tab.id);
        }

        // 4. Nuke old tabs
        if (oldTabIds.length > 0) {
            await chrome.tabs.remove(oldTabIds).catch(() => {});
        }

        return true;
    } finally {
        // Release the lock. performSummonSet's finally already deleted it once,
        // but we re-add it at the top of this function, so we must clean up.
        launchingWindowIds.delete(targetWinId);
    }
}
