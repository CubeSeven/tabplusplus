(function() {
if (window.__tabsppAnchorInjected) return;
window.__tabsppAnchorInjected = true;

// Anchored tab: links that leave origin + path open in a new tab.
let anchor = null;
let settings = { autoPeekCrossDomain: false, peekExcludedDomains: [] };

const trimPath = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

function setAnchor(a) {
    anchor = a && typeof a.origin === 'string' && typeof a.path === 'string'
        ? { origin: a.origin, path: a.path }
        : null;
}

function inScope(url) {
    return url.origin === anchor.origin && trimPath(url.pathname) === anchor.path;
}

// Auto-Peek owns cross-domain clicks when enabled (content.js handler).
function peekTakesClick(url) {
    if (!settings.autoPeekCrossDomain || url.hostname === location.hostname) return false;
    const host = location.hostname;
    return !(settings.peekExcludedDomains || []).some(d => host === d || host.endsWith('.' + d));
}

function askAnchor() {
    if (!chrome.runtime?.id) return;
    try {
        chrome.runtime.sendMessage({ action: 'get-anchor' })
            .then(res => setAnchor(res && res.anchor))
            .catch(() => {});
    } catch (e) {}
}

chrome.storage.local.get({ settings: {}, anchors: {} }, (data) => {
    if (chrome.runtime.lastError || !data) return;
    settings = { ...settings, ...data.settings };
    const path = trimPath(location.pathname);
    const here = Object.values(data.anchors || {}).some(a => a && a.origin === location.origin && a.path === path);
    if (here) askAnchor();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) settings = { ...settings, ...changes.settings.newValue };
});

chrome.runtime.onMessage.addListener((request) => {
    if (request && request.action === 'anchor-state') setAnchor(request.anchor);
});

window.addEventListener('click', (e) => {
    if (!anchor || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.composedPath().find(n => n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement);
    if (!link || !link.href || link.hasAttribute('download')) return;
    const target = (link.target || '').toLowerCase();
    if (target && target !== '_self' && target !== '_top' && target !== '_parent') return;
    let url;
    try { url = new URL(link.href); } catch (err) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (inScope(url) || peekTakesClick(url) || !chrome.runtime?.id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
        chrome.runtime.sendMessage({ action: 'open-from-anchor', url: url.href }).catch(() => {});
    } catch (err) {}
}, true);
})();
