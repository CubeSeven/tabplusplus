import { launchingWindowIds, globalSettings, bookmarkWindowId, setBookmarkWindowId } from '../state.js';
import { ensureLoaded } from './tabService.js';
import { getCanonicalUrl } from '../utils.js';
import { materializeTabs, launchInNewWindow } from './setService.js';

// Chrome's nine valid tab-group colors, in a stable order. Used to deterministically
// assign a color to a subfolder-derived group so the same folder always lands on
// the same color across launches.

// Hard cap on tabs a single bookmark launch will open. materializeTabs creates
// unpinned tabs concurrently via Promise.all, so opening hundreds at once
// freezes Chrome. 100 keeps launches responsive while still covering realistic
// "open my bookmarks" use cases.
const BOOKMARK_TAB_CAP = 100;

// Sentinel marking a tab def that SHOULD be grouped. materializeTabs treats any
// groupId !== -1 as "group this tab"; the actual group is resolved afterwards by
// groupTitle/groupColor.
const PENDING_GROUP = 0;

/**
 * Deterministically picks one of Chrome's tab-group colors from a string.
 * Same title → same color on every launch, so folders feel stable.
 */
// Neutral by default: bookmark groups are created grey (Chrome's "uncolored"
// look — there is no white) and keep the user's manual recolor forever via
// the groupColorOverrides map, which the tabGroups.onUpdated listener fills.
function colorForTitle(title) {
    const key = (title || '').trim();
    if (!key) return '';
    return globalSettings.groupColorOverrides?.[key] || '';
}

/**
 * Recursively gathers every URL node beneath a node. Non-http(s) schemes are
 * filtered (javascript:/chrome:/file: would crash chrome.tabs.create).
 */
function collectLeafUrls(node, out = []) {
    for (const child of node.children || []) {
        if (child.url) {
            if (/^https?:/i.test(child.url)) out.push({ url: child.url, title: child.title || '' });
        } else if (child.children) {
            collectLeafUrls(child, out);
        }
    }
    return out;
}

/**
 * Converts a bookmark folder node into the tabDef shape consumed by
 * materializeTabs. Every bookmark in the folder (loose or nested in any
 * subfolder) becomes a tab grouped under a single Chrome tab group named after
 * the folder itself, UNLESS its title starts with "!", in which case it is pinned.
 */
function folderToTabDefs(folderNode) {
    const leaves = collectLeafUrls(folderNode);
    if (leaves.length === 0) return [];
    const groupTitle = (folderNode.title || '').trim() || 'Bookmarks';
    const groupColor = colorForTitle(groupTitle);
    return leaves.map(leaf => {
        const isPinned = leaf.title.startsWith('!');
        return {
            url: leaf.url,
            pinned: isPinned,
            groupId: isPinned ? -1 : PENDING_GROUP,
            groupTitle: isPinned ? '' : groupTitle,
            groupColor: isPinned ? '' : groupColor
        };
    });
}

/**
 * Inserts a bookmark folder's tabs into the CURRENT window, all grouped under a
 * single Chrome tab group named after the folder. Dedupes against already-open
 * tabs so bookmarks you already have open aren't duplicated. Mirrors the
 * Summon-Set behavior. Honors BOOKMARK_TAB_CAP to keep the browser responsive on
 * large folders.
 *
 * @param {string} folderId - Bookmark node id of the folder to insert
 * @returns {Promise<boolean>} success
 */
export async function performLaunchBookmarkFolder(folderId) {
    await ensureLoaded();

    const nodes = await chrome.bookmarks.getSubTree(String(folderId)).catch(() => null);
    const folderNode = nodes && nodes[0];
    if (!folderNode) return false;

    const tabDefs = folderToTabDefs(folderNode);
    return summonIntoCurrentWindow(tabDefs);
}

/**
 * Opens EVERY bookmark in one window. Walks the whole bookmark tree and treats
 * each user-created folder as a tab group, so "Insert All Bookmarks" yields a
 * single window whose groups mirror the user's folder organization.
 * Loose bookmarks (not in any folder) are grouped under their parent root
 * ("Bookmarks Bar", etc.). Hard-capped at BOOKMARK_TAB_CAP in tree order
 * to stay within what Chrome can open without freezing.
 *
 * @returns {Promise<boolean>} success
 */
