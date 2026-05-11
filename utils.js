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

function attemptDiscard(tabId, onDiscarded) {
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        if (tab.active) return;
        const currentUrl = tab.url || tab.pendingUrl;
        if (!currentUrl || currentUrl === '' || currentUrl.startsWith('chrome://')) return;
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
        attemptDiscard(tId, entry.onDiscarded);
    }
});

export function safeDiscard(tabId, onDiscarded = null) {
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        if (tab.active) return;

        const currentUrl = tab.url || tab.pendingUrl;
        if (!currentUrl || currentUrl === '' || currentUrl.startsWith('chrome://')) return;

        if (tab.status === 'complete') {
            chrome.tabs.discard(tabId).then(() => {
                if (onDiscarded) onDiscarded();
            }).catch(() => {});
        } else {
            if (pendingDiscards.has(tabId)) {
                clearTimeout(pendingDiscards.get(tabId).timeout);
            }
            const timeout = setTimeout(() => {
                pendingDiscards.delete(tabId);
                attemptDiscard(tabId, onDiscarded);
            }, 30000);
            pendingDiscards.set(tabId, { timeout, onDiscarded });
        }
    });
}
