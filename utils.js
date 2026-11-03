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

function persistPendingDiscards() {
    if (!chrome.storage.session) return;
    const saved = [...pendingDiscards.entries()].map(([id, e]) => [id, e.targetUrl]);
    chrome.storage.session.set({ pendingDiscards: saved }).catch(() => {});
}

// SW death loses the in-memory map AND the 30s fallback timer. On the first
// 'complete' event after a restart, rebuild pendings from storage.session.
let pendingDiscardsRestored = false;
async function restorePendingDiscardsOnce() {
    if (pendingDiscardsRestored) return;
    pendingDiscardsRestored = true;
    if (!chrome.storage.session) return;
    const { pendingDiscards: saved } = await chrome.storage.session.get('pendingDiscards').catch(() => ({}));
    if (!Array.isArray(saved)) return;
    for (const [tabId, targetUrl] of saved) {
        if (pendingDiscards.has(tabId)) continue;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) continue; // tab gone — drop the pending discard
        if (tab.status === 'complete') attemptDiscard(tabId, null, targetUrl);
        else safeDiscard(tabId, null, targetUrl); // re-arms listener + fallback timer
    }
}

chrome.tabs.onUpdated.addListener(async (tId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    await restorePendingDiscardsOnce();
    if (pendingDiscards.has(tId)) {
        const entry = pendingDiscards.get(tId);
        pendingDiscards.delete(tId);
        clearTimeout(entry.timeout);
        persistPendingDiscards();
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
                persistPendingDiscards();
                attemptDiscard(tabId, onDiscarded, targetUrl);
            }, 30000);
            pendingDiscards.set(tabId, { timeout, onDiscarded, targetUrl });
            persistPendingDiscards();
        }
    });
}

export function clearPendingDiscard(tabId) {
    const entry = pendingDiscards.get(tabId);
    if (entry) {
        clearTimeout(entry.timeout);
        pendingDiscards.delete(tabId);
        persistPendingDiscards();
    }
}

// Linear-time URL check — replaces a nested-quantifier regex that could
// backtrack catastrophically on long non-matching palette queries.
export function isLikelyUrl(q) {
    if (typeof q !== 'string' || !q) return false;
    try {
        const u = new URL(q.includes('://') ? q : 'https://' + q);
        if (!u.hostname.includes('.') && !u.hostname.startsWith('localhost')) return false;
        return /^https?:$/.test(u.protocol) || !q.includes('://');
    } catch {
        return false;
    }
}

// Parse '90m' / '1.5h' style thresholds. Returns fallbackMs for anything else.
export function parseThresholdToMs(raw, fallbackMs) {
    const match = /^(\d+(?:\.\d+)?)\s*(m|h)$/i.exec(String(raw || ''));
    if (!match) return fallbackMs;
    const val = parseFloat(match[1]);
    return match[2].toLowerCase() === 'h' ? val * 3600000 : val * 60000;
}
