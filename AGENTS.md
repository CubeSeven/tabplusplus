# Tabs++ Coding Standards

Rules derived from codebase audit. All future additions must follow these.

---

## 1. No Dead Code

**Every import must be used. Every export must be consumed externally.**

```
// BAD: unused imports clutter the module
import { groupCache, NTP_URL } from '../constants.js';  // never used

// BAD: export on internal-only symbol
export const EXTENSION_ACTIONS = [...];  // only used in this file → use const

// BAD: exported state variable never read
export let lastSession = [];  // written but never consumed → remove
```

Before committing, check: does every `import`ed symbol appear in the file body? Is every `export` actually imported elsewhere?

---

## 2. One Shared Listener, Never Per-Call

**Never register `chrome.tabs.onUpdated` (or any Chrome API listener) inside a function called repeatedly.**

```
// BAD: 50 calls to safeDiscard = 50 listeners, all checking tId === tabId
function safeDiscard(tabId) {
    const listener = (tId, changeInfo) => { ... };
    chrome.tabs.onUpdated.addListener(listener);  // LEAK
}
```

```
// GOOD: single shared listener at module level, keyed by tabId
const pendingDiscards = new Map();

chrome.tabs.onUpdated.addListener((tId, changeInfo) => {
    if (pendingDiscards.has(tId) && changeInfo.status === 'complete') {
        const entry = pendingDiscards.get(tId);
        pendingDiscards.delete(tId);
        clearTimeout(entry.timeout);
        // ... proceed
    }
});
```

This applies to: `safeDiscard`, `safeHibernate`, or any new helper that waits for tab state changes.

---

## 3. Clean Up All Tracking Structures on Remove

**When a tab or window is closed, remove its entries from ALL tracking Maps/Sets.**

```
// BAD: onRemoved cleans up memoryBaselines but forgets discardedTabs
chrome.tabs.onRemoved.addListener((tabId) => {
    memoryBaselines.delete(tabId);
    // forgot: discardedTabs.delete(tabId)
    // forgot: recentlyAwakened.delete(tabId)
});

// BAD: windows.onRemoved forgets ntpTabCache
chrome.windows.onRemoved.addListener((windowId) => {
    // forgot: ntpTabCache.delete(windowId)
});
```

```
// GOOD: every tracking structure gets cleaned up
chrome.tabs.onRemoved.addListener((tabId) => {
    memoryBaselines.delete(tabId);
    discardedTabs.delete(tabId);
    recentlyAwakened.delete(tabId);
    evictionGraveyard.delete(tabId);
    // ... every Map/Set that indexes by tabId
});
```

When adding a new `Map<tabId, ...>` or `Set<tabId>`, also add cleanup in `onRemoved`.

---

## 4. Use Set for Lookups, Not Array Iteration

**Deduplication checks must be O(1), never O(n) with `.some()` or `.find()`.**

```
// BAD: O(n) per closed tab, O(n*m) on batch close
if (!sessionVault.some(t => getCanonicalUrl(t.url) === canonical)) {
    sessionVault.push(entry);
}
```

```
// GOOD: maintain a Set alongside the array
if (!vaultCanonicalUrls.has(canonicalUrl)) {
    vaultCanonicalUrls.add(canonicalUrl);
    sessionVault.push(entry);
}
// On vault clear/load: vaultCanonicalUrls.clear(); rebuild from array
```

---

## 5. Pre-Build Lookup Maps from Static Data

**If static data is searched repeatedly (e.g., GROUPING_RULES), build a Map once at module load.**

```
// BAD: O(R*D) on every URL update
const rule = GROUPING_RULES.find(r => r.domains.some(d => host === d));
```

```
// GOOD: build Map once
const domainRuleMap = new Map();
for (const rule of GROUPING_RULES) {
    for (const d of rule.domains) domainRuleMap.set(d, rule);
}
// O(1) lookup + subdomain fallback
function findRuleByHost(host) { ... }
```

---

## 6. Batch chrome.storage.local.set Calls

**Never make two sequential `storage.local.set` calls when one will do.**

```
// BAD: two writes
chrome.storage.local.set({ baselines: ... });
chrome.storage.local.set({ lastSession: ... });
```

```
// GOOD: merged into one
chrome.storage.local.set({
    baselines: ...,
    lastSession: ...
});
```

Also: every `storage.local.set` must chain `.catch(() => {})` unless the caller already handles the promise.

---

## 7. Validate Message Handler Inputs

**All `chrome.runtime.onMessage` handlers must validate parameter types before use.**

```
// BAD: throws if request.query is an array
const query = (request.query || "").trim();
```

```
// GOOD: type check
const query = (typeof request.query === 'string' ? request.query : "").trim();
```

