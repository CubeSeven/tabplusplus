import { globalSettings, tabSets, memoryBaselines, groupCache, sessionVault } from '../state.js';
import { BANGS, NONE_GROUP, NTP_URL } from '../constants.js';
import { getCanonicalUrl, safeDiscard } from '../utils.js';
import { syncBaselinesToStorage, syncSetsToStorage, syncVaultToStorage, ensureLoaded, restoreVault, saveSnapshot } from './tabService.js';

export const EXTENSION_ACTIONS = [
    { type: 'action', id: 'magic_organize', category: 'Organization', title: 'Magic Organize Workspace', aliases: ['group', 'sort', 'tidy'] },
    { type: 'action', id: 'ungroup_all', category: 'Organization', title: 'Ungroup All Tabs', aliases: ['flatten', 'remove groups'] },
    { type: 'action', id: 'dedupe_window', category: 'Organization', title: 'Close Duplicate Tabs', aliases: ['dedupe', 'duplicates', 'clean'] },
    { type: 'action', id: 'gather_standalone', category: 'Organization', title: 'Gather Standalone Tabs', aliases: ['extract', 'pull'] },
    { type: 'action', id: 'consolidate_domain', category: 'Organization', title: 'Consolidate Domain', aliases: ['merge', 'same site'] },
    { type: 'action', id: 'extract_group', category: 'Organization', title: 'Extract Group to Window', aliases: ['move group', 'pop out'] },
    { type: 'action', id: 'save_workspace', category: 'Sets', title: 'Save Workspace as Set', aliases: ['snapshot', 'store window', 'save'] },
    { type: 'action', id: 'save_group', category: 'Sets', title: 'Save Group as Set', aliases: ['store group', 'save'] },
    { type: 'action', id: 'stash_group', category: 'Sets', title: 'Stash Current Group', aliases: ['hide', 'store and close'] },
    { type: 'action', id: 'export_sets', category: 'Sets', title: 'Export Sets JSON', aliases: ['backup sets', 'download'] },
    { type: 'action', id: 'hibernate_all', category: 'Performance', title: 'Hibernate Background Tabs', aliases: ['sleep', 'ram', 'memory', 'freeze'] },
    { type: 'action', id: 'hibernate_window', category: 'Performance', title: 'Hibernate Window', aliases: ['sleep', 'ram', 'memory'] },
    { type: 'action', id: 'pause_media', category: 'Performance', title: 'Pause All Media', aliases: ['stop audio', 'video', 'music'] },
    { type: 'action', id: 'mute_background', category: 'Performance', title: 'Mute Background Tabs', aliases: ['silence', 'quiet', 'audio'] },
    { type: 'action', id: 'hibernate_pinned', category: 'Performance', title: 'Hibernate All Pinned Tabs', aliases: ['sleep pins', 'ram', 'memory'] },
    { type: 'action', id: 'hibernate_current', category: 'Performance', title: 'Hibernate Current Tab', aliases: ['sleep this', 'ram', 'memory'] },
    { type: 'action', id: 'zen_fullscreen', category: 'Focus', title: 'Enter Zen Fullscreen', aliases: ['focus', 'maximize', 'hide ui'] },
    { type: 'action', id: 'snapshot_session', category: 'Safety', title: 'Snapshot Session Now', aliases: ['backup', 'save state'] },
    { type: 'action', id: 'clear_cache_hour', category: 'Safety', title: 'Panic Close (Clear Last Hour)', aliases: ['history', 'delete', 'wipe'] },
    { type: 'action', id: 'clear_unprotected', category: 'Organization', title: 'Clear Unprotected Tabs', aliases: ['clear today', 'close loose', 'sweep'] },
    { type: 'action', id: 'toggle_pin', category: 'Organization', title: 'Toggle Pin', aliases: ['pin', 'unpin'] },
    { type: 'action', id: 'duplicate_tab', category: 'Organization', title: 'Duplicate Tab', aliases: ['clone', 'copy tab'] },
    { type: 'action', id: 'update_baseline', category: 'Control', title: 'Update Pinned URL', aliases: ['reset url', 'change baseline', 'smart update'] },
    { type: 'action', id: 'set_baseline_url', category: 'Control', title: 'Set Custom Baseline URL', aliases: ['set url', 'change url', 'paste url'] },
    { type: 'action', id: 'copy_md_link', category: 'Productivity', title: 'Copy Markdown Link', aliases: ['markdown', 'url', 'copy link'] },
    { type: 'action', id: 'split_view', category: 'Window', title: 'Split View (Side-by-Side)', aliases: ['split', 'half', 'tile', 'side by side'] },
    { type: 'action', id: 'hard_reload', category: 'Control', title: 'Hard Reload', aliases: ['refresh', 'f5', 'cache', 'bypass'] },
    { type: 'action', id: 'close_other_tabs', category: 'Organization', title: 'Close Other Tabs', aliases: ['close rest', 'keep only this', 'isolate'] },
    { type: 'action', id: 'toggle_mute', category: 'Control', title: 'Toggle Mute', aliases: ['mute', 'unmute', 'silence', 'tab audio'] },
    { type: 'action', id: 'toggle_group', category: 'Control', title: 'Toggle Group', aliases: ['group', 'ungroup', 'cluster'] },
    { type: 'action', id: 'open_downloads', category: 'System', title: 'Open Downloads', aliases: ['downloads', 'files', 'system'] },
    { type: 'action', id: 'open_extensions', category: 'System', title: 'Open Extensions', aliases: ['extensions', 'addons', 'plugins', 'system'] },
    { type: 'action', id: 'open_settings', category: 'System', title: 'Open Settings', aliases: ['settings', 'preferences', 'config', 'system'] },
    { type: 'action', id: 'set_gpu', category: 'System', title: 'Hardware Acceleration (GPU)', aliases: ['gpu', 'hardware acceleration', 'video', 'lag', 'graphics'] },
    { type: 'action', id: 'set_performance', category: 'System', title: 'Performance (Memory Saver)', aliases: ['ram', 'memory saver', 'battery', 'energy', 'performance'] },
    { type: 'action', id: 'set_privacy', category: 'Privacy', title: 'Privacy & Security Hub', aliases: ['safety', 'privacy', 'security', 'protection'] },
    { type: 'action', id: 'set_clear_data', category: 'Privacy', title: 'Clear Browsing Data', aliases: ['cache', 'history', 'delete', 'wipe', 'cleanup'] },
    { type: 'action', id: 'set_cookies', category: 'Privacy', title: 'Cookies & Site Data', aliases: ['cookies', 'tracking', 'third party', 'site data'] },
    { type: 'action', id: 'set_ad_privacy', category: 'Privacy', title: 'Ad Privacy Settings', aliases: ['ads', 'targeting', 'topics'] },
    { type: 'action', id: 'set_permissions', category: 'Privacy', title: 'Site Permissions (Cam/Mic)', aliases: ['notifications', 'camera', 'microphone', 'location', 'sensors'] },
    { type: 'action', id: 'set_passwords', category: 'Data', title: 'Password Manager', aliases: ['passwords', 'login', 'credentials', 'vault'] },
    { type: 'action', id: 'set_autofill', category: 'Data', title: 'Autofill & Addresses', aliases: ['autofill', 'address', 'phone', 'forms'] },
    { type: 'action', id: 'set_payments', category: 'Data', title: 'Payment Methods', aliases: ['cc', 'credit card', 'wallet', 'checkout'] },
    { type: 'action', id: 'set_appearance', category: 'Appearance', title: 'Appearance & Themes', aliases: ['theme', 'dark mode', 'colors', 'look'] },
    { type: 'action', id: 'set_fonts', category: 'Appearance', title: 'Fonts & Page Zoom', aliases: ['text', 'size', 'typography', 'accessibility'] },
    { type: 'action', id: 'set_search', category: 'System', title: 'Search Engine Settings', aliases: ['google', 'ddg', 'default search', 'engine'] },
    { type: 'action', id: 'set_downloads', category: 'System', title: 'Download Settings', aliases: ['downloads', 'save path', 'files'] },
    { type: 'action', id: 'set_languages', category: 'System', title: 'Languages & Spellcheck', aliases: ['language', 'translate', 'spell check', 'dictionary'] },
    { type: 'action', id: 'set_accessibility', category: 'System', title: 'Accessibility Features', aliases: ['vision', 'captions', 'shortcuts', 'a11y'] },
    { type: 'action', id: 'set_flags', category: 'System', title: 'Experimental Flags', aliases: ['flags', 'lab', 'beta', 'experiments'] },
    { type: 'action', id: 'set_reset', category: 'System', title: 'Reset Browser Settings', aliases: ['factory reset', 'restore', 'clean install'] },
    { type: 'action', id: 'set_help', category: 'System', title: 'About / Check for Updates', aliases: ['version', 'update', 'chrome version', 'help'] },
    { type: 'action', id: 'set_sync', category: 'System', title: 'Sync & Google Services', aliases: ['account', 'backup', 'cloud', 'sync'] },
    { type: 'action', id: 'set_startup', category: 'System', title: 'On Startup Settings', aliases: ['home page', 'startup', 'new window'] },
    { type: 'action', id: 'set_extensions', category: 'System', title: 'Manage Extensions', aliases: ['addons', 'plugins', 'manage'] }
];

