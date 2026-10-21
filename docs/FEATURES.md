# Tabs++ — Feature Guide (v2.7.0)

A plain-language guide to everything Tabs++ does, including all features new or changed in v2.7.0. If you are new, start here; if you are upgrading, jump to [What's new](#whats-new-in-v270).

---

## What's new in v2.7.0

### 1. Search engine cycling — press Tab
Type your search in the palette (Ctrl+Shift+K), then press **Tab** to switch engines without retyping:

```
Google → ChatGPT → Perplexity → DuckDuckGo → Bing → Brave → (back to Google)
```

- **Shift+Tab** cycles backwards.
- A small **icon chip** appears at the right of the input showing the active engine. Hover it for the engine name; **click it** to snap back to your default engine.
- **Enter** runs the search on the active engine. Your typed query never changes.
- Works in both the page palette and the new-tab page palette.
- `!` bangs (like `!yt`, `!gh`) still override everything, as before.
- **ChatGPT is now a first-class engine** (`https://chatgpt.com/?q=`) — no need for `!gpt` anymore.

### 2. Engine tab reuse
If a tab on the target engine is already open (say, ChatGPT), a palette search **navigates that existing tab** to the new query instead of opening another one. No more stacking five ChatGPT tabs. If no tab on that engine is open, a new one is created as usual.

### 3. Split View — type `|`
Type two URLs separated by a pipe in the palette:

```
google.com | facebook.com
```

Enter opens both in **Chrome's native split view** (Chrome 155+), side by side with a draggable divider, and focuses the left pane. Non-URL text becomes a search for that engine. On older Chrome it falls back to two windows.

### 4. Auto-Restore Bookmarks (opt-in)
A safety net for people who keep their whole workspace in bookmarks.

- Turn it on in the popup (needs the Bookmarks tool enabled).
- After a crash or a lost session, Tabs++ reopens **all your bookmarks** in one grouped window about **10 seconds** after startup — deduplicated against tabs that are already open, capped at 100 tabs. Bookmarks whose names start with `!` open pinned.
- **When nothing is lost, nothing happens.** If Chrome restored your session fine, the check sees your tabs already open and stays silent (it only acts when more than 30% of bookmarks are missing).
- If a window with most of your bookmark tabs survived, the missing ones are **folded into it** — no duplicate second window.
- New bookmarks you add while browsing are opened into the bookmarks window within ~2 seconds (only if that window is open; a single new bookmark never spawns a window on its own).
- Manual options in the palette: `Insert All Bookmarks in New Window` and `Insert All Bookmarks in This Window`.

### 5. Local-First Search (opt-in, from PR #19)
When enabled in the popup, palette results put **your stuff first**: open tabs, then bookmarks, then history — all ranked above generic web suggestions. A strong match becomes a pre-selected **Top Hit** (first row, Enter opens it instantly). Off by default; normal behavior is unchanged when off.

### 6. Restore tab in the popup
The popup has a **Restore** tab with two lists:

- **Archived tabs** — everything Tabs++ safely archived for you. Click any row (or Tab to it and press Enter) to reopen it. **Restore all** reopens the lot.
- **Protected snapshot** — your pinned/grouped tabs as of the last snapshot, with favicons. Click a row to open that URL.

Rows with invalid URLs are skipped automatically; broken favicons just disappear.

### 7. Neutral group colors that remember your choice
- New groups created by Tabs++ now start **grey/neutral** instead of random colors.
- Recolor any group yourself (right-click the group → pick a color). **Your choice is remembered per group name** and survives restores, window closes, and browser restarts. Recoloring back to grey also sticks.
- Saved Tab Sets keep whatever colors they were saved with.

### 8. Undo everywhere (safe toasts)
Destructive actions (Close Other Tabs, Close Unprotected Tabs, batch archive, bookmark restores) show a toast on the page with an **Undo** button. Undo restores the exact tabs that action closed — into the right window — and stale Undo buttons from older toasts can never restore the wrong batch.

### 9. Pomodoro controls inline
The pomo pill in the corner now has inline **Stop** and **+5 min** buttons when you hover it — no confirmation dialogs. "+5 min" can no longer schedule itself into the past.

### 10. Focus guard for stubborn sites
On sites that constantly steal focus into their own inputs (chatgpt.com is the worst offender), the palette now **keeps its typing focus no matter what** — a trap plus a watchdog enforce it while the palette is open, and they stop the moment it closes.

### 11. Popup rework
- Brand and version moved to a **footer** (`Tabs++ | v2.7.0`, links to GitHub).
- Searching **replaces the tab menu** inline — more room for results.
- Feature cards are grouped under clear headers (Guard / Search / Tools / Media / Performance).
- New **Info** tab: version, GitHub and docs links.
- Settings descriptions are short and to the point.

### Changed under the hood (worth knowing)
- **Pinned-tab close fix (issue #10):** closing the active pinned/grouped tab with Ctrl+W no longer wakes the hibernated tab next to it — the restored tab takes focus back and the neighbor goes back to sleep. Pinning also remembers the URL from pin time, not your last visited URL.
- **~60% smaller package:** the bundled Inter font is gone; the popup uses your system font.
- **Bookmarks tool:** live watchers now activate immediately when the permission is granted (no extension reload needed), and restore runs through a crash-safe alarm.
- **Security:** video-timestamp domain checks (YouTube/Twitch/Vimeo) are exact host matches now (CodeQL #1–#3 resolved).
- **First test suite:** the local-first ranking rules ship with 20 unit tests (`node --test tests/searchRanking.test.js`).

---

## The classics (quick reference)

| Area | Highlights |
| :--- | :--- |
| Protection | Pinned and grouped tabs can't stay closed — they reappear at their baseline URL, hibernated to zero RAM |
| Palette | Ctrl+Shift+K; `>` for actions, `!` for bangs, `a \| b` for split |
| Hibernate | Ctrl+Shift+H puts all background tabs to sleep |
| Tab Sets | Save/summon whole workspaces from the palette |
| Session Vault | Closed tabs are archived automatically for later restore |
| Focus View | Reader mode on any article page |
| New Tab Page | Full palette experience built in |

See [docs/PROJECT.md](PROJECT.md) for architecture, [docs/UPDATE_NOTES.md](UPDATE_NOTES.md) for the full changelog.
