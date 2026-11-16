import { memoryBaselines } from '../state.js';
import { ensureLoaded, syncBaselinesToStorage } from './tabService.js';

// Anchored tab: locked to origin + path; query/hash may change.
// Every other navigation opens in a new foreground tab.
const ANCHORS_KEY = 'anchors';
const ORPHANS_KEY = 'anchorOrphans';
const ORPHAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INHERIT_GRACE_MS = 5000;
const RETURN_TTL_MS = 5000;

const anchors = new Map();   // tabId -> { origin, path, url }
const orphans = new Map();   // scope key -> anchors whose tab vanished (restart, window close)
const closing = new Map();   // tabId -> { anchor, timer } awaiting Ghost Prevention restore
const returning = new Map(); // tabId -> { stage: 'back' | 'reload', at }
const suspended = new Set(); // tabIds whose anchor URL redirects away

const trimPath = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
const keyOf = a => a.origin + a.path;

function scopeOf(url) {
    if (typeof url !== 'string') return null;
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return { origin: u.origin, path: trimPath(u.pathname) };
    } catch {
        return null;
    }
}

function inScope(anchor, url) {
    const s = scopeOf(url);
    return !!s && s.origin === anchor.origin && s.path === anchor.path;
}

function isAnchor(a) {
    return !!a && typeof a.origin === 'string' && typeof a.path === 'string' && typeof a.url === 'string';
}

function addOrphan(anchor, orphanedAt = Date.now()) {
    const key = keyOf(anchor);
    if (!orphans.has(key)) orphans.set(key, []);
    orphans.get(key).push({ origin: anchor.origin, path: anchor.path, url: anchor.url, orphanedAt });
}

function claimOrphan(tab) {
    if (!orphans.size || !tab.pinned || anchors.has(tab.id)) return false;
    const url = tab.url || tab.pendingUrl;
    const scope = scopeOf(url);
    const list = scope && orphans.get(keyOf(scope));
    if (!list) return false;
    const { origin, path } = list.pop();
    if (!list.length) orphans.delete(keyOf(scope));
    anchors.set(tab.id, { origin, path, url });
    return true;
}