export async function performLaunchAllBookmarks() {
    await ensureLoaded();
    const tabDefs = await collectAllBookmarkTabDefs();
    return launchBookmarksInNewWindow(tabDefs);
}

// Manual palette action: same as performLaunchAllBookmarks but into the
// CURRENT window (deduped against everything already open).
export async function performLaunchAllBookmarksHere() {
    await ensureLoaded();
    if (!(await bookmarksPermitted())) return false;
    const tabDefs = await collectAllBookmarkTabDefs();
    if (tabDefs.length === 0) return false;
    const win = await chrome.windows.getCurrent().catch(() => null);
    if (!win) return false;
    const open = new Set((await chrome.tabs.query({}).catch(() => [])).map(t => getCanonicalUrl(t.url)));
    const missing = tabDefs.filter(d => !open.has(getCanonicalUrl(d.url)));
    if (missing.length === 0) return false;
    launchingWindowIds.add(win.id);
    try {
        await materializeTabs(missing.slice(0, BOOKMARK_TAB_CAP), win.id, { dedupe: true });
        setBookmarkWindowId(win.id);
        return true;
    } catch (e) {
        console.warn('[Tabs++] bookmark launch-here error:', e.message);
        return false;
    } finally {
        launchingWindowIds.delete(win.id);
    }
}

async function collectAllBookmarkTabDefs() {
    const tree = await chrome.bookmarks.getTree().catch(() => null);
    const root = tree && tree[0];
    if (!root) return [];

    // The bookmark tree's root node is virtual; its children are the real roots
    // (Bookmarks Bar, Other Bookmarks, Mobile). Walk into each root's children
    // so every user-created folder becomes its own tab group.
    const tabDefs = [];
    for (const topRoot of root.children || []) {
        const rootTitle = (topRoot.title || '').trim() || 'Bookmarks';
        const rootColor = colorForTitle(rootTitle);

        for (const child of topRoot.children || []) {
            if (child.url) {
                // Loose bookmark (not in a folder) — group under the parent root
                if (/^https?:/i.test(child.url)) {
                    const isPinned = (child.title || '').startsWith('!');
                    tabDefs.push({ 
                        url: child.url, 
                        pinned: isPinned, 
                        groupId: isPinned ? -1 : PENDING_GROUP, 
                        groupTitle: isPinned ? '' : rootTitle, 
                        groupColor: isPinned ? '' : rootColor 
                    });
                }
            } else if (child.children) {
                // User-created folder — each becomes its own group
                const groupTitle = (child.title || '').trim() || 'Bookmarks';
                const groupColor = colorForTitle(groupTitle);
                for (const leaf of collectLeafUrls(child)) {
                    const isPinned = leaf.title.startsWith('!');
                    tabDefs.push({ 
                        url: leaf.url, 
                        pinned: isPinned, 
                        groupId: isPinned ? -1 : PENDING_GROUP, 
                        groupTitle: isPinned ? '' : groupTitle, 
                        groupColor: isPinned ? '' : groupColor 
                    });
                }
            }
        }
    }

    return tabDefs;
}

async function bookmarksPermitted() {
    return chrome.permissions.contains({ permissions: ['bookmarks'] }).catch(() => false);
}

// Startup reconcile and the debounced live fold can overlap on the same
// window; a single in-flight flag keeps the (non-refcounted) launch lock sane.
let bookmarkRestoreInFlight = false;

// Restore is a HEAVY operation — open it only when genuinely needed:
// if at most this fraction of bookmarks is missing, the session restored
// fine (or only a couple of new bookmarks are absent) and we do nothing.
const RESTORE_MISSING_THRESHOLD = 0.3;

function toastActiveTab(message) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([at]) => {
        if (at) chrome.tabs.sendMessage(at.id, { action: 'show-toast', message }).catch(() => {});
    });
}

