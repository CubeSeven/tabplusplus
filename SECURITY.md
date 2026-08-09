# Security Policy

## Supported Versions

Only the latest release on `main` receives security fixes.

| Version | Supported          |
|---------|--------------------|
| latest  | ✅                 |
| older   | ❌                 |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report security issues privately by opening a GitHub Security Advisory:

1. Go to **https://github.com/CubeSeven/tabplusplus/security/advisories/new**
2. Describe the vulnerability with as much detail as possible (affected version, reproduction steps, impact).
3. You'll receive an acknowledgment within 48 hours, and we'll coordinate a fix and disclosure timeline.

Alternatively, email the maintainers (address visible on the repository's GitHub profile).

## What to include

- Extension version affected
- Steps to reproduce
- Expected vs. actual behavior
- Any crash logs or console output

## Scope

This extension requests broad permissions (`tabs`, `<all_urls>`, `history`, `bookmarks`).
We take the principle of least privilege seriously — if you find a way these
permissions are used beyond what the manifest's stated purpose requires, that
qualifies as a security report.
