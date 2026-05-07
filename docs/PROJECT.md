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
