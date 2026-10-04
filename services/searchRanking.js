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

// Result types that already outrank the plain web search today. When any of
// them is present, nothing is promoted above it.
const PRIORITY_TYPES = new Set(['action', 'bang', 'navigate']);
// Top Hit candidates, in order of precedence.
const LOCAL_TYPES = ['tab', 'bookmark', 'history'];

// Within the first type that has strong matches, the shortest URL wins, so a
// site's homepage beats its articles; equally short URLs keep their order.
function findTopHit(results, query) {
    if (results.some(r => PRIORITY_TYPES.has(r.type))) return null;
    for (const type of LOCAL_TYPES) {
        const hits = results.filter(r => r.type === type && isStrongMatch(query, r.url));
        if (hits.length > 0) return hits.reduce((best, r) => (r.url.length < best.url.length ? r : best));
    }
    return null;
}

// Local-First Search: tags the strong local match (if any) with
// _section 'tophit' and engine suggestions with _section 'suggestion', so the
// palette renderers can show them first and last respectively. Returns a new
// array; the input results are not modified.
export function applyLocalFirst(results, query) {
    const topHit = findTopHit(results, query);
    return results.map(r => {
        if (r === topHit) return { ...r, _section: 'tophit' };
        if (r._suggestion) return { ...r, _section: 'suggestion' };
        return r;
    });
}
