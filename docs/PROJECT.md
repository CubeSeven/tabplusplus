# Tabs++ | Project Master Document

## Core Concept
Tabs++ transforms Chrome into a **Browser OS** where your workspace is immutable and persistent. It eliminates "Tab Anxiety" by ensuring your organized pins and groups never stay closed accidentally, while providing a minimalist, keyboard-first toolset.

---

## 🏗 System Architecture

### 1. Persistence & Protection
- **Tab Protection**: All pinned tabs and tabs inside native Chrome Groups are "protected".
- **Instant Restore**: If a protected tab closes, `background.js` recreates it immediately at its baseline URL.
- **Deterministic Hibernation**: Restored tabs are created and instantly "discarded" to consume **zero RAM/CPU** until interacted with.
- **Inheritance Suppression**: New tabs opened from protected tabs open as standalone instances (no auto-pinning/auto-grouping).

### 2. Guard Engines
- **Eviction Graveyard**: A race-condition buffer that prevents tab loss if Chrome ungroups tabs milliseconds before closure.
- **Focus Guard**: Prevents navigation drift. When an active tab is closed, focus redirects to a clean New Tab Page while the protected tab reloads silently in its original spot.
- **Ruthless Clean**: An alarms-driven engine that archives loose, unprotected tabs after 12 hours of idle time.
- **Auto-Collapse**: Periodically collapses inactive tab groups to maximize horizontal tab strip space.

---

## 🛠 Command Palette & Action Engine

### Search Layer (v2.7 additions)
- **Engine cycling**: clients cycle a per-session engine override with Tab; the SW (`paletteService`) builds search/suggestion URLs from the override and reports the active engine back in every response. Bangs still take precedence.
- **Engine tab reuse**: engine-search URLs navigate an existing tab on that engine's origin (`open-url` handler).
- **Local-first ranking** (`services/searchRanking.js`): opt-in re-rank of results; strong local match → `tophit` section (clients render `tophit` / `suggestion` sections).

### Bookmarks Auto-Restore (v2.7)
`services/bookmarkService.js` — startup reconcile behind a 10s settle timer + 30s `chrome.alarms` backstop. Acts only when >30% of bookmarks are missing; folds into a surviving window (≥2 tab signal) or reuses a lone blank window; live adds fold into the tracked bookmarks window (burst-guarded, ≤10). Watchers register lazily behind the optional permission and re-register on grant (popup-driven message, since `permissions.onGranted` is unavailable in SWs).

### Undo tokens (v2.7)
Single undo slot (`lastClosedTabs`) with a serial (`state.undoSerial`); toasts carry the serial and stale Undos are rejected; restore falls back to live windows.

### Session-state mirror (v2.7)
`services/sessionState.js` persists volatile SW state (focus-pending, launch locks, bookmark window id) into `chrome.storage.session`, so SW death mid-operation no longer corrupts it. `state.js` stays pure (AGENTS.md #13).

### Search Layer
Spotlight-style search across:
- **Open Tabs** (with window-switching support)
- **Recently Closed** (integrated `chrome.sessions` results)
- **Bookmarks & History**
- **Bangs**: Instant external search (e.g., `!yt`, `!gh`, `!mdn`, `!npm`).

### Execution Layer (`>`)
The Action Engine converts natural language into system commands:
- **Tidy Engine**: `Magic Organize` (auto-group by domain), `Dedupe Window`, `Ungroup All`.
- **Media Control**: `Pause All Media` (global kill-switch), `Toggle PiP`, `Toggle Mute`.
- **Performance**: `Hibernate Background`, `Hibernate Window`, `Clear Cache`.
- **Productivity**: `Focus View` (Reader Mode), `Eyedropper`, `Full Screenshot`, `Smart Converter`.

---

## 🎒 Specialized Tools

### 1. Pomodoro Timer
- Cross-tab synced glassmorphic UI.
- `chrome.alarms` based persistence (works even if tabs are closed).
- Minimalist pill-shaped overlay in the corner of active pages.

### 2. Focus View
- Heuristic content extraction.
- Monochromatic, glassmorphic reading interface injected via Shadow DOM.
- Clean typography and distraction-free layout.

### 3. Smart Sets
- **Workspace Sets**: Save all open tabs in a window.
- **Group Sets**: Save specific groups.
- **Persistence**: Sets are stored in `chrome.storage.local` and can be summoned or launched in new windows.

---

## 🎨 Design System
- **Aesthetic**: Monochromatic, Glassmorphic, Premium.
- **Theme**: High-contrast dark mode (`rgba(22, 22, 26, 0.85)`).
- **Isolation**: All UI elements are injected via **Shadow DOM** to prevent CSS leakage or host site interference.

---

## 📈 Technical Specs
- **Manifest**: v3
- **Primary APIs**: `tabs`, `tabGroups`, `alarms`, `storage`, `sessions`, `notifications`, `scripting`.
- **Logic**: Event-driven background worker (`background.js`), modular service architecture (`tabService`, `pomoService`, `paletteService`).
