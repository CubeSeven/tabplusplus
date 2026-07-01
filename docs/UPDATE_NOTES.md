Latest Update: v2.5.0 (Under-the-Hood Maintenance & Stability)

> ⚠️ **This version contains a major codebase change and needs good testing.**
> No new features — this is a deep internal cleanup that touches the core
> command-palette, tab-set, and bookmark-launch engines. Everything *should*
> behave exactly as before (only faster and more reliably), but please test
> your usual workflows over the next few days and report anything off. A full
> list of what to check is at the bottom of these notes.

**What changed:**

- **Fixed: "Insert Set" (Summon) was silently broken.** Clicking the ↓ Summon button in the Sets panel did nothing and logged a console error. The message handler was rejecting valid requests from the popup, so the command never reached the engine. Summon now works again, alongside Replace.
- **Killed the "message port closed" console spam.** Thirteen background handlers could leave a message hanging if an operation failed, producing a recurring `Unchecked runtime.lastError: The message port closed before a response was received` error in the console (visible when inspecting the popup). Every background message handler now responds cleanly, success *or* failure.
- **Faster Set and bookmark launches.** When inserting or launching a large Set or bookmark folder into a window that already has many tabs, the deduplication step no longer re-scans every open tab for every incoming tab. It now uses an indexed lookup, so launches into busy windows are noticeably snappier.
- **One shared launch pipeline.** Launching a Set in a new window and launching bookmarks in a new window used to run two near-identical copies of the same window-creation + lock + seed-tab-cleanup code. They now share a single implementation, so future fixes land once.
- **Tidier command catalog.** The ~25 "open chrome:// page" quick-actions (Settings, Downloads, Flags, GPU, Privacy, etc.) plus the Pomodoro and Volume shortcuts were collapsed from repetitive switch-cases into scannable lookup tables. No behavior change — just easier to maintain and extend.
- **Harder command input validation.** The action engine now validates its inputs at the boundary, so a malformed message fails gracefully instead of throwing.

**Stability audit performed** (no user-visible change, but documented for transparency): verified tab/window tracking structures all clean up on close, no Chrome-API listener leaks, the content-script injection guard is in place, and `state.js` stays minimal. See `docs/OPTIMIZATION.md` for the full technical breakdown.

---

**Please test these workflows and report regressions:**
- Command palette (Ctrl+Shift+K) on a normal page: search, arrow-key navigation, `>` action mode, recently-closed, prompt vault.
- Command palette on the New Tab Page: same checks.
- `> open folder <name>` and "Insert All Bookmarks" — bookmark folder launches.
- Sets panel: **Summon (↓)**, **Replace (⇄)**, Launch, Save, Delete.
- Quick links: `> downloads`, `> settings`, `> gpu`, a Pomodoro command, a Volume command.
- Hibernation (`Ctrl+Shift+H`) and tab protection (pinned/grouped tabs restoring on close).

---

Latest Update: v2.4.0 (Launch Bookmark Folders as Tabs + Groups)

**What's new:**

- **Import bookmarks from the command palette (`>` mode):** Type `> open bookmarks` to see two choices — **Insert All Bookmarks in New Window** (loads the entire collection into a fresh window, each top-level root folder becoming its own tab group) and **Insert a Bookmarks Folder...** (drills into a searchable list of every folder and subfolder, each labeled with its hierarchy path, e.g. `Bookmarks Bar / Dev / React`). Selecting a folder inserts its bookmarks into the current window, all grouped under a single tab group named after the folder.
- **Hard-capped at 100 tabs** per launch to keep Chrome responsive, keeping the most-curated (top-of-tree) bookmarks first.
- **Subfolders become tab groups automatically:** Each immediate subfolder turns into a named, deterministically-colored Chrome tab group; loose bookmarks at the folder's top level open as ungrouped tabs. Deeper-nested URLs roll up into their nearest subfolder's group.
- **Reuses the Sets engine:** Folder launches go through the same tab+group materialization pipeline as Sets, so grouping, dedup, and the window-launch lock all behave identically. Requires the existing "Search Bookmarks" toggle (grants the optional `bookmarks` permission); the toggle's description now notes the 100-tab launch cap.

