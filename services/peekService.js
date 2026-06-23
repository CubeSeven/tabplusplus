import { peekWindows, blurredSourceTabs } from '../state.js';

// Returns true if any open peek window still references the given source tab.
// Used to decide whether the parent blur can be safely removed.
function isSourceStillPeeking(sourceTabId) {
    for (const [, data] of peekWindows.entries()) {
        if (data.sourceTabId === sourceTabId) return true;
    }
    return false;
}

export function handleOpenPeek(request, sender, sendResponse) {
    const refWinId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.windows.get(refWinId, (currentWin) => {
        const w = (currentWin && currentWin.width) || 1200;
        const h = (currentWin && currentWin.height) || 800;
        const width = Math.round(w * 0.85);
        const height = Math.round(h * 0.9);
        const left = ((currentWin && currentWin.left) || 0) + Math.round((w - width) / 2);
        const top = ((currentWin && currentWin.top) || 0) + Math.round((h - height) / 2);
        
        chrome.windows.create({
            url: request.url,
            type: 'popup',
            state: 'normal',
            width: width,
            height: height,
            left: left,
            top: top,
            focused: true
        }, (newWin) => {
            if (newWin) {
                const sourceTabId = sender.tab ? sender.tab.id : null;
                peekWindows.set(newWin.id, {
                    windowId: sender.tab ? sender.tab.windowId : currentWin.id,
                    sourceTabId: sourceTabId,
                    groupId: sender.tab && sender.tab.groupId !== -1 ? sender.tab.groupId : null
                });
                if (sourceTabId) {
                    chrome.tabs.sendMessage(sourceTabId, { action: 'apply-parent-blur' }).catch(() => {});
                    blurredSourceTabs.add(sourceTabId);
                }
            }
        });
    });
    sendResponse({ success: true });
    return true;
}

export function handlePromotePeek(request, sender, sendResponse) {
    if (!sender.tab) { sendResponse({ success: false }); return true; }

    const sourceData = peekWindows.get(sender.tab.windowId);

    // Delete BEFORE the move so windows.onRemoved (from the single-tab popup
    // closing) doesn't fire a duplicate remove-parent-blur.
    peekWindows.delete(sender.tab.windowId);

    if (sourceData?.sourceTabId && !isSourceStillPeeking(sourceData.sourceTabId)) {
        chrome.tabs.sendMessage(sourceData.sourceTabId, { action: 'remove-parent-blur' }).catch(() => {});
        blurredSourceTabs.delete(sourceData.sourceTabId);
    }

    chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
        let targetWinId = null;
        if (sourceData && windows.some(w => w.id === sourceData.windowId)) {
            targetWinId = sourceData.windowId;
        } else {
            const backupWin = windows.find(w => !peekWindows.has(w.id));
            if (backupWin) targetWinId = backupWin.id;
        }

        if (targetWinId) {
            chrome.tabs.move(sender.tab.id, { windowId: targetWinId, index: -1 }, (movedTab) => {
                if (chrome.runtime.lastError || !movedTab) return;
                chrome.tabs.update(movedTab.id, { active: true }).catch(() => {});
                chrome.windows.update(targetWinId, { focused: true }).catch(() => {});
            });
        } else {
            chrome.windows.create({ tabId: sender.tab.id }).catch(() => {});
        }
    });
    sendResponse({ success: true });
    return true;
}

export function handleCheckPeekStatus(sender, sendResponse) {
    const isPeek = sender.tab && sender.tab.windowId && peekWindows.has(sender.tab.windowId);
    sendResponse({ isPeek: !!isPeek });
}

export function cleanupPeekWindow(windowId) {
    const peekData = peekWindows.get(windowId);
    peekWindows.delete(windowId);
    if (peekData && peekData.sourceTabId && !isSourceStillPeeking(peekData.sourceTabId)) {
        chrome.tabs.sendMessage(peekData.sourceTabId, { action: 'remove-parent-blur' }).catch(() => {});
        blurredSourceTabs.delete(peekData.sourceTabId);
    }
}
