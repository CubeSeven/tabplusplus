# Tabs++ — Optimization Roadmap

A living record of optimization work: what's done, what's deferred, and what's
explicitly not worth doing. New entries go at the top.

---

## Status legend

- ✅ **Done** — shipped, verified
- ⏸️ **Deferred** — worth doing, blocked on a prerequisite
- 🚫 **Won't do** — evaluated and rejected (with reasoning)

---

## ✅ Done — v2.5.0 internal cleanup pass

### Repetitive switch cases → lookup tables (`paletteService.js`)
The `executeAction` switch had ~25 one-liner `chrome://` navigation cases plus
the `pomo_*` and `vol_*` families, all near-identical. Collapsed into three
static lookup maps (`CHROME_URL_MAP`, `POMO_PRESETS`, `VOL_ACTIONS`) consumed
by a single `default:` branch. Adding a new chrome:// quick-link is now one
line in a table instead of a new `case`. Also fixed a stale comment reference
("line ~332" → "line ~430").

### O(N×M) → O(N) tab dedupe (`setService.js`)
`createOrClaimTab` ran `allTabs.find(...)` over every open tab for every tab-def
in a set/bookmark launch — O(N×M) on a 100-tab launch into a 100+ tab window.
Now builds a `Map<canonicalUrl, tab[]>` once in `materializeTabs` and looks up
only the candidates sharing the target canonical URL. Claim-once semantics
preserved via splice on the small per-URL array.

### Shared window-launch pipeline (`setService.js` + `bookmarkService.js`)
`performLaunchSet` (sets) and `bookmarkService`'s new-window launch were ~30
near-identical lines each (acquire launch lock → create empty window →
materialize tabs → remove seed NTP → release lock). Extracted a single
`launchInNewWindow(tabDefs)` in `setService.js`; both now call it. The bookmark
path keeps its own `BOOKMARK_TAB_CAP` application beforehand.

### Message-handler robustness (`background.js`)
13 async message handlers (sets, prompts, vault, bookmarks, execute-action)
held the message port open (`return true`) but never called `sendResponse` if
their promise rejected — producing *"The message port closed before a response
was received"* console errors. Added `.catch()` to every async response chain
and `sendResponse` to every validation-guard early-return.

### `summon-set` false-rejection bug (`background.js`)
The Summon ("Insert") handler validated `request.windowId` with
`Number.isFinite()`, but the popup's Summon button never sends a `windowId`.
Valid requests were silently dropped (no response), so Summon appeared broken.
Fixed: validate only `request.name` — `performSummonSet` already resolves the
current window itself when `windowId` is omitted.

### Input-validation guards (`paletteService.js`)
`executeAction` did `commandId.includes('|')` with no type check, and the
`set_baseline_url` case did `args.trim()` guarded only by truthiness. Both now
validate `typeof` first (AGENTS.md rule #7).

### AGENTS.md compliance audit
Verified rules #2 (listener leaks), #3 (tracking cleanup), #12 (injection
guard), #13 (state.js purity). All clean. See the audit summary in the v2.5.0
release notes.

---

## ⏸️ Deferred — palette client deduplication

**The opportunity:** ~500 lines of near-verbatim code is duplicated between the
in-page palette (`content.js`) and the NTP palette (`ntp.js`): the constants
(`GROUP_COLORS`, `SECTION_ORDER`, `ICONS`, `LOGO_ICON`, `TYPE_FALLBACK`), the
helpers (`getQueryRegex`, `escapeHTML`, `highlight`, `debounce`), the
`renderResults` item-builder, `handleActionModeInput`, the prompt-style action
rewriter, and ~200 lines of CSS. The *search/execution brain* is already
shared (`services/paletteService.js`); only the client UI layer is duplicated.

**Why it's deferred:** A clean extraction is **architecturally blocked without a
bundler**. `content.js` is a statically-declared content script running in
Chrome's isolated world, and `ntp.js` is a classic `<script>` (not a module).
Neither can use ES `import`. A first attempt (a shared classic script loaded
before both consumers) failed at runtime: content scripts have **three
independent injection paths** (static manifest declaration, programmatic
`chrome.scripting.executeScript` fallback, NTP page script), and guaranteeing
load order across all three proved fragile — a tab that pre-dated the extension
load crashed with `Cannot destructure property 'getQueryRegex' of
'window.__tabsppPalette' as it is undefined`.

**The prerequisite:** Introduce a minimal build step (esbuild is the natural
choice — fast, zero-config, no opinion on framework). Once both `content.js`
and `ntp.js` can truly `import` from a shared module, the extraction becomes
trivial and the three-injection-path problem disappears (the bundler inlines the
shared code into each output bundle).

**What NOT to do:** Do not re-attempt the shared-classic-script approach. The
duplication exists *because* of Chrome's content-script isolation constraint;
working around it without a bundler reintroduces the exact crash above.

**Effort estimate:** Half a day with testing (esbuild setup + the extraction
itself + exercising both palettes: search, arrow-key nav, `>` action mode,
prompt vault, recently-closed, sets, bookmark folders).

---

## 🚫 Won't do — low-value AGENTS.md items

These rules were evaluated during the v2.5.0 audit and judged not worth
pursuing in this codebase:

| Rule | Why rejected |
|---|---|
| **#4** Set-vs-Array on remaining `.some()`/`.find()` | The one real hotspot (setService O(N×M)) is fixed. Remaining calls are on tiny lists (3–5 domain groups). Cosmetic. |
| **#8** Hunt every `setTimeout` in content.js | High effort across a 3,400-line file; a stray timeout firing on a hidden palette is a no-op focus/ redundant DOM op, not a real defect. |
| **#9** Event delegation on result items | Already uses capture-phase delegation for the one non-bubbling event that matters (image `error`). Per-render listeners on ~50 items aren't a measurable leak. |
| **#14** Split `content.js` into feature modules | AGENTS.md itself marks this "deferred (high risk, zero user benefit)." Re-affirmed: don't touch without a bundler (see palette dedup above) and a dedicated testing window. |

---

## Maintaining this document

When making optimization changes, update the **Done** section with a brief
entry (what changed, where, why). When evaluating but deferring work, add to
**Deferred** with the blocker. When rejecting work outright, add to **Won't do**
with reasoning, so the same idea isn't re-evaluated later.
