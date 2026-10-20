// Mirrors long-lived volatile SW state to chrome.storage.session so the
// guards survive MV3 service-worker death (~30s idle). storage.session
// auto-clears on browser close — exactly the lifetime this state needs.
//
// Deliberately NOT mirrored (seconds-scale TTL guards — restoring them would
// fire stale guards): recentlyAwakened, pendingFocusGuardWindowIds,
// launchingWindowIds, pendingLaunches. groupCache is rebuildable from a live
// query and skipped.
//
// state.js stays pure (AGENTS.md #13): all chrome.* access lives here.
import { lastActiveTabId, setLastActiveTabId, peekWindows, blurredSourceTabs, ntpTabCache, pomoTimer, setPomoTimer, discardedTabs, bookmarkWindowId, setBookmarkWindowId } from '../state.js';

const KEY = 'swState';
let lastSnapshotJson = '';

export async function restoreSessionState() {
    if (!chrome.storage.session) return; // Chrome <102: degrade to old behavior
    const data = await chrome.storage.session.get(KEY).catch(() => ({}));
    const s = data && data[KEY];
    if (!s) return;
    if (typeof s.lastActiveTabId === 'number') setLastActiveTabId(s.lastActiveTabId);
    if (s.pomoTimer) setPomoTimer(s.pomoTimer);
    if (typeof s.bookmarkWindowId === 'number') setBookmarkWindowId(s.bookmarkWindowId);
    for (const [k, v] of s.peekWindows || []) peekWindows.set(k, v);
    for (const [k, v] of s.ntpTabCache || []) ntpTabCache.set(k, v);
    (s.discardedTabs || []).forEach(v => discardedTabs.add(v));
    (s.blurredSourceTabs || []).forEach(v => blurredSourceTabs.add(v));

    // Prune stale ids against live tabs/windows so restored state can't
    // reference things that closed while the SW was dead.
    const [tabs, wins] = await Promise.all([
        chrome.tabs.query({}).catch(() => []),
        chrome.windows.getAll().catch(() => []),
    ]);
    const liveTabIds = new Set(tabs.map(t => t.id));
    const liveWinIds = new Set(wins.map(w => w.id));
    for (const winId of [...peekWindows.keys()]) if (!liveWinIds.has(winId)) peekWindows.delete(winId);
    for (const [winId, tabId] of [...ntpTabCache.entries()]) if (!liveWinIds.has(winId) || !liveTabIds.has(tabId)) ntpTabCache.delete(winId);
    for (const tabId of [...discardedTabs]) if (!liveTabIds.has(tabId)) discardedTabs.delete(tabId);
    for (const tabId of [...blurredSourceTabs]) if (!liveTabIds.has(tabId)) blurredSourceTabs.delete(tabId);
    if (bookmarkWindowId !== null && !liveWinIds.has(bookmarkWindowId)) setBookmarkWindowId(null);
}

export function persistSessionState() {
    if (!chrome.storage.session) return;
    const snapshot = {
        lastActiveTabId,
        pomoTimer,
        bookmarkWindowId,
        peekWindows: [...peekWindows.entries()],
        ntpTabCache: [...ntpTabCache.entries()],
        discardedTabs: [...discardedTabs],
        blurredSourceTabs: [...blurredSourceTabs],
    };
    const json = JSON.stringify(snapshot);
    if (json === lastSnapshotJson) return; // memoized — skip no-op writes
    lastSnapshotJson = json;
    chrome.storage.session.set({ [KEY]: snapshot }).catch(() => { lastSnapshotJson = ''; });
}
