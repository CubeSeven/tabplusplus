# Tabs++ — Known Bugs & Issues

A living log of confirmed bugs, their root causes, and fixes. New entries go at the top.

---

## BUG-007 — Grouped tab isn't relocated when navigated to a different category domain

**Status:** Fixed

**Location:** `background.js` (auto-group gate in `tabs.onUpdated`) + `services/tabService.js` (`applyAutoGrouping`).

**Symptom (reported):**
With Smart Groups on, a tab that's already grouped stays in its original group even after the user navigates it to a site in a *different* category. Example: a tab in the **Dev** group navigates to `youtube.com` (a **Media** site) and stays in **Dev** instead of moving to **Media**. The auto-grouping feature never re-evaluated an already-grouped tab.

**Root cause:**
The auto-group trigger in `tabs.onUpdated` gated on `tab.groupId === NONE_GROUP`:

```js
if (globalSettings.enableAutoGroup && changeInfo.url && !tab.pinned && tab.groupId === NONE_GROUP) {
    ...
    applyAutoGrouping(tab);
}
```

So once a tab was inside *any* group, the matching engine (`applyAutoGrouping` + `findRuleByHost`) was never re-invoked on navigation — it only ever grouped previously-ungrouped tabs. Grouping was add-only; there was no drift detection for grouped tabs.

**Fix — re-run the engine for grouped tabs, decide inside it:**

1. **Drop the `NONE_GROUP` restriction** in the gate so grouped tabs pass through too:
   ```js
   if (globalSettings.enableAutoGroup && changeInfo.url && !tab.pinned) {
       if (!launchingWindowIds.has(tab.windowId) && !evictionGraveyard.has(`inheritance_${tabId}`)) applyAutoGrouping(tab);
   }
   ```

2. **Add a regrouping guard at the top of `applyAutoGrouping`** (after the URL/rule matching, before any state mutation). It compares the tab's *current* group title against the *new* URL's matched category:
   ```js
   if (tab.groupId !== NONE_GROUP) {
       const currentTitle = groupCache.get(tab.groupId)?.title;
       if (!currentTitle || !ruleTitles.has(currentTitle)) return;   // manual group — respect it
       if (currentTitle === matchedRule.title) return;               // same category — no-op
       // different category → fall through; chrome.tabs.group moves it
   }
   ```

3. **Pre-built `ruleTitles` Set** (`new Set(GROUPING_RULES.map(r => r.title))`) at module load — O(1) check that a group title is a Smart Group (Dev/Design/AI/Media/News/Social) vs. a manual/custom/unnamed group.

The rest of `applyAutoGrouping` is unchanged. `chrome.tabs.group({ groupId })` relocates a tab out of its old group into the destination one (a tab belongs to exactly one group), so the existing resolve-or-create + drag-retry (3× / 400ms) + 5s `autoGroupRegistry` dedupe path handles the move correctly. When the last tab leaves a group, Chrome fires `tabGroups.onRemoved` → `groupCache.delete` — no orphan, no extra cleanup.

**Behavior matrix:**

| Tab state on navigation | New URL | Action |
| :--- | :--- | :--- |
| In **Dev** group | stackoverflow.com (Dev) | No-op (same category) |
| In **Dev** group | youtube.com (Media) | **Move to Media** (the reported bug) |
| In **Dev** group | internal-docs.company (no rule) | Stay in Dev (no rule → no match → no move) |
| In **Dev** group | `something.ai` | Move to AI (`.ai` fallback preserved) |
| In manual "My Work" group | anything | Leave alone (user intent respected) |
| Ungrouped | github.com | Group into Dev (existing behavior, unchanged) |
| `chrome://` URL | — | Skip (`new URL().hostname` throws → return) |