---

Latest Update: v2.3.0 (Palette Appearance Refresh)

**What's new:**

- **Frosted glass is now the default palette look:** The clean frosted-glass treatment (subtle blur, crisp specular edge, borderless search row, rounded pill badges) is now what every user sees out of the box — no toggle needed. The old heavy-blur/outer-shadow default has retired.
- **Removed the experimental Liquid Glass toggle:** The opt-in refractive-glass experiment (and the earlier SVG displacement-map variant) have been removed entirely. The frosted look above is the single, polished palette theme.

---

Latest Update: v2.2.3 (Bug Fixes & UX Polish)

**What's new:**

- **Palette toggle reliability:** Disabling then re-enabling the command palette no longer leaves the Tools tab stuck saying "enable palette." Settings now refresh on every tab switch.
- **Protection drops immediately:** Turning off "Protect Grouped Tabs" or "Protect Pinned Tabs" instantly evicts their baselines — no more tabs restoring after you told them not to.
- **Instant protection for existing tabs:** Turning protection ON now covers already-open pinned/grouped tabs right away, not just newly opened ones.
- **Liquid Glass no longer breaks suggestions:** Removed the SVG displacement map that caused rendering glitches and killed auto-suggestions. The blur/brightness/saturate effect remains.
- **Peek blur reliability:** Blur overlay is now tracked on the background side, with cleanup on tab close, window close, and tab activation. No more stuck blur after peek closes.
- **Better discoverability:** Shortcut hint (Ctrl+Shift+K) added to Command Palette card, "> for tools" in the search bar, and an info banner on the Tools tab.
- **PiP conflict warning:** PiP Player card now notes potential conflicts with other Picture-in-Picture extensions.

---

Latest Update: v2.2.2 (Performance & Stability)

**What's new:**

- **Pick your search engine:** Type `> search engine` in the palette to switch between Google, DuckDuckGo, Bing, Brave, or Perplexity. All searches, suggestions, and raw Enter queries follow your choice.

- **Choose your new tab:** A "Use Browser's New Tab Page" toggle in popup Settings. ON = Chrome's real native NTP with your browser's search engine. OFF = Tabs++ NTP. No forced override, no redirects to random pages.

- **Smarter peek:** Auto-peek now skips search engines, social media, video sites, and shopping. Use `> peek block site` / `> peek unblock site` to customize per-site. Shift+Click always peeks.

- **One NTP per window:** No more duplicate new-tab pages piling up.

- **Cleaner palette:** Removed the viewport dimming overlay. Enhanced drop shadow so the palette still pops.

- **Recent commands improved:** Recently used actions now correctly show in the `>` menu, including search engine switches.

- **Settings no longer vanish:** Fixed a bug where toggling one setting could accidentally reset others.

- **Tons of fixes:** NTP redirect reliability, Focus Guard + palette fallback conflicts, Ctrl+Shift+T restore handling, stale cache cleanup, DDG suggest API crash.

---

Latest Update: v2.0.5 (The "Reliability" Update)
This update introduces a deterministic locking mechanism for tab sets, resolving race conditions in group creation.

- **Window Launch Lock**: Implemented a new architectural lock that suppresses auto-grouping specifically for windows being launched as a Set. This eliminates the "duplicate group" bug across all Chromium forks (including Helium).
- **Timer Accuracy Note**: Clarified that short-interval timers (like 1m) have a variable delay due to Manifest V3 service worker constraints and Chrome's internal alarm throttling.

---

Latest Update: v2.0.1 (The "Stability" Update)

This update focuses on stability, fixing several user-reported issues with tab sets and the command palette.