export function resolveBang(query) {
    const match = query.match(/^(!\S+)\s*(.*)/);
    if (!match) return null;
    const [, bang, rest] = match;
    const entry = BANGS[bang.toLowerCase()];
    if (!entry) return null;
    return {
        type: 'bang', bang: bang.toLowerCase(), label: entry.label,
        title: rest ? `${entry.label} → "${rest}"` : `Open ${entry.label}`,
        url: entry.url + encodeURIComponent(rest)
    };
}

export async function handleSearchItems(request, sender, sendResponse) {
    await ensureLoaded();
    if (!globalSettings.enablePalette) { sendResponse({ results: [] }); return; }

    const query = (request.query || "").trim();
    const lowerQuery = query.toLowerCase();
    
    if (query.startsWith('>')) {
        const actionQuery = query.substring(1).trim().toLowerCase();
        const dynamicRegex = /^(summon|launch|delete set)\s*(.*)/;
        const dynamicMatch = actionQuery.match(dynamicRegex);
        
        if (dynamicMatch) {
            const op = dynamicMatch[1];
            let term = dynamicMatch[2];
            let results = [];
            if (op === 'summon' && chrome.tabGroups) {
                try {
                    const groups = await chrome.tabGroups.query({});
                    groups.forEach(g => { if (!term || (g.title && g.title.toLowerCase().includes(term))) results.push({ type: 'action', id: `summon_group_palette|${g.id}`, category: 'Groups', title: `Summon Group: "${g.title || 'Untitled'}"` }); });
                } catch (e) {}
            }
            Object.keys(tabSets).forEach(setName => {
                if (!term || setName.toLowerCase().includes(term)) {
                    let id = `${op === 'summon' ? 'summon_set_palette' : op === 'launch' ? 'launch_set_palette' : 'delete_set_palette'}|${setName}`;
                    results.push({ type: 'action', id, category: 'Sets', title: `${op.charAt(0).toUpperCase() + op.slice(1)} Set: "${setName}"` });
                }
            });
            sendResponse({ results: results.slice(0, 15) });
            return;
        }

        let filtered = EXTENSION_ACTIONS.filter(a => a.title.toLowerCase().includes(actionQuery) || a.category.toLowerCase().includes(actionQuery) || (a.aliases && a.aliases.some(alias => alias.toLowerCase().includes(actionQuery))));
        sendResponse({ results: filtered.slice(0, 15) });
        return;
    }
    
    const pTabs = chrome.tabs.query({});
    const pHistory = (query && chrome.history) ? chrome.history.search({ text: query, maxResults: 10 }) : Promise.resolve([]);
    const pBookmarks = (query && chrome.bookmarks) ? chrome.bookmarks.search({ query: query }) : Promise.resolve([]);
    const pClosed = (!query && chrome.sessions) ? chrome.sessions.getRecentlyClosed({ maxResults: 7 }) : Promise.resolve([]);
    const pSuggestions = query ? fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`).then(r => r.json()).then(data => data[1] || []).catch(() => []) : Promise.resolve([]);

    Promise.all([pTabs, pHistory, pBookmarks, pSuggestions, pClosed]).then(async ([tabs, history, bookmarks, suggestions, closedSessions]) => {
        let results = [];
        if (query) {
            const bang = resolveBang(query);
            if (bang) results.push(bang);
            else if (/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(lowerQuery)) results.push({ type: 'navigate', title: `Go to ${query}`, url: lowerQuery.startsWith('http') ? lowerQuery : 'https://' + lowerQuery });
            else results.push({ type: 'search', title: `Search Google for "${query}"`, url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
        }
        suggestions.slice(0, 5).forEach(s => results.push({ type: 'search', title: s, url: `https://www.google.com/search?q=${encodeURIComponent(s)}` }));
        
        const formattedTabs = tabs.filter(t => !query || (t.title && t.title.toLowerCase().includes(lowerQuery)) || (t.url && t.url.toLowerCase().includes(lowerQuery))).slice(0, query ? 5 : 15).map(t => ({
            type: 'tab', id: t.id, title: t.title || t.url, url: t.url, windowId: t.windowId, favIconUrl: t.favIconUrl || null, groupId: t.groupId ?? NONE_GROUP
        }));
        
        results.push(...formattedTabs);
        results.push(...bookmarks.filter(b => b.url).slice(0, 5).map(b => ({ type: 'bookmark', title: b.title || b.url, url: b.url })));
        results.push(...history.filter(h => h.url && !tabs.some(t => t.url === h.url)).slice(0, 10).map(h => ({ type: 'history', title: h.title || h.url, url: h.url })));
        if (!query && closedSessions) results.push(...closedSessions.filter(s => s.tab && s.tab.url && !s.tab.url.startsWith('chrome')).slice(0, 5).map(s => ({ type: 'closed', title: s.tab.title || s.tab.url, url: s.tab.url, favIconUrl: s.tab.favIconUrl || null })));
        if (sessionVault.length > 0 && (!query || "restore".includes(lowerQuery))) results.unshift({ type: 'vault', title: `Restore ${sessionVault.length} protected tabs`, url: 'virtual:restore-vault' });

        const seen = new Set();
        sendResponse({ results: results.filter(r => !r.url || (seen.has(r.url) ? false : seen.add(r.url))) });
    }).catch(() => sendResponse({ results: [] }));
}

