# Contributing to Tabs++

Thanks for considering contributing! This project follows a strict, quality-first workflow. Please read all of it before opening a PR.

## Code of Conduct

Be respectful and constructive. That's the whole policy.

## How to Contribute

### Reporting Bugs

1. Check the existing issues (open and closed) to avoid duplicates.
2. Open an issue using the **Bug report** template.
3. Include: extension version, Chrome version, steps to reproduce, expected vs. actual behavior.

### Feature Requests

Open an issue using the **Feature request** template. Describe the problem you're solving, not just the feature you want.

### Pull Requests

**Never commit directly to `main`.** The branch is protected — this is enforced by GitHub. Always:

1. **Branch** — create a feature/fix branch from `main`:
   ```bash
   git checkout main && git pull
   git checkout -b fix/my-bug-description
   ```
   Branch naming: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`.

2. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   fix(tab-guard): stop grouped tabs from being batch-vaulted
   feat(bookmarks): support '!' titles as pinned tabs
   ```

3. **Push & open a PR** — target `main`. Fill in the PR template.

4. **CI must pass** — the following checks run on every PR:
   - `lint` — manifest validation, JS syntax check on every file, no `console.log`, no whitespace errors
   - `codeql` — GitHub-native security scanning
   - CodeRabbit AI review (when available)

5. **Wait for review** — address all review comments. Push new commits; the PR updates automatically.

6. **Merge** — after CI is green and reviews are approved, squash-merge with a clean message. The branch is deleted automatically.

## Coding Standards

This repo has a strict standards document: **[AGENTS.md](AGENTS.md)**. It contains 14 numbered rules derived from a codebase audit. New code MUST follow them. The high-level ones:

1. **No dead code** — every import used, every export consumed
2. **One shared listener** — never register `chrome.tabs.onUpdated` inside a per-call function
3. **Clean up tracking structures** — every Map/Set keyed by tabId/windowId gets cleaned in `onRemoved`
4. **Set for lookups** — dedup checks are O(1), never `Array.some()`
5. **Pre-built lookup Maps** — static data searched repeatedly gets a Map built once
6. **Batch `chrome.storage.local.set`** — one call with multiple keys, never sequential
7. **Validate message inputs** — `typeof` checks before `.trim()`/arithmetic
8. **Track timeouts** — store IDs, clear on teardown
9. **Event delegation** — one listener per container, not per element
10. **Cache DOM queries** — no `querySelectorAll` on every keystroke
11. **Error-handle all `chrome.*` promises** — every promise gets `.catch()`
12. **Injection guard** — `window.__tabsppInjected` at the top of content scripts
13. **Keep `state.js` minimal** — state + setters only, no business logic
14. **Respect file size boundaries** — split functions >150 lines / files >1000 lines

Read the full file — it's short and contains examples of each rule.

## Development Setup

No build step, no dependencies. The extension is loaded unpacked:

1. Clone the repo
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo folder

To package a release: `./build-zip.sh` (produces `tabs-plus-plus-X.Y.Z.zip`).

## Release Process

Maintainers bump the version in `manifest.json`, update `release-notes-X.Y.Z.md`, and tag the release. This is done via PR like everything else.
