# Tabs++ | Project Master Document

## Core Concept
Chrome extension for workspace persistence. Transform standard tabs into a "Browser OS" where your workspace survives crashes, accidental closures, and browser restarts.

### Primary Mechanics
- **Tab Protection**: All pinned tabs and tabs inside native Chrome Groups are "protected".
- **Instant Restore**: If a protected tab closes, background script recreates it immediately at its baseline URL.
- **Resource Sleep**: Restored tabs are created in a "discarded" (hibernated) state. They use zero RAM/CPU until you click them.
- **Eviction Graveyard**: Advanced race-condition buffer that prevents tab loss if Chrome ungroups tabs milliseconds before closure.

## Navigation & Control
### Command Palette (`Ctrl+Shift+K`)
Global spotlight-style search for:
- Open Tabs
- Browser History
- Bookmarks
- **Bangs**: Type shortcuts like `!yt` (YouTube), `!gh` (GitHub), or `!gpt` (ChatGPT) for instant external search.

### Action Engine (`>`)
Type `>` in the palette to trigger native browser commands:
- **Tidy**: Magic Organize (auto-group by domain), Dedupe Window, Ungroup All.
- **Performance**: Hibernate All (flush background RAM), Pause All Media (global audio/video kill-switch).
- **Control**: Stash Workspace (save profile and close window), Zen Fullscreen, Panic Close (wipe last hour history).

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