**Why this is safe — interaction audit:**
- **Set Launch lock** (`launchingWindowIds`) and **inheritance suppression** (`evictionGraveyard`) — both still checked in the gate before calling `applyAutoGrouping`. The `evictionGraveyard.delete('inheritance_<id>')` inside the engine still only runs when actually grouping (the guard precedes it).
- **Pinned tabs** — `!tab.pinned` preserved.
- **Protected-tab baseline URL (BUG-005 invariant)** — untouched. The baseline `url` stays frozen; only `groupId/groupTitle/groupColor` track the move via the `tabGroups.onUpdated` back-fill.
- **No new `chrome.*` calls** without `.catch` (Rule #11); no per-call listener registration (Rule #2); new `ruleTitles` is module-load Map/Set per Rule #5.

**Test checklist:**
1. Smart Groups ON, open github.com → auto-groups into **Dev**. Navigate same tab to youtube.com → tab moves to **Media**. ✅
2. In a **Media** group, navigate to netflix.com → stays in Media, no flicker/thrash. ✅
3. In a **Dev** group, navigate to an uncategorized internal/docs URL → stays in Dev. ✅
4. Manually create a custom-named group, put a categorized tab in it, navigate → group not touched. ✅
5. Ungrouped tab → github.com still auto-groups (existing behavior intact). ✅
6. During a Set Launch, navigations don't trigger regrouping (lock holds). ✅
7. Pin a tab → navigations never regroup it. ✅

---

## BUG-006 — `hibernate_window` discards drifted protected tabs at the wrong URL (double-navigation race)

**Status:** Fixed

**Location:** `services/tabService.js` — `safeHibernate` (reset + discard sequencing) interacting with `safeDiscard`/`attemptDiscard` in `utils.js`.

**Symptom (reported):**
Pin a tab and update its baseline URL to `updated-url`. Browse within the same tab to `browsed-url`. Switch to another tab and run **"Hibernate Window"**. The pinned tab gets discarded at `browsed-url` — it is **never reset to `updated-url`** before sleeping. Single-tab hibernate (`hibernate_current`) mostly worked, but `hibernate_window` reliably failed.

**Root cause — two compounding issues:**

1. **No wait for the reset navigation to commit.** `safeHibernate` did:
   ```js
   await chrome.tabs.update(tab.id, { url: baseline.url });   // resolves on accept, NOT on load
   safeDiscard(tab.id, null, baseline?.url);                  // tab is still status:'loading'
   ```
   `chrome.tabs.update` resolves when the navigation is *accepted*, not when the page *loads*. The tab was `status:'loading'` when `safeDiscard` ran.

2. **Double-navigation race.** Because `safeDiscard` was passed `targetUrl = baseline.url`, `attemptDiscard` (`utils.js:34–36`) *also* tried to navigate to the target:
   ```js
   if (targetUrl && currentUrl !== targetUrl ...) {
       await chrome.tabs.update(tabId, { url: targetUrl });   // second navigation
   }
   ```
   When `hibernate_window` fans this across many tabs in parallel, the interleaved `complete` events + two competing navigations per tab caused the reset to be interrupted, and the discard landed on `browsed-url`.

This is why single-tab hibernate (BUG-003 path, only one tab — no interleaving) mostly worked but `hibernate_window` reliably failed.

**Fix — atomic reset, no redundant navigation:**

1. Added `waitForTabComplete(tabId, timeoutMs)` — a module-private helper in `tabService.js` that resolves when the tab's `status` reaches `complete` (one-shot `onUpdated` listener), or rejects after the timeout. 8s safety cap.

2. Rewrote `safeHibernate` to **await** the reset navigation to `complete` before discarding, and to call `safeDiscard(tab.id)` **with no `targetUrl`** — the tab is already at baseline, so `attemptDiscard`'s navigate-to-target block never fires. No more second navigation.

```js
export async function safeHibernate(tab) {
    if (tab.discarded) return;
    const baseline = memoryBaselines.get(tab.id);
    const needsReset = baseline && baseline.url && (tab.pinned || baseline.groupId !== NONE_GROUP);
    if (needsReset) {
        const currentUrl = tab.pendingUrl || tab.url;
        if (currentUrl !== baseline.url) {
            try {
                await chrome.tabs.update(tab.id, { url: baseline.url });
                await waitForTabComplete(tab.id, 8000);
            } catch (e) { /* timeout or update threw — discard anyway */ }
        }
    }
    safeDiscard(tab.id);   // no targetUrl — already at baseline
}
```

**Why this is airtight:**
- **No double navigation:** no `targetUrl` → `attemptDiscard`'s navigate block is skipped for the hibernate path.
- **Baseline commits before discard:** `waitForTabComplete` guarantees Chrome's session store has the baseline URL.
- **Safe degradation:** timeout or `update` throw → still discard (no worse than before).
- **Inherited by all hibernate paths:** `hibernate_current` (via `hibernateActiveTab`), `hibernate_window`, `hibernate_pinned`, `hibernate_all`, and the startup bulk-hibernate (BUG-001) all call `safeHibernate` and benefit.

**What is NOT changed:**
- `safeDiscard` / `attemptDiscard` signatures and behavior — untouched. The recreate-after-close path (`background.js:505`) still passes `targetUrl` deliberately (a freshly created tab genuinely needs its URL committed; that path is correct as-is and isn't a hibernate path).
- The `pendingDiscards` / global `onUpdated` listener machinery in `utils.js`.

**Test checklist:**
1. Pin at `updated-url`, browse to `browsed-url`, switch away, **Hibernate Window** → wakes at `updated-url`. ✅ (the reported bug)
2. Same with **Hibernate All** → all protected tabs reset to baseline. ✅
3. Same with **Hibernate Current** → resets to baseline. ✅
4. Pin a tab, DON'T browse away (no drift), Hibernate Window → discards immediately, no spurious navigation. ✅
5. Hibernating a window where one protected tab points at a hanging site → still discards after 8s timeout, doesn't block the batch. ✅

---

## BUG-005 — Pinned/grouped baseline URL drifts to the last-visited or session-restored URL

**Status:** Fixed

**Location:** `services/tabService.js` — the URL-update block inside `processTab` (was lines 305–324).

**Symptom (reported):**
The core invariant of the extension was being violated: a tab pinned at a specific URL (e.g. `youtube.com`) kept getting "re-pinned" onto whatever URL was visited last, or the URL the tab was on when the browser closed. After a restart the protected tab would wake at the drifted URL instead of the originally-pinned one. This was an ongoing, recurring issue — each attempted fix closed one path and another opened.

**Root cause (confirmed by exhaustive write-site audit):**
There is exactly **one** automatic code path in the entire codebase that overwrites an existing protected tab's baseline URL: the `isDomainRoot` / `autoUpdateUrl` rule that used to live in `processTab`. Every other write site already preserves `data.url`:

| Write site | File:Line | Touches URL? |
| :--- | :--- | :--- |
| First registration / placeholder upgrade | tabService.js (processTab) | Seeds only — safe |
| **Navigate to domain root (isDomainRoot)** | **tabService.js (processTab)** | **YES — the only automatic overwrite** |
| Non-root navigation | tabService.js (processTab) | No (preserved `data.url`) |
| `update_baseline` / `set_baseline_url` palette actions | paletteService.js | Yes — intentional, manual |
| `tabGroups.onUpdated` backfill | background.js | No (title/color only) |
| Close → restore recreate (`{...data}`) | background.js | No (preserved) |
| `onReplaced` | background.js | No (verbatim move) |
| Reconciliation rebind on restart | tabService.js (initializeState) | No (preserved) |

The bug was **self-reinforcing** because of execution order on restart:

1. Chrome session-restores the pinned tab at a drifted URL (e.g. `youtube.com/?reload=true&from=close`, pathname `/`).
2. `initializeState` reconciliation re-binds the baseline to the new tab ID — **correctly** preserving the clean `data.url`. ✅
3. **`processTab(tab)` then runs** over every live tab. The session-restored URL has pathname `/` → `isDomainRoot` returned true → `autoUpdateUrl` was true → **the baseline URL was overwritten with the drifted URL**. ❌
4. The drifted baseline was persisted to `chrome.storage.local` immediately.
5. `safeHibernate` ran afterward (in the STARTUP HIBERNATE block) but read the now-poisoned baseline → its "reset to baseline before discard" logic saw no diff → no reset → the tab hibernated onto the drifted URL.

On the next restart the corrupted baseline loaded back, the tab restored to the drifted URL again, `isDomainRoot` fired again, and the drift was permanent. This is why every prior fix eventually relapsed.

A secondary flaw in the same rule: pinning `mail.google.com/mail/` and later navigating to `mail.google.com/` silently rewrote the deeper baseline down to root.

**Fix — Strict Immutability:**
Replaced the entire `isUrlDiff` / `isDomainRoot` / `autoUpdateUrl` / `finalUrl` machinery with a single rule:

> Once a baseline has a real URL, it **never** changes automatically. Only the two manual palette actions (`update_baseline`, `set_baseline_url`) may rewrite it.

The new logic only allows the URL to be seeded/upgraded when:
1. No baseline exists yet (first registration), OR
2. The stored baseline is a `chrome://` / `chrome-extension://` placeholder (a tab grouped before it navigated).

In every other case `finalUrl = data.url` — the URL is frozen. The other fields (`pinned`, `groupId`, `index`, `windowId`, `groupTitle`, `groupColor`) still update freely, and the eviction `else if (data)` branch is untouched.

**Why this is safe and complete:**
- The single automatic drift path is gone — the whole bug class is eliminated, not just one instance of it.
- `safeHibernate` now reads an unpoisoned baseline, so its reset-to-baseline logic (and the BUG-001 startup-hibernate fix) finally take effect.
- Close→restore already creates at `data.url` and re-binds `{...data}`, so it stays correct.
- No migration needed: users with already-drifted baselines keep them until they manually re-pin or use "Update Pinned URL". Lower risk than a storage migration.

**Intentional behavior change:**
Navigating a pinned tab to its domain root no longer auto-updates the baseline to root. To change a pinned URL intentionally, users use the **"Update Pinned URL"** palette action (which is video-timestamp aware) or **"Set Custom Baseline URL"**. This is the intended tradeoff of strict immutability and directly enforces the invariant: *the pinned URL should not be affected in any scenario*.

**Test checklist:**
1. Pin `youtube.com`, navigate to `youtube.com/watch?v=abc`, close → restores at `youtube.com`. ✅
2. Pin `youtube.com`, restart Chrome (Continue where you left off) → wakes at `youtube.com`, not the last-visited URL. ✅
3. Pin `mail.google.com/mail/`, navigate to `mail.google.com/` → baseline stays `/mail/`. ✅ (previously drifted)
4. "Update Pinned URL" while on a video → baseline updates to that URL (manual, intentional). ✅
5. Pin a fresh tab → baseline seeds on first navigation. ✅
6. Group a tab before it navigates → placeholder upgrades to first real URL. ✅

---

## BUG-004 — `hibernate_pinned` silently skipped the active pinned tab

**Status:** Fixed

**Location:** `services/paletteService.js` (`hibernate_pinned` case) + new `hibernateActiveTab` helper in `services/tabService.js`.

**Symptom:**
The "Hibernate All Pinned Tabs" command claimed to hibernate *all* pinned tabs, but silently skipped whichever pinned tab was currently active. No error, no feedback — the active pinned tab stayed loaded.

**Root cause:**
`chrome.tabs.query({ pinned: true })` returned the active pinned tab too. `safeHibernate` delegated to `safeDiscard`, which aborted on the active tab (`utils.js:56`: `if (tab.active) return`). Chrome's API forbids discarding the focused tab, so the abort itself was correct — but the command gave no indication a target was skipped.

**Same root cause as BUG-003 (`hibernate_current`):**
The `hibernate_current` command was a silent no-op *every time it ran*, because the "current" tab is by definition the active tab, so `safeDiscard` always aborted.

**Fix — shared `hibernateActiveTab` helper:**
Added `hibernateActiveTab(tab)` to `services/tabService.js` (next to `safeHibernate`). Chrome physically cannot discard the focused tab, so the helper:

1. **Activates an NTP** to receive focus, using the same cache → query → create resolution the Focus Guard uses (`ntpTabCache` → `chrome.tabs.query({url: NTP_URL})` → `chrome.tabs.create`). Honors `useDefaultNtp` (creates a native NTP when on).
2. **Awaits the activation** so the target tab is no longer active.
3. **Calls `safeHibernate(tab)`** — which now also resets protected tabs to their baseline URL first (BUG-005). `safeDiscard` re-checks `tab.active`, so a timing race degrades to a safe no-op rather than throwing.

**Command-level changes (`paletteService.js`):**
- `hibernate_current` → `await hibernateActiveTab(tab)` (was `safeHibernate(tab)`, which always aborted).
- `hibernate_pinned` → hibernates non-active pinned tabs directly via `safeHibernate`, then if an active pinned tab exists, runs `hibernateActiveTab` on it last (so focus only switches once, and only when necessary).

**What is unchanged:** `hibernate_all` / `hibernate_window` were already correct (they query `{ active: false }`) and are untouched. `safeHibernate` / `safeDiscard` are untouched — the helper composes them.

**Edge cases:** only-tab-in-window → NTP is created (2 tabs total); hibernating while on the NTP itself → `safeDiscard` aborts on `chrome-extension://` (no-op); `hibernate_pinned` with no active pinned tab → no NTP spawned, behavior unchanged.

---

## BUG-002 — Dead `evictionGraveyard` recovery branch in `onRemoved`

**Status:** Resolved — removed

**Location:** was `background.js:353–359` (the numeric-key recovery block).

**Symptom / risk:**
The branch was dead code, so the documented "Chrome ungroups tabs milliseconds before closure" recovery never fired. No observable bug resulted (see below), but the dead branch was misleading and read a `{data, timeout}` shape that nothing writes.

**Root cause:**
The `onRemoved` handler read the graveyard expecting a numeric-tabId key holding `{ data, timeout }`:

```js
let data = memoryBaselines.get(tabId);
if (!data && evictionGraveyard.has(tabId)) {
    data = evictionGraveyard.get(tabId).data;          // expects { data, timeout }
    clearTimeout(evictionGraveyard.get(tabId).timeout);
    evictionGraveyard.delete(tabId);
}
```

But **no code path anywhere writes such an entry.** Every `evictionGraveyard.set` in the codebase uses the string key `'inheritance_<tabId>'` with value `true` (see `background.js:137, 152, 192, 203`). So `evictionGraveyard.has(tabId)` (numeric id) was always false and the branch was unreachable.

**Resolution — removed (option 1 from the original options list):**
The guarded race is already handled without the graveyard. When a tab loses protection (unpinned/ungrouped), `processTab`'s eviction path (`tabService.js:424–450`) defers the baseline deletion by 500ms with a re-check. If the tab is closed *during* that window, the baseline is still live in `memoryBaselines` — so the plain `memoryBaselines.get(tabId)` lookup at line 353 succeeds and the normal restore path runs. The baseline is never stranded in a way the graveyard would need to rescue.

The change replaces the dead block with a single lookup and preserves the live `'inheritance_<tabId>'` cleanup:

```js
const data = memoryBaselines.get(tabId);
evictionGraveyard.delete(`inheritance_${tabId}`);
```

`let` → `const` since `data` is no longer reassigned.

**Why this is safe:**
- **No behavior change** — the branch never fired.
- **Inheritance suppression intact** — the four `'inheritance_…'` writers (`background.js:137, 152, 192, 203`), their consumers (`background.js:224, 246`), and the cleanup at the old line 359 are all preserved.
- **Deferred eviction intact** — `processTab`'s 500ms eviction window is untouched; a close during that window still restores via the live `memoryBaselines` lookup.

---

## BUG-001 — Hibernated protected tabs reload at their last URL, not the baseline URL

**Status:** Fixed

**Location:** `services/tabService.js:273–279` (startup bulk-hibernate block)

**Symptom (reported):**
Protected (pinned / grouped) tabs, once hibernated or after a restart, wake up at the **last URL they were on** rather than their clean baseline URL. Closing such a tab *does* restore it correctly, but restarting Chrome re-breaks it.

**Root cause:**
There are five code paths that put a tab to sleep. Four correctly reset protected tabs to their baseline URL before discarding; one bypasses that logic:

| Path | Discard call | Resets to baseline? |
| :--- | :--- | :--- |
| Manual palette hibernate (`hibernate_all/window/pinned/current`) | `safeHibernate(tab)` | ✅ Yes |
| Auto-hibernate alarm | `safeHibernate(tab)` (also skips protected tabs) | ✅ Yes |
| Close → restore recreate | `safeDiscard(newTab.id, …, data.url)` | ✅ Yes |
| Neighbor-Guard re-discard (focus redirect) | raw `chrome.tabs.discard` | n/a (re-sleeps a just-woken tab) |
| **Startup bulk-hibernate** | **raw `chrome.tabs.discard`** | ❌ **No** |

The startup path was calling `chrome.tabs.discard(tab.id)` directly:

```js
toHibernate.forEach((tab, i) => {
    setTimeout(() => {
        chrome.tabs.discard(tab.id).then(() => {   // ← raw discard, no baseline reset
            discardedTabs.add(tab.id);
        }).catch(() => {});
    }, i * 50);
});
```

**Failure sequence on restart:**
1. Chrome's "Continue where you left off" restores a pinned tab at its **last** URL (e.g. `youtube.com/watch?v=abc`).
2. Tabs++ `initializeState` keeps the baseline at the clean URL (`youtube.com`) — the URL-update rule refuses deep navigations.
3. The startup-hibernate block freezes the tab at `youtube.com/watch?v=abc` via raw discard — the URL Chrome loaded, **not** the baseline.
4. User clicks the tab → it wakes at `youtube.com/watch?v=abc`. Bug.

`safeHibernate` (`services/tabService.js:24–34`) exists exactly to prevent this: it navigates a protected tab back to `baseline.url` *before* discarding. The startup path simply wasn't using it.

**Fix:**
Replaced the raw `chrome.tabs.discard` with `safeHibernate(tab)`:

```js
toHibernate.forEach((tab, i) => {
    setTimeout(() => {
        safeHibernate(tab).catch(() => {});
    }, i * 50); // 50ms stagger between each discard
});
```

**Why this is safe:**
- For **protected** tabs: resets to `baseline.url` before discarding → fixes the bug.
- For **unprotected** tabs: `baseline` is undefined, so `safeHibernate` passes `undefined` to `safeDiscard`, which performs no URL rewrite → identical to the old behavior.
- `safeHibernate` early-returns on `tab.discarded`, and the startup filter already excludes discarded tabs.
- The explicit `discardedTabs.add(tab.id)` was removed because the `onUpdated` listener at `background.js:213–214` already adds the id when the `discarded:true` event fires.