export async function executeAction(commandId, args) {
    await ensureLoaded();
    try {
        // Pipe-delimited dynamic palette commands
        if (commandId.includes('|')) {
            const [base, extra] = commandId.split('|');
            if (base === 'summon_group_palette') {
                const gid = parseInt(extra);
                if (!isNaN(gid)) {
                    const gTabs = await chrome.tabs.query({ groupId: gid });
                    if (gTabs.length > 0) await chrome.tabs.move(gTabs.map(t => t.id), { windowId: chrome.windows.WINDOW_ID_CURRENT, index: -1 });
                }
                return;
            }
            if (base === 'summon_set_palette') { chrome.runtime.sendMessage({ action: 'summon-set', name: extra }); return; }
            if (base === 'launch_set_palette') { chrome.runtime.sendMessage({ action: 'launch-set', name: extra }); return; }
            if (base === 'delete_set_palette') { chrome.runtime.sendMessage({ action: 'delete-set', name: extra }); return; }
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        switch (commandId) {
            case 'magic_organize': {
                const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT, pinned: false });
                const domainMap = {};
                tabs.forEach(t => { try { const d = new URL(t.url).hostname.replace('www.', ''); if (!domainMap[d]) domainMap[d] = []; domainMap[d].push(t); } catch (e) {} });
                for (const d in domainMap) if (domainMap[d].length > 1) { const gid = await chrome.tabs.group({ tabIds: domainMap[d].map(t => t.id) }); await chrome.tabGroups.update(gid, { title: d }); }
                break;
            }
            case 'ungroup_all': {
                const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                tabs.forEach(t => { if (t.groupId !== NONE_GROUP) chrome.tabs.ungroup(t.id).catch(() => {}); });
                break;
            }
            case 'dedupe_window': {
                const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                const seen = new Set(); const toClose = [];
                tabs.forEach(t => { if (!t.url) return; const c = t.url.split('#')[0]; if (seen.has(c)) { if (!t.active) toClose.push(t.id); } else seen.add(c); });
                if (toClose.length > 0) chrome.tabs.remove(toClose);
                break;
            }
            case 'gather_standalone': {
                if (!tab) break;
                const tabs = await chrome.tabs.query({ currentWindow: true });
                const standaloneIds = tabs.filter(t => !t.pinned && t.groupId === NONE_GROUP && t.id !== tab.id).map(t => t.id);
                if (standaloneIds.length > 1) { const gid = await chrome.tabs.group({ tabIds: standaloneIds }); await chrome.tabGroups.update(gid, { title: 'Standalone' }); }
                break;
            }
            case 'consolidate_domain': {
                if (!tab?.url) break;
                const host = new URL(tab.url).hostname;
                const tabs = await chrome.tabs.query({ currentWindow: true });
                const sameHost = tabs.filter(t => { try { return new URL(t.url).hostname === host && t.groupId === NONE_GROUP; } catch { return false; } }).map(t => t.id);
                if (sameHost.length > 1) { const gid = await chrome.tabs.group({ tabIds: sameHost }); await chrome.tabGroups.update(gid, { title: host.replace('www.', '') }); }
                break;
            }
            case 'extract_group': {
                if (!tab || tab.groupId === NONE_GROUP) break;
                const gTabs = await chrome.tabs.query({ groupId: tab.groupId });
                if (gTabs.length > 0) {
                    const g = await chrome.tabGroups.get(tab.groupId);
                    const newWin = await chrome.windows.create({ focused: true });
                    await chrome.tabs.move(gTabs.map(t => t.id), { windowId: newWin.id, index: -1 });
                    const groups = await chrome.tabGroups.query({ windowId: newWin.id });
                    if (groups.length > 0) await chrome.tabGroups.update(groups[0].id, { title: g.title, color: g.color });
                    const allWinTabs = await chrome.tabs.query({ windowId: newWin.id });
                    if (allWinTabs.length > gTabs.length) chrome.tabs.remove(allWinTabs[0].id).catch(() => {});
                }
                break;
            }
            case 'save_workspace':
                chrome.runtime.sendMessage({ action: 'save-set', setType: 'workspace', name: args || 'Workspace' });
                break;
            case 'save_group':
                if (tab && tab.groupId !== NONE_GROUP) chrome.runtime.sendMessage({ action: 'save-set', setType: 'group', name: args || 'Group', groupId: tab.groupId });
                break;
            case 'stash_group': {
                if (!tab || tab.groupId === NONE_GROUP) break;
                chrome.runtime.sendMessage({ action: 'save-set', setType: 'group', name: args || 'Stashed Group', groupId: tab.groupId });
                const gTabs = await chrome.tabs.query({ groupId: tab.groupId });
                chrome.tabs.remove(gTabs.map(t => t.id));
                break;
            }
            case 'export_sets':
                chrome.runtime.sendMessage({ action: 'get-sets' }, (res) => {
                    if (!res?.sets) return;
                    const url = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.sets, null, 2));
                    chrome.downloads.download({ url, filename: 'tabs_plus_plus_sets.json' });
                });
                break;
            case 'hibernate_all': {
                const tabs = await chrome.tabs.query({ active: false });
                tabs.forEach(t => { if (!t.discarded) chrome.tabs.discard(t.id).catch(() => {}); });
                break;
            }
            case 'hibernate_window': {
                const tabs = await chrome.tabs.query({ currentWindow: true, active: false });
                tabs.forEach(t => { if (!t.discarded) chrome.tabs.discard(t.id).catch(() => {}); });
                break;
            }
            case 'hibernate_pinned': {
                const tabs = await chrome.tabs.query({ pinned: true });
                tabs.forEach(t => { if (!t.discarded) chrome.tabs.discard(t.id).catch(() => {}); });
                break;
            }
            case 'hibernate_current':
                if (tab && !tab.discarded) chrome.tabs.discard(tab.id).catch(() => {});
                break;
            case 'pause_media':
                if (tab) chrome.tabs.sendMessage(tab.id, { action: 'pause-media' }).catch(() => {});
                break;
            case 'mute_background': {
                const tabs = await chrome.tabs.query({ audible: true, active: false });
                tabs.forEach(t => chrome.tabs.update(t.id, { muted: true }));
                break;
            }
            case 'zen_fullscreen':
                chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'fullscreen' });
                break;
            case 'snapshot_session':
                syncBaselinesToStorage(); saveSnapshot();
                break;
            case 'clear_cache_hour':
                chrome.browsingData.remove({ since: Date.now() - 3600000 }, { cache: true, cookies: false, history: true });
                break;
            case 'clear_unprotected': {
                const tabs = await chrome.tabs.query({ currentWindow: true });
                const toClose = tabs.filter(t => !t.pinned && t.groupId === NONE_GROUP && !t.active).map(t => t.id);
                if (toClose.length > 0) chrome.tabs.remove(toClose);
                break;
            }
            case 'toggle_pin':
                if (tab) chrome.tabs.update(tab.id, { pinned: !tab.pinned });
                break;
            case 'duplicate_tab':
                if (tab) chrome.tabs.duplicate(tab.id);
                break;
            case 'toggle_mute':
                if (tab) chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
                break;
            case 'toggle_group':
                if (!tab) break;
                if (tab.groupId !== NONE_GROUP) {
                    chrome.tabs.ungroup(tab.id);
                } else {
                    const gid = await chrome.tabs.group({ tabIds: [tab.id] });
                    await chrome.tabGroups.update(gid, { title: '' });
                }
                break;
            case 'copy_md_link':
                if (tab) {
                    const md = `[${tab.title}](${tab.url})`;
                    chrome.tabs.sendMessage(tab.id, { action: 'copy-to-clipboard', text: md }).catch(() => {});
                }
                break;
            case 'hard_reload':
                if (tab) chrome.tabs.reload(tab.id, { bypassCache: true });
                break;
            case 'split_view': {
                if (!tab) break;
                const win = await chrome.windows.get(tab.windowId);
                const halfW = Math.floor(win.width / 2);
                await chrome.windows.update(tab.windowId, { width: halfW, left: win.left });
                const newWin = await chrome.windows.create({ url: tab.url, width: halfW, left: win.left + halfW, top: win.top, height: win.height, focused: false });
                break;
            }
            case 'close_other_tabs': {
                const tabs = await chrome.tabs.query({ currentWindow: true });
                const toClose = tabs.filter(t => t.id !== tab?.id && !t.pinned).map(t => t.id);
                if (toClose.length > 0) chrome.tabs.remove(toClose);
                break;
            }
            case 'update_baseline':
                if (tab) {
                    const stored = memoryBaselines.get(tab.id);
                    if (stored) { memoryBaselines.set(tab.id, { ...stored, url: tab.url }); syncBaselinesToStorage(); }
                }
                break;
            case 'set_baseline_url':
                if (tab && args) {
                    let url = args.trim();
                    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
                    const stored = memoryBaselines.get(tab.id);
                    if (stored) { memoryBaselines.set(tab.id, { ...stored, url }); syncBaselinesToStorage(); }
                }
                break;
            case 'open_downloads': chrome.tabs.create({ url: 'chrome://downloads/' }); break;
            case 'open_extensions': chrome.tabs.create({ url: 'chrome://extensions/' }); break;
            case 'open_settings': chrome.tabs.create({ url: 'chrome://settings/' }); break;
            case 'set_gpu': chrome.tabs.create({ url: 'chrome://settings/?search=hardware+acceleration' }); break;
            case 'set_performance': chrome.tabs.create({ url: 'chrome://settings/performance' }); break;
            case 'set_privacy': chrome.tabs.create({ url: 'chrome://settings/privacy' }); break;
            case 'set_clear_data': chrome.tabs.create({ url: 'chrome://settings/clearBrowserData' }); break;
            case 'set_cookies': chrome.tabs.create({ url: 'chrome://settings/cookies' }); break;
            case 'set_ad_privacy': chrome.tabs.create({ url: 'chrome://settings/adPrivacy' }); break;
            case 'set_permissions': chrome.tabs.create({ url: 'chrome://settings/content' }); break;
            case 'set_passwords': chrome.tabs.create({ url: 'chrome://password-manager/passwords' }); break;
            case 'set_autofill': chrome.tabs.create({ url: 'chrome://settings/addresses' }); break;
            case 'set_payments': chrome.tabs.create({ url: 'chrome://settings/payments' }); break;
            case 'set_appearance': chrome.tabs.create({ url: 'chrome://settings/appearance' }); break;
            case 'set_fonts': chrome.tabs.create({ url: 'chrome://settings/fonts' }); break;
            case 'set_search': chrome.tabs.create({ url: 'chrome://settings/search' }); break;
            case 'set_downloads': chrome.tabs.create({ url: 'chrome://settings/downloads' }); break;
            case 'set_languages': chrome.tabs.create({ url: 'chrome://settings/languages' }); break;
            case 'set_accessibility': chrome.tabs.create({ url: 'chrome://settings/accessibility' }); break;
            case 'set_flags': chrome.tabs.create({ url: 'chrome://flags/' }); break;
            case 'set_reset': chrome.tabs.create({ url: 'chrome://settings/reset' }); break;
            case 'set_help': chrome.tabs.create({ url: 'chrome://settings/help' }); break;
            case 'set_sync': chrome.tabs.create({ url: 'chrome://settings/syncSetup' }); break;
            case 'set_startup': chrome.tabs.create({ url: 'chrome://settings/onStartup' }); break;
            case 'set_extensions': chrome.tabs.create({ url: 'chrome://extensions/' }); break;
        }
    } catch (e) { console.error('[Tabs++] executeAction error:', commandId, e); }
}