At minimum, validate:
- `request.query` → `typeof === 'string'`
- `request.settings` → `typeof === 'object' && !Array.isArray()`
- `request.minutes` → `Number.isFinite(n) && n > 0`
- Any numeric parameter used in arithmetic

---

## 8. Store Timeout/Interval IDs and Clear on Teardown

**Every `setTimeout`/`setInterval` that can outlive its UI must be tracked and cleared.**

```
// BAD: timeout fires on hidden element
function showPalette() {
    setTimeout(() => input.focus(), 200);  // fires even if palette was dismissed
}
```

```
// GOOD: track and clear
let focusTimeouts = [];

function showPalette() {
    focusTimeouts.push(setTimeout(() => { if (isVisible) input.focus(); }, 200));
}

function hidePalette() {
    for (const t of focusTimeouts) clearTimeout(t);
    focusTimeouts = [];
}
```

---

## 9. Event Delegation for Dynamic Lists

**Do not attach per-element listeners after setting `innerHTML`. Use a single delegated listener.**

```
// BAD: N listeners created on every renderResults() call
resultsContainer.querySelectorAll('img[data-type]').forEach(img => {
    img.addEventListener('error', () => { ... });
});
```

```
// GOOD: single capture-phase listener, registered once in setup
resultsContainer.addEventListener('error', (e) => {
    const img = e.target;
    if (img.matches('img[data-type]')) {
        img.outerHTML = TYPE_FALLBACK[img.getAttribute('data-type')] || TYPE_FALLBACK.default;
    }
}, true);  // capture: true for events that don't bubble (error)
```

---

## 10. Cache DOM Queries

**Never call `querySelectorAll` on every keystroke for the same container.**

```
// BAD: re-queries live DOM on every arrow key
function updateSelection(index) {
    const items = resultsContainer.querySelectorAll('.result-item');  // every key
}
```

```
// GOOD: cache after render
let cachedResultItems = [];

function renderResults(results) {
    resultsContainer.innerHTML = html;
    cachedResultItems = Array.from(resultsContainer.querySelectorAll('.result-item'));
}

function updateSelection(index) {
    if (cachedResultItems[index]) cachedResultItems[index].classList.add('selected');
}
```

---

## 11. Chrome API Promises: Always Error-Handle

**Every `chrome.*` promise must have `.catch()` or be inside a try/catch.**

```
// BAD: silent failure, popup user sees no feedback
chrome.runtime.sendMessage({ action: 'update-settings', settings });
```

```
// GOOD
chrome.runtime.sendMessage({ action: 'update-settings', settings }).catch(() => {});
```

Also: every `chrome.tabs.sendMessage` that can fail (restricted page, stale context) must `.catch()`.

---

## 12. Content Script Injection Guard

**Any file loaded via `chrome.scripting.executeScript` must have a re-injection guard.**

```
// At the very top of content.js (before any side effects):
if (window.__tabsppInjected) return;
window.__tabsppInjected = true;
```

This prevents double-injection when `executeScript` is called on a page that already has the content script (e.g., extension reload while tabs are open).

---

## 13. Keep state.js Minimal

**`state.js` exports only: (a) state variables, (b) simple setters, (c) `updateSettings`.**

- No business logic
- No imports besides `constants.js`
- No async operations
- No Chrome API calls

All complex state mutations go into service modules.

---

## 14. File Size Boundaries

If a function exceeds ~150 lines or a file exceeds ~1000 lines, split it:

| File | Current | Target |
|------|---------|--------|
| `content.js` | 2772 lines | Split into 5-6 modules |
| `paletteService.js` `executeAction` | 379 lines | Split into handler map |
| `paletteService.js` `handleSearchItems` | 305 lines | Split into phases |
| `background.js` `onRemoved` | ~200 lines | Named async helpers |

These are deferred (high risk, zero user benefit), but new code must not make them worse.

---

## Quick Reference

| Rule | Check |
|------|-------|
| Unused imports/exports | Every `import` appears in body, every `export` imported elsewhere |
| Shared listener | One `addListener` at module level, keyed by Map |
| Remove cleanup | All Maps/Sets keyed by tabId/windowId cleaned in `onRemoved` |
| Set for lookup | `Set.has()` not `Array.some()` for dedup |
| Pre-built Map | Static data searched repeatedly → build Map once |
| Batch writes | One `storage.local.set({ key1, key2 })` not two |
| Validate input | `typeof` check before `.trim()` or arithmetic |
| Track timeouts | Store IDs, `clearTimeout` on hide/teardown |
| Event delegation | Single listener on container, not per-element |
| Cache DOM | `Array.from(querySelectorAll(...))` after render, reuse |
| Error-handle | Every chrome.* promise has `.catch()` |
| Injection guard | `window.__tabsppInjected` guard at top of content scripts |
| state.js purity | No business logic, no Chrome APIs, imports only constants.js |
