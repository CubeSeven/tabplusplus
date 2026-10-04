import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStrongMatch, applyLocalFirst } from '../services/searchRanking.js';

test('matches the start of a path segment', () => {
    assert.equal(isStrongMatch('pulls', 'https://github.com/pulls/'), true);
    assert.equal(isStrongMatch('pulls', 'https://github.com/pulls/inbox'), true);
    assert.equal(isStrongMatch('inb', 'https://github.com/pulls/inbox'), true);
});

test('matches the start of a host label', () => {
    assert.equal(isStrongMatch('git', 'https://github.com/'), true);
    assert.equal(isStrongMatch('mail', 'https://mail.google.com/mail/u/0/'), true);
    assert.equal(isStrongMatch('goog', 'https://mail.google.com/'), true);
});

test('does not match in the middle of a host label or path segment', () => {
    assert.equal(isStrongMatch('hub', 'https://github.com/'), false);
    assert.equal(isStrongMatch('ulls', 'https://github.com/pulls/'), false);
});

test('ignores the scheme and a leading www.', () => {
    assert.equal(isStrongMatch('https', 'https://github.com/'), false);
    assert.equal(isStrongMatch('www', 'https://www.google.com/'), false);
    assert.equal(isStrongMatch('goo', 'https://www.google.com/'), true);
});

test('ignores the top-level domain so "com" does not match every site', () => {
    assert.equal(isStrongMatch('com', 'https://github.com/'), false);
    assert.equal(isStrongMatch('dev', 'https://web.dev/'), false);
    assert.equal(isStrongMatch('localhost', 'http://localhost:3000/'), true);
});

test('ignores the query string and fragment', () => {
    assert.equal(isStrongMatch('pulls', 'https://www.google.com/search?q=pulls'), false);
    assert.equal(isStrongMatch('pulls', 'https://example.com/#pulls'), false);
});

test('is case-insensitive and trims the query', () => {
    assert.equal(isStrongMatch('PULLS', 'https://github.com/pulls/'), true);
    assert.equal(isStrongMatch('pulls', 'https://github.com/Pulls/'), true);
    assert.equal(isStrongMatch('  pulls ', 'https://github.com/pulls/'), true);
});

test('requires at least 3 characters', () => {
    assert.equal(isStrongMatch('pu', 'https://github.com/pulls/'), false);
    assert.equal(isStrongMatch('', 'https://github.com/'), false);
});

test('returns false for invalid input instead of throwing', () => {
    assert.equal(isStrongMatch('pulls', 'not a url'), false);
    assert.equal(isStrongMatch('pulls', undefined), false);
    assert.equal(isStrongMatch(['pulls'], 'https://github.com/pulls/'), false);
});

const searchRow = { type: 'search', title: 'Search Google for "pulls"', url: 'https://www.google.com/search?q=pulls' };
const suggestion = (title) => ({ type: 'search', title, url: `https://www.google.com/search?q=${encodeURIComponent(title)}`, _suggestion: true });
const tab = (url) => ({ type: 'tab', id: 1, title: 'Tab', url });
const bookmark = (url) => ({ type: 'bookmark', title: 'Bookmark', url });
const history = (url) => ({ type: 'history', title: 'History', url });
const sectionsOf = (results) => results.map(r => r._section);

test('promotes a strong-matching local result to Top Hit', () => {
    const results = [searchRow, suggestion('pulls up'), history('https://github.com/pulls/')];
    assert.deepEqual(sectionsOf(applyLocalFirst(results, 'pulls')), [undefined, 'suggestion', 'tophit']);
});

test('prefers an open tab, then a bookmark, then history, whatever the list order', () => {
    const pullsHistory = history('https://github.com/pulls/');
    const pullsBookmark = bookmark('https://github.com/pulls/review-requested');
    const pullsTab = tab('https://github.com/pulls/inbox');
    assert.deepEqual(sectionsOf(applyLocalFirst([pullsHistory, pullsBookmark, pullsTab], 'pulls')), [undefined, undefined, 'tophit']);
    assert.deepEqual(sectionsOf(applyLocalFirst([pullsHistory, pullsBookmark], 'pulls')), [undefined, 'tophit']);
});

test('prefers the shortest matching URL within the winning type, e.g. a homepage over its articles', () => {
    const article = history('https://www.corriere.it/salute/26_ottobre_04/trump-aspirina.shtml');
    const homepage = history('https://www.corriere.it/');
    assert.deepEqual(sectionsOf(applyLocalFirst([article, homepage], 'corr')), [undefined, 'tophit']);
});

test('keeps the existing order between equally short URLs', () => {
    const results = [history('https://github.com/pulls/aaaa'), history('https://github.com/pulls/bbbb')];
    assert.deepEqual(sectionsOf(applyLocalFirst(results, 'pulls')), ['tophit', undefined]);
});

test('promotes nothing without a strong match or with a query under 3 characters', () => {
    const results = [searchRow, tab('https://github.com/notifications'), history('https://www.google.com/search?q=pulls')];
    assert.deepEqual(sectionsOf(applyLocalFirst(results, 'pulls')), [undefined, undefined, undefined]);
    assert.deepEqual(sectionsOf(applyLocalFirst([history('https://github.com/pulls/')], 'pu')), [undefined]);
});

test('moves engine suggestions to the Suggestions section, but not the explicit search row', () => {
    const results = [searchRow, suggestion('pulls up'), suggestion('pullshop')];
    assert.deepEqual(sectionsOf(applyLocalFirst(results, 'pulls')), [undefined, 'suggestion', 'suggestion']);
});

test('does not promote over a bang, a URL to open, or an action', () => {
    const firstRows = [
        { type: 'bang', bang: '!gh', title: 'GitHub', url: 'https://github.com/search?q=' },
        { type: 'navigate', title: 'Go to github.com', url: 'https://github.com' },
        { type: 'action', id: 'summon_set_palette|pulls', title: 'Summon Set: "pulls"' }
    ];
    for (const first of firstRows) {
        const results = [first, suggestion('pulls up'), tab('https://github.com/pulls/inbox')];
        assert.deepEqual(sectionsOf(applyLocalFirst(results, 'pulls')), [undefined, 'suggestion', undefined], first.type);
    }
});

test('does not mutate the input results', () => {
    const results = [suggestion('pulls up'), tab('https://github.com/pulls/inbox')];
    applyLocalFirst(results, 'pulls');
    assert.deepEqual(sectionsOf(results), [undefined, undefined]);
});