- **Command Palette Fix**: Typing in the action pane (e.g., when naming a set) no longer dismisses the palette prematurely.
- **Set Integrity**: Fixed a bug where launching a saved set in a new window would duplicate tab groups.
- **Pinned Tab Sets**: Workspace saving now correctly includes pinned tabs in the saved set.
- **Global Hibernation Shortcut**: Added `Ctrl+Shift+H` (Mac: `Cmd+Shift+H`) to instantly hibernate all background tabs across all windows.
- **Custom Hibernation Timeout**: The "Ruthless Clean" engine's inactivity threshold can now be configured via the command palette.
- **New Actions**: Added "Save all tabs" and "Group all tabs" to the Action Engine for faster window management.

---

Latest Update: v2.0.0 (The "Evolution" Update)

This is a massive architectural and feature release, transforming Tabs++ from a tab-persistence tool into a full Browser OS productivity suite.

### 🍅 Focus & Flow: Pomodoro Timer
Introduced a non-intrusive, cross-tab synced Pomodoro timer.
- **Background Persistence**: Uses `chrome.alarms` to ensure timers continue even if the active tab is closed.
- **Cross-Tab Sync**: The glassmorphic timer "pill" appears on every tab and stays perfectly in sync.
- **Pomo Logic**: Automatic transitions between Work and Break periods with desktop notifications.

### 📖 Content First: Focus View
Added a premium Reader Mode ("Focus View") to strip distractions from any article.
- **Clean Interface**: A custom-built, monochromatic reading environment with optimized line-height and typography.
- **Zero Distractions**: Hides all ads, sidebars, and navigation menus.
- **Injected Shadow DOM**: Ensures the reader interface never conflicts with the host site's styles.

### 🔢 Smart Converter & Math Engine
The Command Palette now includes a real-time calculation and unit conversion engine.
- **Real-time Math**: Perform math operations directly in the search bar.
- **Unit Conversions**: Support for Pixels to REM, Metric to Imperial, and more.
- **Color Tools**: Instant Hex to RGB/HSL conversion with "Copy to Clipboard" actions.

### 🚀 Performance & Architecture Cleanup
- **Push-Model Sync**: Replaced expensive 5-second polling loops with a message-driven architecture, drastically reducing CPU idle usage.
- **Discard Filtering**: Background broadcasts now explicitly target non-discarded tabs, preventing "Unchecked runtime.lastError" messages and improving wake-up performance.
- **Unified Logic**: Merged duplicate logic across `content.js` and `ntp.js` for 1:1 feature parity.

### 🛡️ Hardened Persistence
- **Hibernation Parity**: Hibernating a protected tab now correctly resets its URL to the baseline URL, ensuring "Sleep" and "Close" behave identically.
- **Pinned Release**: Bulk-close commands now include pinned tabs, allowing the extension to catch and reset them to their clean baseline state.
- **Eviction Graveyard**: Advanced race-condition buffer that prevents tab loss if Chrome ungroups tabs milliseconds before closure.

---

Latest Update: v1.7.2 (The "Ghost Hunter" Update)

This update resolves critical edge cases in tab restoration and improves memory management for large sessions.

- **Stale Baseline Cleanup**: Implemented a window-level purge for internal tab baselines. Closing a window now correctly wipes associated data.
- **Unnamed Group Guard**: Added protection logic to ignore "unnamed" groups during restoration, eliminating "ghost" groups.
- **Atomic Auto-Grouping**: Hardened the auto-grouping sequence to ensure group metadata is synchronized before the tab state is processed.

---

Latest Update: v1.5.8 (The "Workspace Integrity" Update)

- **Group Inheritance Protection**: Resolved a bug where new tabs opened from protected tabs would incorrectly inherit the group state.
- **NTP Search Persistence**: Fixed a bug where search queries on the New Tab Page would persist incorrectly.
- **About Tab**: Introduced a dedicated "About" section in the extension popup.

---

Latest Update: v1.5.0 (Action Engine & Peek Windows)

- **Command Palette Action Engine**: Type `>` to execute 20+ powerful system commands.
- **Transient Peek Windows**: Shift+Click any link to explore content in a popup without creating tab bloat.
- **Promote to Workspace**: Move content from a Peek Window back to your primary window with one click.
