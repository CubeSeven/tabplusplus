export function getCanonicalUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        return (u.protocol + '//' + u.hostname + u.pathname).toLowerCase().replace(/\/$/, "");
    } catch (e) {
        return url.toLowerCase().replace(/\/$/, "");
    }
}

export function safeDiscard(tabId) {
    const listener = (tId, changeInfo) => {
        if (tId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.discard(tabId).catch(() => {});
        }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 5000);
}
