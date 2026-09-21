import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../services/groupOrderService.js', import.meta.url), 'utf8');

async function harness(groups, enabled = true) {
    const events = () => {
        const listeners = [];
        return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) };
    };
    const settings = { pinGroupsToTop: enabled };
    let tabs = groups.map((groupId, id) => ({ id, groupId: groupId ?? -1, pinned: groupId === null, windowId: 1 }));
    const timers = new Map();
    const moves = [];
    let timerId = 0;
    let failures = 0;
    let attempts = 0;
    const chrome = {
        tabs: {
            onCreated: events(), onMoved: events(), onAttached: events(), onDetached: events(),
            onUpdated: events(), onRemoved: events(),
            query: async ({ windowId }) => tabs.filter(t => t.windowId === windowId).map((t, index) => ({ ...t, index }))
        },
        windows: { onRemoved: events(), getAll: async () => [{ id: 1 }] },
        tabGroups: {
            onCreated: events(), onMoved: events(),
            move: async (groupId, { windowId, index }) => {
                attempts++;
                if (failures-- > 0) throw new Error('Tabs cannot be edited right now');
                const group = tabs.filter(t => t.groupId === groupId && t.windowId === windowId);
                const remaining = tabs.filter(t => !group.includes(t));
                assert.ok(index >= remaining.filter(t => t.pinned).length);
                remaining.splice(index, 0, ...group);
                tabs = remaining;
                moves.push(groupId);
                chrome.tabGroups.onMoved.emit({ id: groupId, windowId });
                for (const t of group) chrome.tabs.onMoved.emit(t.id, { windowId });
            }
        }
    };
    const context = vm.createContext({
        chrome,
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id)
    });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(specifier => {
        const values = specifier.endsWith('state.js') ? { globalSettings: settings }
            : specifier.endsWith('constants.js') ? { NONE_GROUP: -1 }
                : { ensureLoaded: async () => {} };
        return new vm.SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return {
        chrome, settings, moves,
        refresh: module.namespace.refreshGroupOrder,
        ids: () => tabs.map(t => t.id),
        fail: count => { failures = count; },
        attempts: () => attempts,
        insert: (index, tab) => tabs.splice(index, 0, tab),
        async flush() {
            // Let refresh's getAll promise enqueue its timer.
            await Promise.resolve();
            let passes = 0;
            while (timers.size) {
                assert.ok(++passes < 30, 'ordering must settle without an event loop');
                const [id, fn] = timers.entries().next().value;
                timers.delete(id);
                await fn();
            }
        }
    };
}

test('packs groups after pinned tabs, preserving all relative orders', async () => {
    const h = await harness([null, -1, 10, 10, -1, 20, 20, -1]);
    h.refresh();
    await h.flush();
    assert.deepEqual(h.ids(), [0, 2, 3, 5, 6, 1, 4, 7]);
    assert.deepEqual(h.moves, [10, 20]);
    h.refresh();
    await h.flush();
    assert.equal(h.moves.length, 2, 'already ordered groups must not move');
});

test('new standalone tabs cannot push groups down', async () => {
    const h = await harness([null, 10, 10, 20, -1]);
    const tab = { id: 99, groupId: -1, pinned: false, windowId: 1 };
    h.insert(1, tab);
    h.chrome.tabs.onCreated.emit(tab);
    h.chrome.tabs.onMoved.emit(99, { windowId: 1 });
    await h.flush();
    assert.deepEqual(h.ids(), [0, 1, 2, 3, 99, 4]);
    assert.deepEqual(h.moves, [10, 20]);
});

test('disabled setting and cancellation leave tabs in place', async () => {
    const h = await harness([-1, 10], false);
    h.chrome.tabs.onCreated.emit({ windowId: 1 });
    await h.flush();
    assert.deepEqual(h.moves, []);
    h.settings.pinGroupsToTop = true;
    h.chrome.tabs.onAttached.emit(1, { newWindowId: 1 });
    h.settings.pinGroupsToTop = false;
    h.refresh();
    await h.flush();
    assert.deepEqual(h.moves, []);
});

test('closing a window cancels queued ordering', async () => {
    const h = await harness([-1, 10]);
    h.chrome.tabs.onCreated.emit({ windowId: 1 });
    h.chrome.windows.onRemoved.emit(1);
    await h.flush();
    assert.deepEqual(h.moves, []);
});

test('transient move errors retry, persistent errors stop', async () => {
    const h = await harness([-1, 10]);
    h.fail(1);
    h.refresh();
    await h.flush();
    assert.deepEqual(h.ids(), [1, 0]);
    assert.equal(h.attempts(), 2);
    const failing = await harness([-1, 10]);
    failing.fail(100);
    failing.refresh();
    await failing.flush();
    assert.equal(failing.attempts(), 4);
    assert.deepEqual(failing.moves, []);
});
