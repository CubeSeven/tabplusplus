# Tabs++ — What's New (v2.3.3 → v2.6.0)

This covers everything that changed since the version currently on the Chrome Web Store.

---

## v2.6.0 — Bug fixes + bookmark folders

### Pinned & grouped tabs are safer
- **Crash recovery:** If the browser crashes or is force-quit, your pinned and grouped tabs are now automatically saved. When you reopen, the popup footer shows a one-click "Restore" button to bring them all back.
- **Cleaner pinned-tab closing:** Closing a pinned tab now puts it right back where it was (hibernated) — instead of sometimes creating an extra empty tab alongside it.
- **Pinned URLs stick:** Pinned tabs now remember the URL you originally pinned them at, even after browsing away and restarting the browser. They always wake up at the right page.

### Closing tabs is cleaner
- **No more waking the neighbor:** When you close a pinned or grouped tab, the tab next to it (if it was hibernated) no longer wakes up on its own.
- **No stray empty tabs:** Closing many tabs at once no longer leaves behind leftover blank tabs.

### Bookmarks
- **Folders become groups:** "Insert All Bookmarks in New Window" now creates one tab group per *folder you actually created* — not just one big group per Chrome section ("Bookmarks Bar", "Other Bookmarks"). Each folder gets its own name and color.

### Command palette
- The "Summon" (Insert) action for saved sets works again — it was silently failing in some cases.
- The palette no longer hangs or shows errors when an action fails.

---

## v2.5.0 — Stability & speed

### Performance
- Opening large sets or bookmark folders is now much faster, especially when you already have lots of tabs open.

### Stability
- The extension uses less memory over time — old background listeners don't pile up, and tracking data is cleaned up when tabs close.
- The codebase was trimmed down (dead code removed), so the extension starts faster and runs leaner.

### Command palette reliability
- Fixed several actions that would silently fail or leave error messages in the console.

---

## Earlier (v2.4.x / v2.5.0 timeframe) — New features, off by default

These features were added but are **disabled unless you turn them on** — so the extension asks for extra permissions (history, bookmarks, sessions) only when you actually use them, not up front:

- **Automatic crash recovery** — saves your workspace on crash/quit, restores with one click (off by default).
- **Auto-hibernate grouped tabs** — puts grouped tabs to sleep when idle (off by default; configurable in settings).
- **History search in palette** — search your browser history from the command palette (off by default; requests History permission when enabled).
- **Bookmarks in palette** — search and insert bookmarks (off by default; requests Bookmarks permission when enabled).
- **Recently closed tabs** — jump back to tabs you just closed (off by default; requests Sessions permission when enabled).
- **Panic Close** — one shortcut to close all tabs at once (off by default).
- **Pomodoro timer, media extractor, volume control, eyedropper, screenshot, unit converter, focus view, smart peek** — all optional, toggled individually in settings.

**Why this matters:** The extension installs with only the permissions it needs to work. Extra capabilities (history, bookmarks, session restore) are requested *just in time* — the moment you flip them on in the popup — so your privacy stays in your hands.

---

## Summary

| Area | Since 2.3.3 |
|------|-------------|
| Crash recovery | ✅ Auto-save + one-click restore |
| Pinned tabs | ✅ No stray tabs, URL remembered |
| Closing tabs | ✅ No neighbor wake, no empty leftovers |
| Bookmarks | ✅ Folders → tab groups |
| Performance | ✅ Faster large launches |
| Memory | ✅ Leaner over time |
| Permissions | ✅ Optional, asked only when used |
| Palette | ✅ More reliable, no hangs |
