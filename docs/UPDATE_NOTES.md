Tabs++ Features and Updates

Tabs++ is designed to bring the tab organization and persistence features of popular vertical-tab browsers to Chrome. It allows you to use pinned tabs and tab groups as primary workspace organizers instead of bookmarks.

Core Features

Spotlight Search
A spotlight-style search bar is available via Alt+Shift+K (or Shift+K depending on your configuration). It supports instant searching across your open tabs, history, and bookmarks. It also includes "bangs" (shortcuts like !yt for YouTube) to quickly search external websites directly from the bar.

Persistence and Protection
Any pinned tab or tab within a group that is closed is instantly recreated at its original URL. This ensures your carefully organized workspace remains intact even if a tab is accidentally dismissed.

Automated Organization
Restored tabs return to their exact original position and group within your windows, maintaining your custom structure and workflow.

Performance Optimization
To preserve system resources, restored tabs are automatically hibernated. They consume zero RAM or CPU until you click on them, ensuring that a large workspace does not slow down your computer.

Latest Update: v1.5.2 (The "Power User" Patch)

This update focuses on keyboard-first productivity, architectural stability, and addressing user feedback regarding shortcut conflicts.

### Keyboard & Action Engine Expansion
The Action Engine (`>`) has been supercharged with high-frequency productivity commands:
- **Workspace Cleanup**: `Clear Unprotected Tabs` instantly sweeps away loose tabs while keeping your protected (pinned/grouped) workspace intact.
- **State Control**: Toggle `Pinned` or `Group` status entirely from the keyboard.
- **Productivity**: `Copy Markdown Link` for instant research logging.
- **Split View**: Spawn a side-by-side window layout perfectly synced with your current tab state.

### Intelligent Search Aliases
You no longer need to remember exact command names. Search now supports invisible aliases:
- Searching for `refresh`, `f5`, or `cache` will instantly surface the **Hard Reload** command.
- Searching for `ram`, `memory`, or `hibernate` surfaces performance tools.

### Chrome Deep-Linking
Integrated 20+ specialized deep links to internal browser settings (GPU, Performance, Privacy, Flags), mapped to easily searchable keywords.

### Improved Accessibility
Switched default shortcut to `Ctrl+Shift+K` (Windows/Linux) and `Cmd+Shift+K` (macOS) to avoid conflicts with system-level overlays. Added a direct "Change Shortcut" link in the popup for easy customization.

---

Latest Update: v1.5.1 (Patch Release)

Fixed critical missing permissions for the Action Engine (Panic Close and Media Pause). Improved tab deduplication logic to ignore URL fragments. Sanitized background worker logs for production performance.

---

Latest Update: v1.5.0

This massive update transforms the Command Palette into a full Browser OS Action Engine and introduces Transient Peek Windows.

Command Palette Action Engine
The palette is now an execution layer. Type `>` to instantly summon 14 powerful commands that can:
- Magic Organize your entire workspace by clustering loose domains.
- Safely hibernate all background tabs to instantly free up gigabytes of RAM.
- Instantly pause all media streams across all tabs.
- Flatten and ungroup complex workspace trees.

Transient Peek Windows
You can now Shift+Click any link, or click an external link within a protected tab natively, to spawn a Transient Peek popup. This allows you to explore external content without sacrificing your workspace state or creating tab bloat.

Promote to Workspace
Content inside a Peek Window can be sent back to your primary browser workspace instantly via an injected "Promote" floating button on the bottom right. Promoted tabs are decoupled from their initial group to give you a pristine standalone tab.

Technical Improvements
Built an "Eviction Graveyard" that entirely circumvents a persistent Chrome bug where grouped tabs are incorrectly reported as discarded right before closure, ensuring 100% data preservation during race conditions.
