// Pure helpers for ranking palette search results. No imports and no chrome.*
// calls, so they can be unit-tested with `node --test` outside the extension.

const MIN_STRONG_MATCH_LENGTH = 3;

// A "strong" match is a query that starts a host label or a path segment of
// the URL, e.g. "pulls" for github.com/pulls/. The scheme, a leading "www.",
// the top-level domain, the query string and the fragment never match.
export function isStrongMatch(query, url) {
    if (typeof query !== 'string' || typeof url !== 'string') return false;
    const q = query.trim().toLowerCase();
    if (q.length < MIN_STRONG_MATCH_LENGTH) return false;

    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return false;
    }

    const labels = parsed.hostname.toLowerCase().replace(/^www\./, '').split('.');
    if (labels.length > 1) labels.pop();
    const segments = parsed.pathname.toLowerCase().split('/');
    return [...labels, ...segments].some(part => part.startsWith(q));
}
