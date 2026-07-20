import { launchingWindowIds } from '../state.js';
import { ensureLoaded } from './tabService.js';
import { materializeTabs, launchInNewWindow } from './setService.js';

// Chrome's nine valid tab-group colors, in a stable order. Used to deterministically
// assign a color to a subfolder-derived group so the same folder always lands on
// the same color across launches.
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

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
function colorForTitle(title) {
    const key = (title || '').trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

/**
 * Recursively gathers every URL node beneath a node. Non-http(s) schemes are
 * filtered (javascript:/chrome:/file: would crash chrome.tabs.create).
 */
function collectLeafUrls(node, out = []) {
    for (const child of node.children || []) {
        if (child.url) {
            if (/^https?:/i.test(child.url)) out.push(child.url);
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
 * the folder itself.
 */
function folderToTabDefs(folderNode) {
    const urls = collectLeafUrls(folderNode);
    if (urls.length === 0) return [];
    const groupTitle = (folderNode.title || '').trim() || 'Bookmarks';
    const groupColor = colorForTitle(groupTitle);
    return urls.map(url => ({ url, pinned: false, groupId: PENDING_GROUP, groupTitle, groupColor }));
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

    const tree = await chrome.bookmarks.getTree().catch(() => null);
    const root = tree && tree[0];
    if (!root) return false;

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
                    tabDefs.push({ url: child.url, pinned: false, groupId: PENDING_GROUP, groupTitle: rootTitle, groupColor: rootColor });
                }
            } else if (child.children) {
                // User-created folder — each becomes its own group
                const groupTitle = (child.title || '').trim() || 'Bookmarks';
                const groupColor = colorForTitle(groupTitle);
                for (const url of collectLeafUrls(child)) {
                    tabDefs.push({ url, pinned: false, groupId: PENDING_GROUP, groupTitle, groupColor });
                }
            }
        }
    }

    return launchBookmarksInNewWindow(tabDefs);
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
    return launchInNewWindow(capped);
}
