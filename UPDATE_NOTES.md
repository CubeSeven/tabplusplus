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
