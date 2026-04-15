# Tabs++
[**Live Demo & Docs**](https://cubeseven.github.io/tabplusplus/)

**Tabs++** is a minimalist, high-performance Chrome extension designed to make your browsing experience more persistent. It ensures that your **Pinned Tabs** and **Tab Groups** never stay closed accidentally. It enhances your browser's **native** vertical/horizontal tabs silently—no bulky custom sidebars are injected.

## 🚀 Features

- **Persistent Pinned Tabs**: Automatically recreates pinned tabs if they are closed, resetting them to their original URL.
- **Persistent Tab Groups**: Full support for Chrome Tab Groups. If a tab within a group is closed, it is restored back into its original group and position.
- **Resource Optimized**: Restored tabs are automatically "discarded" (hibernated) after 1 second, meaning they consume **zero RAM and CPU** until you actually click on them.
- **Command Palette (`Ctrl+Shift+K` on Windows/Linux, `Cmd+Shift+K` on Mac)**: A Spotlight-style search tool to quickly access open tabs, bookmarks, history, and perform quick searches using "bangs" (e.g. `!yt` for YouTube). You can change this shortcut anytime via `chrome://extensions/shortcuts`.
- **Minimal Configuration**: A monochromatic, lean settings menu to toggle protection for pinned or grouped tabs independently.
- **Zero Background Overhead**: Uses a non-persistent Manifest V3 Service Worker that only wakes up when needed.

## 🛠 Installation

1. Clone this repository or download the source code.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the extension folder.

## 📦 For Chrome Web Store
The project includes a `manifest.json` fully compliant with Manifest V3 standards, ready for submission to the Chrome Web Store.

## 📄 License
MIT
