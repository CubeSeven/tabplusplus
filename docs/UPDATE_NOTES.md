Latest Update: v2.2.0 (The "Flexibility" Update)

This update gives you more control over how Tabs++ works.

- **Search Engine Picker**: Type <code>> search engine</code> in the palette to choose from Google, DuckDuckGo, Bing, Brave, or Perplexity. All search queries, suggestions, and raw Enter searches use your chosen engine.
- **Default NTP Toggle**: A new toggle in the popup Tools tab lets you redirect new tabs to your search engine homepage instead of the Tabs++ dashboard. Zero visual flash.
- **Smart Peek Blocklist**: Auto-peek now skips navigational sites (search engines, social media, video, shopping). Use <code>> peek block site</code> / <code>> peek unblock site</code> to customize per-site.
- **NTP Singleton**: Tabs++ now prevents duplicate NTP tabs from accumulating — only one NTP per window.
- **Settings Protection**: Fixed a bug where some settings could be lost after saving.

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
