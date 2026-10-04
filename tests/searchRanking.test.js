import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStrongMatch } from '../services/searchRanking.js';

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
