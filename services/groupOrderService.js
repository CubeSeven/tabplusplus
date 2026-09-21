import { globalSettings } from '../state.js';
import { NONE_GROUP } from '../constants.js';
import { ensureLoaded } from './tabService.js';

// One serialized queue per window. Re-query after each move because opening,
// grouping, or closing tabs can invalidate indices while an API call is pending.
const pendingWindows = new Map();

function cancelWindow(windowId) {
    const entry = pendingWindows.get(windowId);
    if (entry) clearTimeout(entry.timer);
    pendingWindows.delete(windowId);
}

function scheduleWindow(windowId) {
    if (!Number.isInteger(windowId) || windowId < 0 || !chrome.tabGroups) return;
    const pending = pendingWindows.get(windowId);
    if (pending) {
        pending.dirty = true;
        return;
    }
    const entry = { timer: null, dirty: false, retries: 0 };
    pendingWindows.set(windowId, entry);
    entry.timer = setTimeout(() => reconcileWindow(windowId, entry), 100);
}

async function reconcileWindow(windowId, entry) {
    entry.dirty = false;
    try {
        await ensureLoaded();
        if (globalSettings.pinGroupsToTop !== true || pendingWindows.get(windowId) !== entry) return;
        const tabs = await chrome.tabs.query({ windowId });
        if (globalSettings.pinGroupsToTop !== true || pendingWindows.get(windowId) !== entry) return;
        tabs.sort((a, b) => a.index - b.index);
        let targetIndex = tabs.filter(tab => tab.pinned).length;
        for (const tab of tabs) {
            if (tab.pinned || tab.groupId === NONE_GROUP) continue;
            if (tab.index !== targetIndex) {
                // This is the first tab of the first displaced group. Moving
                // the entire group preserves membership and collapsed state.
                await chrome.tabGroups.move(tab.groupId, { windowId, index: targetIndex });
                entry.dirty = true;
                entry.retries = 0;
                break;
            }
            targetIndex++;
        }
    } catch {
        // Chrome can temporarily reject moves while the user drags tabs.
        // Bound retries; a later tab event can start a fresh attempt.
        entry.dirty = ++entry.retries <= 3;
    } finally {
        if (pendingWindows.get(windowId) === entry) {
            if (entry.dirty && globalSettings.pinGroupsToTop === true) {
                entry.timer = setTimeout(() => reconcileWindow(windowId, entry), 100);
            } else {
                cancelWindow(windowId);
            }
        }
    }
}

export function refreshGroupOrder() {
    if (globalSettings.pinGroupsToTop !== true) {
        for (const windowId of pendingWindows.keys()) cancelWindow(windowId);
        return;
    }
    chrome.windows.getAll({ windowTypes: ['normal'] }).then(windows => {
        if (globalSettings.pinGroupsToTop === true) {
            for (const window of windows) scheduleWindow(window.id);
        }
    }).catch(() => {});
}

chrome.tabs.onCreated.addListener(tab => scheduleWindow(tab.windowId));
chrome.tabs.onMoved.addListener((_tabId, info) => scheduleWindow(info.windowId));
chrome.tabs.onAttached.addListener((_tabId, info) => scheduleWindow(info.newWindowId));
chrome.tabs.onDetached.addListener((_tabId, info) => scheduleWindow(info.oldWindowId));
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.groupId !== undefined || change.pinned !== undefined) scheduleWindow(tab.windowId);
});
chrome.tabs.onRemoved.addListener((_tabId, info) => {
    if (info.isWindowClosing) cancelWindow(info.windowId);
    else scheduleWindow(info.windowId);
});
chrome.windows.onRemoved.addListener(cancelWindow);
if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener(group => scheduleWindow(group.windowId));
    chrome.tabGroups.onMoved.addListener(group => scheduleWindow(group.windowId));
}