/**
 * Auto-Restore Bookmarks (v2 — conservative by design):
 *  1. Only fires when a LARGE share of bookmarks is missing (session was
 *     lost). A healthy restored session, or a couple of new bookmarks,
 *     triggers nothing.
 *  2. When restore IS needed, it first looks for a window that already
 *     holds most of the still-open bookmark tabs and folds the missing
 *     ones into it — a half-restored session is healed in place instead of
 *     being duplicated by a second window.
 *  3. Fresh window only when no meaningful bookmark window exists.
 * The background caller delays this until Chrome's session restore has
 * settled — running at raw onStartup sees half-restored sessions.
 */
export async function restoreAllBookmarksIfEnabled() {
    await ensureLoaded();
    if (!globalSettings.autoRestoreBookmarks) return false;
    if (!(await bookmarksPermitted())) return false;
    if (bookmarkRestoreInFlight) return false;
    bookmarkRestoreInFlight = true;
    try {
        return await doRestoreAllBookmarks();
    } finally {
        bookmarkRestoreInFlight = false;
    }
}

async function doRestoreAllBookmarks() {
    const tabDefs = await collectAllBookmarkTabDefs();
    if (tabDefs.length === 0) return false;

    const tabs = await chrome.tabs.query({}).catch(() => []);
    const open = new Set(tabs.map(t => getCanonicalUrl(t.url)));
    const missing = tabDefs.filter(d => !open.has(getCanonicalUrl(d.url)));

    // Session restored fine (or just a few new bookmarks) — do nothing.
    if (missing.length / tabDefs.length <= RESTORE_MISSING_THRESHOLD) return false;

    // Find the window that already holds the most bookmark tabs.
    const bookmarkUrls = new Set(tabDefs.map(d => getCanonicalUrl(d.url)));
    const winHits = new Map();
    for (const t of tabs) {
        if (bookmarkUrls.has(getCanonicalUrl(t.url))) {
            winHits.set(t.windowId, (winHits.get(t.windowId) || 0) + 1);
        }
    }
    let bestWinId = null, bestHits = 0;
    for (const [winId, hits] of winHits) {
        if (hits > bestHits) { bestWinId = winId; bestHits = hits; }
    }
    const alreadyOpen = tabDefs.length - missing.length;

    // Minimum signal: one coincidentally-open bookmark tab must not capture
    // 99 missing tabs into an unrelated window.
    if (bestWinId !== null && bestHits >= 2 && bestHits >= Math.floor(alreadyOpen * 0.5)) {
        // Heal the surviving window in place — no duplicate second window.
        setBookmarkWindowId(bestWinId);
        launchingWindowIds.add(bestWinId);
        try {
            await materializeTabs(missing.slice(0, BOOKMARK_TAB_CAP), bestWinId, { dedupe: true });
            toastActiveTab(`Restored ${Math.min(missing.length, BOOKMARK_TAB_CAP)} bookmark tabs into this session`);
            return true;
        } catch (e) {
            console.warn('[Tabs++] bookmark restore-fold error:', e.message);
        } finally {
            launchingWindowIds.delete(bestWinId);
        }
    }

    // If the ONLY window is a lone blank/NTP tab (typical crash-reopen with a
    // lost session), reuse that window instead of stranding a dead empty one.
    const wins = await chrome.windows.getAll({ populate: true }).catch(() => []);
    const loneBlank = wins.length === 1 && wins[0].tabs?.length === 1 &&
        /^(chrome:\/\/newtab\/?|about:blank)$/i.test(wins[0].tabs[0].url || '');
    if (loneBlank) {
        const winId = wins[0].id;
        setBookmarkWindowId(winId);
        launchingWindowIds.add(winId);
        try {
            await materializeTabs(missing.slice(0, BOOKMARK_TAB_CAP), winId, { dedupe: true });
            toastActiveTab(`Restored ${Math.min(missing.length, BOOKMARK_TAB_CAP)} bookmark tabs`);
            return true;
        } catch (e) {
            console.warn('[Tabs++] bookmark restore-reuse error:', e.message);
        } finally {
            launchingWindowIds.delete(winId);
        }
    }

    // No surviving bookmark window — full fresh launch.
    const ok = await launchBookmarksInNewWindow(missing);
    if (ok) toastActiveTab(`Restored bookmark tabs (${Math.min(missing.length, BOOKMARK_TAB_CAP)} reopened)`);
    return ok;
}

