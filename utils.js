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

export function safeDiscard(tabId, onDiscarded = null) {
    let hasAttempted = false;
    
    const attemptDiscard = () => {
        if (hasAttempted) return;
        
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) return;
            
            // 1. Never discard the tab if the user is currently looking at it
            if (tab.active) return;
            
            // 2. Only discard if it actually has a URL (avoids about:blank corruption)
            const currentUrl = tab.url || tab.pendingUrl;
            if (!currentUrl || currentUrl === '' || currentUrl.startsWith('chrome://')) return;
            
            hasAttempted = true;
            chrome.tabs.discard(tabId).then(() => {
                if (onDiscarded) onDiscarded();
            }).catch(() => {});
        });
    };

    const listener = (tId, changeInfo) => {
        if (tId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            attemptDiscard();
        }
    };

    // Pre-check if it's already completely loaded
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        
        if (tab.status === 'complete') {
            attemptDiscard();
        } else {
            // Wait patiently for it to finish loading, however long Chrome takes
            chrome.tabs.onUpdated.addListener(listener);
            
            // Cleanup listener after a very long time just in case it never completes
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
            }, 5 * 60 * 1000); // 5 minutes
        }
    });
}
