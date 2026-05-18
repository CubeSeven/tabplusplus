export function getCanonicalUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        return (u.protocol + '//' + u.hostname + u.pathname).toLowerCase().replace(/\/$/, "");
    } catch (e) {
        return url.toLowerCase().replace(/\/$/, "");
    }
}

export function getBaseDomain(hostname) {
    if (!hostname) return '';
    const parts = hostname.toLowerCase().split('.');
    if (parts.length <= 2) return hostname;
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    if ((last.length === 2 || last.length === 3) && 
        (secondLast.length === 2 || ['com', 'org', 'net', 'edu', 'gov'].includes(secondLast))) {
         return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
}

// -- Shared safeDiscard: one global listener handles all pending discards --
const pendingDiscards = new Map();

function attemptDiscard(tabId, onDiscarded, targetUrl) {
    chrome.tabs.get(tabId, async (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        if (tab.active) return;
        const currentUrl = tab.pendingUrl || tab.url;
        if (!currentUrl || currentUrl === '' || currentUrl.startsWith('chrome://')) return;

        if (targetUrl && currentUrl !== targetUrl && !currentUrl.startsWith('chrome://')) {
            await chrome.tabs.update(tabId, { url: targetUrl }).catch(() => {});
        }

        chrome.tabs.discard(tabId).then(() => {
            if (onDiscarded) onDiscarded();
        }).catch(() => {});
    });
}

chrome.tabs.onUpdated.addListener((tId, changeInfo) => {
    if (changeInfo.status === 'complete' && pendingDiscards.has(tId)) {
        const entry = pendingDiscards.get(tId);
        pendingDiscards.delete(tId);
        clearTimeout(entry.timeout);
        attemptDiscard(tId, entry.onDiscarded, entry.targetUrl);
    }
});

export function safeDiscard(tabId, onDiscarded = null, targetUrl = null) {
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        if (tab.active) return;

        const currentUrl = tab.pendingUrl || tab.url;
        if (!currentUrl || currentUrl === '' || currentUrl.startsWith('chrome://')) return;

        if (tab.status === 'complete') {
            attemptDiscard(tabId, onDiscarded, targetUrl);
        } else {
            if (pendingDiscards.has(tabId)) {
                clearTimeout(pendingDiscards.get(tabId).timeout);
            }
            const timeout = setTimeout(() => {
                pendingDiscards.delete(tabId);
                attemptDiscard(tabId, onDiscarded, targetUrl);
            }, 30000);
            pendingDiscards.set(tabId, { timeout, onDiscarded, targetUrl });
        }
    });
}

export function clearPendingDiscard(tabId) {
    const entry = pendingDiscards.get(tabId);
    if (entry) {
        clearTimeout(entry.timeout);
        pendingDiscards.delete(tabId);
    }
}
