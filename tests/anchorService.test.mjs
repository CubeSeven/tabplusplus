import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sourceUrl = new URL('../services/anchorService.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const PULLS = 'https://github.com/pulls?q=is%3Aopen';
const DAY = 24 * 60 * 60 * 1000;

const events = () => {
    const listeners = [];
    return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

async function harness({ tabs = [{ id: 1, url: PULLS, pinned: false, windowId: 1 }], storage = {} } = {}) {
    const live = new Map(tabs.map(t => [t.id, { ...t }]));
    const store = structuredClone(storage);
    const created = [];
    const updated = [];
    const messages = [];
    const badges = [];
    const backs = [];
    const timers = new Map();
    const baselines = new Map();
    let goBackFails = false;
    let baselineSyncs = 0;
    let clock = 100 * DAY;
    let timerId = 0;
    let nextTabId = 1000;
    const chrome = {
        storage: {
            local: {
                get: async keys => Object.fromEntries(keys.filter(k => k in store).map(k => [k, structuredClone(store[k])])),
                set: async values => { Object.assign(store, structuredClone(values)); }
            }
        },
        tabs: {
            onUpdated: events(), onRemoved: events(), onReplaced: events(),
            query: async () => [...live.values()].map(t => ({ ...t })),
            create: async props => { created.push(structuredClone(props)); return { id: nextTabId++ }; },
            update: async (id, props) => { updated.push([id, structuredClone(props)]); },
            goBack: async id => { backs.push(id); if (goBackFails) throw new Error('Cannot go back'); },
            sendMessage: async (id, msg) => { messages.push([id, structuredClone(msg)]); }
        },
        action: {
            setBadgeText: async badge => { badges.push(structuredClone(badge)); },
            setBadgeBackgroundColor: async () => {}
        }
    };
    const context = vm.createContext({
        chrome, URL,
        Date: { now: () => clock },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id)
    });
    const module = new vm.SourceTextModule(source, { context, identifier: sourceUrl.href });
    await module.link(specifier => {
        const values = specifier.endsWith('state.js')
            ? { memoryBaselines: baselines }
            : { ensureLoaded: async () => {}, syncBaselinesToStorage: () => { baselineSyncs++; } };
        return new vm.SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    await settle();
    const api = module.namespace;
    return {
        chrome, store, created, updated, messages, badges, backs, baselines, api,
        tab: id => ({ ...live.get(id) }),
        failGoBack: () => { goBackFails = true; },
        advance: ms => { clock += ms; },
        baselineSyncs: () => baselineSyncs,
        runTimers: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
        toasts: () => messages.filter(([, m]) => m.action === 'show-toast').map(([, m]) => m.message),
        lastState: id => messages.filter(([tid, m]) => tid === id && m.action === 'anchor-state').at(-1)?.[1].anchor,
        async navigate(id, url) {
            const tab = live.get(id);
            tab.url = url;
            chrome.tabs.onUpdated.emit(id, { url }, { ...tab });
            await settle();
        },
        async anchor(id = 1) {
            await api.toggleAnchor({ ...live.get(id) });
            await settle();
        }
    };
}

test('anchoring pins the tab, stores its scope and marks it', async () => {
    const h = await harness();
    await h.anchor();
    assert.deepEqual(h.store.anchors, { 1: { origin: 'https://github.com', path: '/pulls', url: PULLS } });
    assert.deepEqual(h.updated, [[1, { pinned: true }]]);
    assert.deepEqual(h.badges.at(-1), { tabId: 1, text: '⚓' });
    assert.deepEqual(h.lastState(1), { origin: 'https://github.com', path: '/pulls' });
    assert.deepEqual(h.toasts(), ['Anchored to github.com/pulls']);
    assert.deepEqual(structuredClone(await h.api.getAnchorScope(1)), { origin: 'https://github.com', path: '/pulls' });

    await h.anchor();
    assert.deepEqual(h.store.anchors, {});
    assert.deepEqual(h.badges.at(-1), { tabId: 1, text: '' });
    assert.equal(h.lastState(1), null);
    assert.equal(h.toasts().at(-1), 'Anchor released');
    assert.equal(await h.api.getAnchorScope(1), null);
});

test('only web pages can be anchored and pinned tabs stay as they are', async () => {
    const h = await harness({ tabs: [
        { id: 1, url: 'chrome-extension://abc/ntp.html', pinned: false, windowId: 1 },
        { id: 2, url: 'https://example.com/', pinned: true, windowId: 1 }
    ] });
    await h.anchor(1);
    assert.deepEqual(h.toasts(), ['Only web pages can be anchored']);
    assert.equal(h.store.anchors, undefined);
    await h.anchor(2);
    assert.deepEqual(h.store.anchors[2].path, '/');
    assert.deepEqual(h.updated, [], 'a pinned tab is not pinned again');
});

test('query, hash and trailing slash changes stay in the anchored tab', async () => {
    const h = await harness();
    await h.anchor();
    await h.navigate(1, 'https://github.com/pulls?q=author%3A%40me#top');
    await h.navigate(1, 'https://github.com/pulls/');
    await h.navigate(1, 'about:blank');
    assert.deepEqual(h.created, []);
    assert.deepEqual(h.backs, []);
    assert.equal(h.store.anchors[1].url, 'https://github.com/pulls/');
});

test('other pages open in a new foreground tab and the anchored tab goes back', async () => {
    const h = await harness();
    await h.anchor();
    await h.navigate(1, 'https://github.com/o/r/pull/1');
    assert.deepEqual(h.created, [{ url: 'https://github.com/o/r/pull/1', windowId: 1, openerTabId: 1, active: true }]);
    assert.deepEqual(h.backs, [1]);
    await h.navigate(1, PULLS);
    await h.navigate(1, 'https://example.com/typed');
    assert.equal(h.created.length, 2, 'a later navigation is a new bounce, not a return step');
    assert.equal(h.created[1].url, 'https://example.com/typed');
});

test('without history the anchored tab reloads its last in-scope URL', async () => {
    const h = await harness();
    await h.anchor();
    await h.navigate(1, 'https://github.com/pulls?q=mine');
    h.failGoBack();
    await h.navigate(1, 'https://github.com/settings');
    assert.deepEqual(h.updated.at(-1), [1, { url: 'https://github.com/pulls?q=mine' }]);
});

test('a page that keeps redirecting pauses the anchor instead of looping', async () => {
    const h = await harness();
    await h.anchor();
    await h.navigate(1, 'https://github.com/login');
    await h.navigate(1, 'https://github.com/elsewhere');
    assert.deepEqual(h.updated.at(-1), [1, { url: PULLS }], 'back landed outside, so reload the anchor URL');
    await h.navigate(1, 'https://github.com/login');
    assert.equal(h.toasts().at(-1), 'Anchor paused: this page redirects away');
    await h.navigate(1, 'https://github.com/session');
    assert.equal(h.created.length, 1, 'no new tabs while paused');

    await h.navigate(1, PULLS);
    await h.navigate(1, 'https://github.com/o/r');
    assert.equal(h.created.length, 2, 'returning to the anchor resumes it');
});

test('a stale return step counts as a new navigation', async () => {
    const h = await harness();
    await h.anchor();
    await h.navigate(1, 'https://github.com/a');
    h.advance(6000);
    await h.navigate(1, 'https://github.com/b');
    assert.deepEqual(h.created.map(c => c.url), ['https://github.com/a', 'https://github.com/b']);
});

test('Ghost Prevention restore passes the anchor to the new tab', async () => {
    const h = await harness();
    await h.anchor();
    h.chrome.tabs.onRemoved.emit(1, { isWindowClosing: false, windowId: 1 });
    await settle();
    assert.deepEqual(h.store.anchors, {});
    await h.api.inheritAnchor(1, 7);
    assert.equal(h.store.anchors[7].path, '/pulls');
    assert.deepEqual(h.badges.at(-1), { tabId: 7, text: '⚓' });
});

test('a closed anchor expires when no restore follows', async () => {
    const h = await harness();
    await h.anchor();
    h.chrome.tabs.onRemoved.emit(1, { isWindowClosing: false, windowId: 1 });
    await settle();
    h.runTimers();
    await h.api.inheritAnchor(1, 7);
    assert.deepEqual(h.store.anchors, {});
    assert.deepEqual(h.store.anchorOrphans, []);
});

test('a closed window keeps the anchor for the next pinned tab on that page', async () => {
    const h = await harness();
    await h.anchor();
    h.chrome.tabs.onRemoved.emit(1, { isWindowClosing: true, windowId: 1 });
    await settle();
    assert.equal(h.store.anchorOrphans.length, 1);

    const loose = { id: 9, url: PULLS, pinned: false, windowId: 2 };
    h.chrome.tabs.onUpdated.emit(9, { url: PULLS }, loose);
    await settle();
    assert.equal(h.store.anchors[9], undefined, 'unpinned tabs do not claim anchors');

    h.chrome.tabs.onUpdated.emit(9, { pinned: true }, { ...loose, pinned: true });
    await settle();
    assert.equal(h.store.anchors[9].path, '/pulls');
    assert.deepEqual(h.store.anchorOrphans, []);
    assert.deepEqual(h.lastState(9), { origin: 'https://github.com', path: '/pulls' });
});

test('startup re-binds stored anchors to the restored tabs', async () => {
    const anchor = { origin: 'https://github.com', path: '/pulls', url: PULLS };
    const h = await harness({
        tabs: [
            { id: 5, url: 'https://example.com/', pinned: false, windowId: 1 },
            { id: 6, url: PULLS, pinned: true, windowId: 1 }
        ],
        storage: {
            anchors: { 5: anchor, 8: { origin: 1 } },
            anchorOrphans: [
                { origin: 'https://old.test', path: '/', url: 'https://old.test/', orphanedAt: 0 },
                { origin: 'https://gitlab.com', path: '/mrs', url: 'https://gitlab.com/mrs', orphanedAt: 100 * DAY - 1000 }
            ]
        }
    });
    assert.deepEqual(h.store.anchors, { 6: anchor }, 'tab id 5 now shows another page');
    assert.deepEqual(h.store.anchorOrphans.map(o => o.origin), ['https://gitlab.com']);
    assert.deepEqual(h.badges, [{ tabId: 6, text: '⚓' }]);
});

test('an unchanged startup does not rewrite storage', async () => {
    const anchors = { 1: { origin: 'https://github.com', path: '/pulls', url: PULLS } };
    const h = await harness({ tabs: [{ id: 1, url: PULLS, pinned: true, windowId: 1 }], storage: { anchors } });
    h.store.anchors = 'untouched';
    await h.navigate(1, PULLS);
    assert.equal(h.store.anchors, 'untouched');
});

test('a replaced tab keeps its anchor', async () => {
    const h = await harness();
    await h.anchor();
    h.chrome.tabs.onReplaced.emit(8, 1);
    await settle();
    assert.deepEqual(Object.keys(h.store.anchors), ['8']);
    h.chrome.tabs.onReplaced.emit(9, 3);
    await settle();
    assert.deepEqual(Object.keys(h.store.anchors), ['8']);
});

test('links from a page open in a new tab and fix stale page state', async () => {
    const h = await harness({ tabs: [
        { id: 1, url: PULLS, pinned: false, windowId: 1 },
        { id: 2, url: PULLS, pinned: false, windowId: 1 }
    ] });
    await h.anchor(1);
    await h.api.openFromAnchor(h.tab(1), 'https://github.com/o/r/pull/2');
    assert.deepEqual(h.created.at(-1), { url: 'https://github.com/o/r/pull/2', windowId: 1, openerTabId: 1, active: true });
    await h.api.openFromAnchor(h.tab(2), 'https://github.com/o/r/pull/3');
    assert.equal(h.created.length, 2);
    assert.equal(h.lastState(2), null);
    await h.api.openFromAnchor(h.tab(1), 'javascript:alert(1)');
    await h.api.openFromAnchor(null, 'https://github.com/');
    assert.equal(h.created.length, 2);
});

test('anchoring moves a Ghost Prevention baseline into the anchor', async () => {
    const h = await harness({ tabs: [{ id: 1, url: PULLS, pinned: true, windowId: 1 }] });
    h.baselines.set(1, { url: 'https://github.com/', pinned: true });
    await h.anchor();
    assert.equal(h.baselines.get(1).url, PULLS);
    assert.equal(h.baselineSyncs(), 1);

    const kept = await harness({ tabs: [{ id: 1, url: PULLS, pinned: true, windowId: 1 }] });
    kept.baselines.set(1, { url: 'https://github.com/pulls', pinned: true });
    await kept.anchor();
    assert.equal(kept.baselines.get(1).url, 'https://github.com/pulls');
    assert.equal(kept.baselineSyncs(), 0);
});

test('unrelated tab updates are ignored', async () => {
    const h = await harness();
    await h.anchor();
    h.chrome.tabs.onUpdated.emit(1, { status: 'complete' }, h.tab(1));
    h.chrome.tabs.onUpdated.emit(1, { pinned: true }, h.tab(1));
    await settle();
    assert.deepEqual(h.created, []);
    assert.deepEqual(h.backs, []);
});
