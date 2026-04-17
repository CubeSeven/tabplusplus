# Tabs++ | Project Master Document

## Core Concept
Chrome extension for workspace persistence. Transform standard tabs into a "Browser OS" where your workspace survives crashes, accidental closures, and browser restarts.

### Primary Mechanics
- **Tab Protection**: All pinned tabs and tabs inside native Chrome Groups are "protected".
- **Instant Restore**: If a protected tab closes, background script recreates it immediately at its baseline URL.
- **Standalone Inheritance**: New tabs opened from protected tabs open as standalone instances (suppressed inherited state).
- **Resource Sleep**: Restored tabs use **Deterministic Hibernation** (created and instantly discarded to use zero RAM).
- **Eviction Graveyard**: Advanced race-condition buffer that prevents tab loss if Chrome ungroups tabs milliseconds before closure.
- **Vault Auto-Heal**: Passive engine that detects and corrects native Chrome session restore group drops.
- **Auto-Archive**: Alarms-driven cleanup of unprotected loose tabs after 12 hours of inactivity.

## Navigation & Control
### Command Palette (`Ctrl+Shift+K`)
Global spotlight-style search for:
- Open Tabs
- Browser History
- Bookmarks
- **Bangs**: Type shortcuts like `!yt` (YouTube), `!gh` (GitHub), or `!gpt` (ChatGPT) for instant external search.

### Action Engine (`>`)
Type `>` in the palette to trigger native browser commands:
- **Tidy Engine**: Magic Organize (auto-group by domain), Dedupe Window, Ungroup All, Gather Standalone.
- **Performance**: Hibernate All (flush background RAM), Pause All Media (global audio/video kill-switch), Mute Background.
- **Dynamic Commands**: `summon [term]` (pull Set/Group), `launch [term]` (open Set in new window), `delete set [term]`.
- **Smart Control**: **Smart URL Update** (Video timestamping for YouTube/Vimeo), Zen Fullscreen, Panic Close.
- **System Links**: 30+ keywords for internal Chrome settings (`flags`, `gpu`, `privacy`, etc.).

## Transient Peek
- **Peek Window**: Shift+Click any link to open it in a transient popup window. Allows exploration without workspace bloat.
- **Promotion**: Use the "Promote to Workspace" button inside a Peek window to move the tab back to your main browser window.

## Safety & Backup
- **Session Vault**: Hard-disk backup of your workspace state. 
- **Auto-Snapshot**: Periodically saves your pins/groups to local storage.
- **Startup Recovery**: If Chrome fails to restore your tabs on launch, use the Vault (via Popup or Palette) to revive your entire workspace.

## Technical Notes
- **Manifest**: v3
- **Storage**: `chrome.storage.local`
- **Logic**: Event-driven background worker (`background.js`), Shadow DOM palette injection (`content.js`).
- **Privacy**: 100% Local. No cloud. No tracking.