/**
 * Live fold-in for newly added/changed bookmarks. Deliberately FOLD-ONLY:
 * a single new bookmark must never spawn a window — recreation happens at
 * the next startup reconcile if it's ever needed. Caller debounces.
 */
export async function reconcileNewBookmarks() {
    await ensureLoaded();
    if (!globalSettings.autoRestoreBookmarks) return;
    if (!(await bookmarksPermitted())) return;
    if (typeof bookmarkWindowId !== 'number') return;
    if (bookmarkRestoreInFlight || launchingWindowIds.has(bookmarkWindowId)) return;
    const alive = !!(await chrome.windows.get(bookmarkWindowId).catch(() => null));
    if (!alive) { setBookmarkWindowId(null); return; }

    const tabDefs = await collectAllBookmarkTabDefs();
    const open = new Set((await chrome.tabs.query({}).catch(() => [])).map(t => getCanonicalUrl(t.url)));
    const missing = tabDefs.filter(d => !open.has(getCanonicalUrl(d.url)));
    if (missing.length === 0 || missing.length > 10) return; // bursts (imports/sync) are not live-adds

    launchingWindowIds.add(bookmarkWindowId);
    try {
        await materializeTabs(missing, bookmarkWindowId, { dedupe: true });
    } catch (e) {
        console.warn('[Tabs++] bookmark reconcile error:', e.message);
    } finally {
        launchingWindowIds.delete(bookmarkWindowId);
    }
}

/**
 * Shared current-window insert for bookmark operations. Mirrors performSummonSet
 * (setService.js): resolves the current window, acquires the window lock so the
 * auto-grouping engine doesn't race, materializes tabs with dedup so already-open
 * bookmarks aren't duplicated, then releases the lock. BOOKMARK_TAB_CAP keeps the
 * insert within what Chrome can handle responsively.
 *
 * @param {Array} tabDefs - tab definitions from folderToTabDefs / tree walk
 * @returns {Promise<boolean>} success
 */
async function summonIntoCurrentWindow(tabDefs) {
    if (!tabDefs || tabDefs.length === 0) return false;

    const capped = tabDefs.length > BOOKMARK_TAB_CAP ? tabDefs.slice(0, BOOKMARK_TAB_CAP) : tabDefs;

    let targetWinId;
    try {
        const currentWin = await chrome.windows.getCurrent();
        targetWinId = currentWin.id;
    } catch (e) {
        return false;
    }

    launchingWindowIds.add(targetWinId);
    try {
        await materializeTabs(capped, targetWinId, { dedupe: true });
    } catch (e) {
        console.warn('[Tabs++] bookmark summon error:', e.message);
        return false;
    } finally {
        launchingWindowIds.delete(targetWinId);
    }
    return true;
}

/**
 * Bookmark-specific entry into the shared window-launch pipeline. Applies
 * BOOKMARK_TAB_CAP first (the cap is a bookmark concern, not a launch concern),
 * then delegates to setService.launchInNewWindow so the lock/seed-tab dance
 * has exactly one implementation across the codebase.
 *
 * @param {Array} tabDefs - tab definitions from folderToTabDefs / tree walk
 * @returns {Promise<boolean>} success
 */
async function launchBookmarksInNewWindow(tabDefs) {
    if (!tabDefs || tabDefs.length === 0) return false;
    // Opening hundreds of tabs concurrently (materializeTabs uses Promise.all)
    // freezes Chrome. Cap at a sane ceiling, keeping the first N in order so the
    // user's most-curated (top-of-tree) bookmarks win the budget.
    const capped = tabDefs.length > BOOKMARK_TAB_CAP ? tabDefs.slice(0, BOOKMARK_TAB_CAP) : tabDefs;
    const winId = await launchInNewWindow(capped);
    if (typeof winId === 'number') setBookmarkWindowId(winId);
    return !!winId;
}