function takeClosing(tabId) {
    const entry = closing.get(tabId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    closing.delete(tabId);
    return entry.anchor;
}

function forget(tabId) {
    anchors.delete(tabId);
    returning.delete(tabId);
    suspended.delete(tabId);
}

function persist() {
    chrome.storage.local.set({
        [ANCHORS_KEY]: Object.fromEntries(anchors),
        [ORPHANS_KEY]: [...orphans.values()].flat()
    }).catch(() => {});
}

function syncTab(tabId) {
    const a = anchors.get(tabId);
    chrome.action.setBadgeText({ tabId, text: a ? '⚓' : '' }).catch(() => {});
    chrome.tabs.sendMessage(tabId, { action: 'anchor-state', anchor: a ? { origin: a.origin, path: a.path } : null }).catch(() => {});
}

function toast(tabId, message) {
    chrome.tabs.sendMessage(tabId, { action: 'show-toast', message }).catch(() => {});
}

function openTab(tab, url) {
    return chrome.tabs.create({ url, windowId: tab.windowId, openerTabId: tab.id, active: true });
}

async function load() {
    const [data, tabs] = await Promise.all([
        chrome.storage.local.get([ANCHORS_KEY, ORPHANS_KEY]),
        chrome.tabs.query({})
    ]);
    anchors.clear();
    orphans.clear();
    const cutoff = Date.now() - ORPHAN_TTL_MS;
    const storedOrphans = Array.isArray(data[ORPHANS_KEY]) ? data[ORPHANS_KEY] : [];
    let dirty = false;
    for (const o of storedOrphans) {
        if (isAnchor(o) && o.orphanedAt > cutoff) addOrphan(o, o.orphanedAt);
        else dirty = true;
    }
    const live = new Map(tabs.map(t => [t.id, t]));
    for (const [id, a] of Object.entries(data[ANCHORS_KEY] || {})) {
        if (!isAnchor(a)) { dirty = true; continue; }
        const tab = live.get(Number(id));
        // Tab ids restart with the browser; an id match alone is no proof.
        if (tab && inScope(a, tab.url || tab.pendingUrl)) {
            anchors.set(tab.id, a);
        } else {
            addOrphan(a);
            dirty = true;
        }
    }
    const claimed = tabs.filter(claimOrphan);
    if (dirty || claimed.length) persist();
    for (const tab of claimed) syncTab(tab.id);
}

let loadPromise = null;
function ready() {
    if (!loadPromise) loadPromise = load().catch(e => { loadPromise = null; throw e; });
    return loadPromise;
}

async function alignBaseline(tabId, url) {
    await ensureLoaded();
    const base = memoryBaselines.get(tabId);
    const anchor = anchors.get(tabId);
    // Ghost Prevention restores to the baseline; keep it inside the anchor.
    if (base && anchor && !inScope(anchor, base.url)) {
        memoryBaselines.set(tabId, { ...base, url });
        syncBaselinesToStorage();
    }
}

function returnHome(tabId, anchor) {
    returning.set(tabId, { stage: 'reload', at: Date.now() });
    chrome.tabs.update(tabId, { url: anchor.url }).catch(() => {});
}

async function handleUpdate(tabId, change, tab) {
    await ready();
    const anchor = anchors.get(tabId);
    if (!anchor) {
        if (claimOrphan(tab)) {
            persist();
            syncTab(tabId);
        }
        return;
    }
    const url = change.url;
    if (url === undefined || url.startsWith('about:')) return;
    if (inScope(anchor, url)) {
        returning.delete(tabId);
        suspended.delete(tabId);
        if (anchor.url !== url) {
            anchor.url = url;
            persist();
        }
        return;
    }
    const ret = returning.get(tabId);
    const stage = ret && Date.now() - ret.at < RETURN_TTL_MS ? ret.stage : null;
    if (stage === 'back') {
        returnHome(tabId, anchor);
        return;
    }
    if (stage === 'reload') {
        returning.delete(tabId);
        suspended.add(tabId);
        toast(tabId, 'Anchor paused: this page redirects away');
        return;
    }
    if (suspended.has(tabId)) return;
    openTab(tab, url).catch(() => {});
    returning.set(tabId, { stage: 'back', at: Date.now() });
    chrome.tabs.goBack(tabId).catch(() => returnHome(tabId, anchor));
}

export async function toggleAnchor(tab) {
    await ready();
    if (anchors.has(tab.id)) {
        forget(tab.id);
        persist();
        syncTab(tab.id);
        toast(tab.id, 'Anchor released');
        return;
    }
    const scope = scopeOf(tab.url);
    if (!scope) {
        toast(tab.id, 'Only web pages can be anchored');
        return;
    }
    anchors.set(tab.id, { ...scope, url: tab.url });
    persist();
    syncTab(tab.id);
    toast(tab.id, `Anchored to ${new URL(tab.url).host}${scope.path}`);
    if (!tab.pinned) await chrome.tabs.update(tab.id, { pinned: true }).catch(() => {});
    await alignBaseline(tab.id, tab.url);
}

export async function inheritAnchor(oldTabId, newTabId) {
    await ready();
    const anchor = takeClosing(oldTabId);
    if (!anchor) return;
    anchors.set(newTabId, anchor);
    persist();
    syncTab(newTabId);
}

export async function getAnchorScope(tabId) {
    await ready();
    const a = anchors.get(tabId);
    return a ? { origin: a.origin, path: a.path } : null;
}

export async function openFromAnchor(tab, url) {
    if (!tab || !scopeOf(url)) return;
    await ready();
    await openTab(tab, url);
    // Stale content-script state: tell the page it is not anchored.
    if (!anchors.has(tab.id)) syncTab(tab.id);
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url === undefined && change.pinned === undefined) return;
    handleUpdate(tabId, change, tab).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId, info) => {
    ready().then(() => {
        const anchor = anchors.get(tabId);
        forget(tabId);
        if (!anchor) return;
        if (info.isWindowClosing) {
            addOrphan(anchor);
        } else {
            const timer = setTimeout(() => closing.delete(tabId), INHERIT_GRACE_MS);
            closing.set(tabId, { anchor, timer });
        }
        persist();
    }).catch(() => {});
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    ready().then(() => {
        const anchor = anchors.get(removedTabId) || takeClosing(removedTabId);
        forget(removedTabId);
        if (!anchor) return;
        anchors.set(addedTabId, anchor);
        persist();
        syncTab(addedTabId);
    }).catch(() => {});
});

chrome.action.setBadgeBackgroundColor({ color: '#52525b' }).catch(() => {});
ready().catch(() => {});
