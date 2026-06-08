import { globalSettings, updateSettings, tabSets, memoryBaselines, sessionVault } from '../state.js';
import { startPomoTimer, stopPomoTimer } from './pomoService.js';
import { BANGS, NONE_GROUP, SEARCH_ENGINES } from '../constants.js';
import { getBaseDomain } from '../utils.js';
import { syncBaselinesToStorage, saveSnapshot, ensureLoaded, safeHibernate, updateCleanupAlarms } from './tabService.js';
import { performSaveSet, performLaunchSet, performSummonSet, performDeleteSet, performReplaceSet } from './setService.js';



// ── Performance: Search Cancellation & Caching ──
let searchGeneration = 0;
let pendingFetchController = null;
let tabCache = { results: [], ts: 0 };
const historyCache = new Map();
const HISTORY_CACHE_TTL = 2000;

// ── Recent Actions ──
const recentActions = [];
const MAX_RECENT = 6;
const ACTION_RESULTS_LIMIT = 50;

function recordRecentAction(commandId) {
    const base = commandId.includes('|') ? commandId.split('|')[0] : commandId;

    const skipSet = new Set([
        'replace_workspace_prompt',
        'summon_set_prompt'
    ]);
    if (skipSet.has(base)) return;

    // Store the full commandId for piped commands so the exact
    // engine/time/volume selection appears in recents.
    const id = commandId;

    const idx = recentActions.findIndex(a => a === id);
    if (idx !== -1) recentActions.splice(idx, 1);

    recentActions.unshift(id);
    if (recentActions.length > MAX_RECENT) recentActions.length = MAX_RECENT;
}

function getCachedTabs() {
    const now = Date.now();
    if (now - tabCache.ts < 500) return Promise.resolve(tabCache.results);
    return chrome.tabs.query({}).then(tabs => {
        tabCache = { results: tabs, ts: now };
        return tabs;
    });
}

function getCachedHistory(query) {
    if (!query) return Promise.resolve([]);
    const cached = historyCache.get(query);
    if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL) return Promise.resolve(cached.results);
    return chrome.history.search({ text: query, maxResults: 10 }).then(results => {
        historyCache.set(query, { results, ts: Date.now() });
        return results;
    });
}

function getSuggestions(query) {
    if (!query || query.length < 2) return Promise.resolve([]);
    const suggestUrl = getSuggestUrl(query);
    if (!suggestUrl) return Promise.resolve([]);
    if (pendingFetchController) pendingFetchController.abort();
    pendingFetchController = new AbortController();
    const timer = setTimeout(() => pendingFetchController.abort(), 3000);
    return fetch(suggestUrl, { signal: pendingFetchController.signal })
        .then(r => r.json())
        .then(data => {
            clearTimeout(timer);
            if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
                return data.map(item => item.phrase).filter(Boolean);
            }
            return Array.isArray(data) ? data[1] || [] : [];
        })
        .catch(() => []);
}

function withTimeout(promise, ms, fallback) {
    if (!promise) return Promise.resolve(fallback);
    return Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))]);
}

// Helper for Color Conversion
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(s => s + s).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) h = s = 0;
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const EXTENSION_ACTIONS = [
    { type: 'action', id: 'magic_organize', category: 'Organization', title: 'Magic Organize Workspace', aliases: ['group', 'sort', 'tidy'] },
    { type: 'action', id: 'ungroup_all', category: 'Organization', title: 'Ungroup All Tabs', aliases: ['flatten', 'remove groups'] },
    { type: 'action', id: 'dedupe_window', category: 'Organization', title: 'Close Duplicate Tabs', aliases: ['dedupe', 'duplicates', 'clean'] },
    { type: 'action', id: 'merge_groups', category: 'Organization', title: 'Merge Duplicate Groups', aliases: ['fix groups', 'cleanup groups', 'consolidate groups'] },
    { type: 'action', id: 'gather_standalone', category: 'Organization', title: 'Gather Standalone Tabs', aliases: ['extract', 'pull'] },
    { type: 'action', id: 'consolidate_domain', category: 'Organization', title: 'Consolidate Domain', aliases: ['merge', 'same site'] },
    { type: 'action', id: 'extract_group', category: 'Organization', title: 'Extract Group to Window', aliases: ['move group', 'pop out'] },
    { type: 'action', id: 'save_workspace', category: 'Sets', title: 'Save Workspace as Set', aliases: ['snapshot', 'store window', 'save'] },
    { type: 'action', id: 'save_window_all', category: 'Sets', title: 'Save All Tabs as Set', aliases: ['snapshot all', 'store all', 'save all'] },
    { type: 'action', id: 'replace_workspace_prompt', category: 'Sets', title: 'Replace Workspace...', aliases: ['swap', 'switch workspace', 'load set', 'replace'] },
    { type: 'action', id: 'summon_set_prompt', category: 'Sets', title: 'Summon Set...', aliases: ['merge set', 'insert', 'summon'] },
    { type: 'action', id: 'save_group', category: 'Sets', title: 'Save Group as Set', aliases: ['store group', 'save'] },
    { type: 'action', id: 'stash_group', category: 'Sets', title: 'Stash Current Group', aliases: ['hide', 'store and close'] },
    { type: 'action', id: 'export_sets', category: 'Sets', title: 'Export Sets JSON', aliases: ['backup sets', 'download'] },
    { type: 'action', id: 'hibernate_all', category: 'Performance', title: 'Hibernate Background Tabs', aliases: ['sleep', 'ram', 'memory', 'freeze'] },
    { type: 'action', id: 'hibernate_window', category: 'Performance', title: 'Hibernate Window', aliases: ['sleep', 'ram', 'memory'] },
    { type: 'action', id: 'pause_media', category: 'Performance', title: 'Pause All Media', aliases: ['stop audio', 'video', 'music'] },
    { type: 'action', id: 'toggle_pip', category: 'Media', title: 'Picture-in-Picture (PiP)', aliases: ['pip', 'video', 'pop out'], requiredSetting: 'autoPiP' },
    { type: 'action', id: 'open_eyedropper', category: 'Tools', title: 'Open Color Eyedropper', aliases: ['color', 'picker', 'hex', 'eyedropper'], requiredSetting: 'enableEyedropper' },
    { type: 'action', id: 'take_screenshot', category: 'Tools', title: 'Full-Page Screenshot', aliases: ['screenshot', 'capture', 'save page', 'png', 'snap'], requiredSetting: 'enableScreenshot' },
    { type: 'action', id: 'extract_media', category: 'Tools', title: 'Extract Media Assets', aliases: ['images', 'video', 'download', 'scrape'], requiredSetting: 'enableMediaExtractor' },
    { type: 'action', id: 'vol_up', category: 'Media', title: 'Volume Up (+10%)', aliases: ['volume', 'louder', 'audio up', 'sound'], requiredSetting: 'enableVolumeControl' },
    { type: 'action', id: 'vol_down', category: 'Media', title: 'Volume Down (-10%)', aliases: ['volume', 'quieter', 'audio down', 'sound'], requiredSetting: 'enableVolumeControl' },
    { type: 'action', id: 'vol_max', category: 'Media', title: 'Volume Max (100%)', aliases: ['volume', 'max volume', 'full volume', 'loud'], requiredSetting: 'enableVolumeControl' },
    { type: 'action', id: 'mute_background', category: 'Performance', title: 'Mute Background Tabs', aliases: ['silence', 'quiet', 'audio'] },
    { type: 'action', id: 'hibernate_pinned', category: 'Performance', title: 'Hibernate All Pinned Tabs', aliases: ['sleep pins', 'ram', 'memory'] },
    { type: 'action', id: 'hibernate_current', category: 'Performance', title: 'Hibernate Current Tab', aliases: ['sleep this', 'ram', 'memory'] },
    { type: 'action', id: 'toggle_reader', category: 'Focus', title: 'Focus View (Reader Mode)', aliases: ['read', 'strip', 'clean page', 'article', 'focus view'], requiredSetting: 'enableFocusView' },
    { type: 'action', id: 'zen_fullscreen', category: 'Focus', title: 'Enter Zen Fullscreen', aliases: ['focus', 'maximize', 'hide ui'] },
    { type: 'action', id: 'snapshot_session', category: 'Safety', title: 'Snapshot Session Now', aliases: ['backup', 'save state'] },
    { type: 'action', id: 'clear_cache_hour', category: 'Safety', title: 'Panic Close (Clear Last Hour)', aliases: ['history', 'delete', 'wipe'] },
    { type: 'action', id: 'clear_unprotected', category: 'Organization', title: 'Close Unprotected Tabs', aliases: ['clear today', 'close loose', 'sweep'] },
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
    { type: 'action', id: 'group_all_tabs', category: 'Organization', title: 'Group All Tabs', aliases: ['group all', 'cluster all', 'organize'] },
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
    { type: 'action', id: 'toggle_time_format', category: 'Appearance', title: 'Toggle Time Format (12h/24h)', aliases: ['clock', '12h', '24h', 'time format'] },
    { type: 'action', id: 'toggle_show_clock', category: 'Appearance', title: 'Toggle Clock Visibility', aliases: ['clock', 'time', 'hide clock', 'show clock'] },
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
    { type: 'action', id: 'set_extensions', category: 'System', title: 'Manage Extensions', aliases: ['addons', 'plugins', 'manage'] },
    { type: 'action', id: 'pomo_25', category: 'Focus', title: 'Start 25m Pomodoro', aliases: ['timer', 'focus', 'pomo', 'work'], requiredSetting: 'enablePomo' },
    { type: 'action', id: 'pomo_50', category: 'Focus', title: 'Start 50m Pomodoro', aliases: ['timer', 'focus', 'pomo', 'deep work'], requiredSetting: 'enablePomo' },
    { type: 'action', id: 'pomo_5', category: 'Focus', title: 'Start 5m Break', aliases: ['timer', 'rest', 'short break'], requiredSetting: 'enablePomo' },
    { type: 'action', id: 'pomo_15', category: 'Focus', title: 'Start 15m Break', aliases: ['timer', 'rest', 'long break'], requiredSetting: 'enablePomo' },
    { type: 'action', id: 'pomo_stop', category: 'Focus', title: 'Stop Timer', aliases: ['cancel timer', 'end pomo'], requiredSetting: 'enablePomo' },
    { type: 'action', id: 'set_clean_time', category: 'Settings', title: 'Set Clean Time', aliases: ['auto close time', 'clean time', 'idle timeout'] },
    { type: 'action', id: 'set_hibernate_time', category: 'Settings', title: 'Set Hibernate Time', aliases: ['sleep time', 'hibernate time', 'suspend timeout'] },
    { type: 'action', id: 'set_search_engine|google', category: 'Settings', title: 'Search Engine: Google', aliases: ['google search'] },
    { type: 'action', id: 'set_search_engine|duckduckgo', category: 'Settings', title: 'Search Engine: DuckDuckGo', aliases: ['ddg', 'duckduckgo'] },
    { type: 'action', id: 'set_search_engine|bing', category: 'Settings', title: 'Search Engine: Bing', aliases: ['bing'] },
    { type: 'action', id: 'set_search_engine|brave', category: 'Settings', title: 'Search Engine: Brave', aliases: ['brave search'] },
    { type: 'action', id: 'set_search_engine|perplexity', category: 'Settings', title: 'Search Engine: Perplexity', aliases: ['perplexity'] },
    { type: 'action', id: 'toggle_default_ntp', category: 'Appearance', title: 'Toggle Default NTP', aliases: ['default new tab', 'use chrome ntp', 'default ntp'] },
    { type: 'action', id: 'peek_block_site', category: 'Appearance', title: 'Disable Auto-Peek on This Site', aliases: ['peek block', 'block peek', 'exclude from peek'], requiredSetting: 'autoPeekCrossDomain' },
    { type: 'action', id: 'peek_unblock_site', category: 'Appearance', title: 'Enable Auto-Peek on This Site', aliases: ['peek unblock', 'allow peek', 'include in peek'], requiredSetting: 'autoPeekCrossDomain' }
];

function getSearchUrl(query) {
    const engine = SEARCH_ENGINES[globalSettings.searchEngine] || SEARCH_ENGINES.google;
    return engine.url + encodeURIComponent(query);
}

function getSuggestUrl(query) {
    const engine = SEARCH_ENGINES[globalSettings.searchEngine] || SEARCH_ENGINES.google;
    if (!engine.suggest) return null;
    return engine.suggest + encodeURIComponent(query);
}

function resolveBang(query) {
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

    const currentGen = ++searchGeneration;
    const query = (typeof request.query === 'string' ? request.query : "").trim();
    const lowerQuery = query.toLowerCase();
    
    if (query.startsWith('>')) {
        const actionQuery = query.substring(1).trim().toLowerCase();
        const dynamicRegex = /^(summon|launch|replace|delete set)\s*(.*)/;
        const dynamicMatch = actionQuery.match(dynamicRegex);
        
        if (dynamicMatch) {
            let op = dynamicMatch[1];
            
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
                    let id = `${op === 'summon' ? 'summon_set_palette' : op === 'replace' ? 'replace_set_palette' : op === 'launch' ? 'launch_set_palette' : 'delete_set_palette'}|${setName}`;
                    let titlePrefix = op === 'summon' ? 'Summon' : op === 'replace' ? 'Replace' : op === 'launch' ? 'Launch' : 'Delete';
                    results.push({ type: 'action', id, category: 'Sets', title: `${titlePrefix} Set: "${setName}"` });
                }
            });
            sendResponse({ results: results.slice(0, 15) });
            return;
        }

        // Handle direct timer setting commands: "> clean time 1h" or "> hibernate 30m"
        const timerCmdRegex = /^(clean time|hibernate time|clean|hibernate)\s+(.*)/i;
        const timerMatch = actionQuery.match(timerCmdRegex);
        if (timerMatch) {
            const op = timerMatch[1].toLowerCase();
            const val = timerMatch[2].trim();
            const isClean = op.includes('clean');
            const targetId = isClean ? 'set_clean_time' : 'set_hibernate_time';
            const targetTitle = isClean ? 'Set Clean Time' : 'Set Hibernate Time';
            
            // Only show if the value looks like a valid time (e.g. "1m", "2h")
            if (/^\d+(?:\.\d+)?\s*(m|h)$/i.test(val)) {
                sendResponse({ 
                    results: [{ 
                        type: 'action', 
                        id: `${targetId}|${val}`, 
                        category: 'Settings', 
                        title: `${targetTitle} to ${val}`,
                        subtitle: `Press Enter to apply ${isClean ? 'auto-close' : 'auto-sleep'}`
                    }] 
                });
                return;
            }
        }

        // Handle volume command: ">vol 75", ">vol 50", etc.
        if (globalSettings.enableVolumeControl) {
            const volMatch = actionQuery.match(/^vol(?:ume)?\s+(\d+)%?$/);
            if (volMatch) {
                const level = Math.min(100, Math.max(0, parseInt(volMatch[1], 10)));
                sendResponse({
                    results: [{
                        type: 'action',
                        id: `set_volume|${level}`,
                        category: 'Media',
                        title: `Set Volume to ${level}%`,
                        subtitle: 'Press Enter to apply'
                    }]
                });
                return;
            }
        }

        let filtered = EXTENSION_ACTIONS
            .filter(a => !a.requiredSetting || globalSettings[a.requiredSetting])
            .filter(a => a.title.toLowerCase().includes(actionQuery) || a.category.toLowerCase().includes(actionQuery) || (a.aliases && a.aliases.some(alias => alias.toLowerCase().includes(actionQuery))));

        if (!actionQuery && recentActions.length > 0) {
            const recentResults = [];
            const recentIds = new Set();

            for (const actionId of recentActions) {
                let action = EXTENSION_ACTIONS.find(a => a.id === actionId);
                if (!action && actionId.includes('|')) {
                    const base = actionId.split('|')[0];
                    action = EXTENSION_ACTIONS.find(a => a.id === base);
                }
                if (action && (!action.requiredSetting || globalSettings[action.requiredSetting])) {
                    recentResults.push({ ...action, _recent: true });
                    recentIds.add(action.id);
                }
            }

            const remaining = filtered.filter(a => !recentIds.has(a.id));
            filtered = [...recentResults, ...remaining];
        }

        sendResponse({ results: filtered.slice(0, ACTION_RESULTS_LIMIT).map(a => ({ ...a, _cmdPalette: true })) });
        return;
    }

    if (lowerQuery.startsWith('timer ')) {
        const mins = parseInt(lowerQuery.replace('timer ', ''));
        if (!isNaN(mins) && mins > 0) {
            sendResponse({ results: [{ type: 'action', id: `pomo_custom|${mins}`, category: 'Focus', title: `Start ${mins}m Custom Timer`, aliases: ['timer', 'pomo'] }] });
            return;
        }
    }
    
    const pTabs = getCachedTabs();
    const pHistory = query ? getCachedHistory(query) : Promise.resolve([]);
    const pBookmarks = (query && chrome.bookmarks) ? chrome.bookmarks.search({ query: query }) : Promise.resolve([]);
    const pClosed = (!query && chrome.sessions) ? chrome.sessions.getRecentlyClosed({ maxResults: 7 }) : Promise.resolve([]);
    const pSuggestions = getSuggestions(query);

    let virtualResults = [];
    if (query && globalSettings.enableUnitConverter) {
        // Fast pre-filter: avoid running all regexes on normal search queries
        const isMathOrUnit = /\d/.test(query);
        const isHex = query.startsWith('#') || /^[a-fA-F0-9]{3,6}$/.test(query);
        const isTextCommand = /^(lorem|base64|url|slug|camel|snake|title|upper|lower)\b/i.test(query);

        if (isMathOrUnit || isHex || isTextCommand) {
            // 1. Math Evaluation
            const mathMatch = query.match(/^(\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(\d+(?:\.\d+)?)$/);
            if (mathMatch) {
                const a = parseFloat(mathMatch[1]), op = mathMatch[2], b = parseFloat(mathMatch[3]);
                let res;
                if (op === '+') res = a + b;
                else if (op === '-') res = a - b;
                else if (op === '*') res = a * b;
                else if (op === '/') res = a / b;
                if (res !== undefined) {
                    res = parseFloat(res.toFixed(4));
                    virtualResults.push({ type: 'action', id: `copy_clipboard|${res}`, category: 'Calculator', title: `Result: ${res}`, subtitle: 'Press Enter to copy' });
                }
            }

            // 2. Units (px <-> rem)
            const unitMatch = query.match(/^(\d+(?:\.\d+)?)\s*(px|rem)?$/i);
            if (unitMatch) {
                const val = parseFloat(unitMatch[1]), unit = (unitMatch[2] || '').toLowerCase();
                const base = globalSettings.baseRemSize || 16;
                if (unit === 'px' || unit === '') {
                    const rem = parseFloat((val / base).toFixed(4));
                    virtualResults.push({ type: 'action', id: `copy_clipboard|${rem}rem`, category: 'Unit Converter', title: `${rem}rem`, subtitle: `Based on ${base}px root` });
                }
                if (unit === 'rem' || (unit === '' && val < 100)) {
                    const px = parseFloat((val * base).toFixed(4));
                    virtualResults.push({ type: 'action', id: `copy_clipboard|${px}px`, category: 'Unit Converter', title: `${px}px`, subtitle: `Based on ${base}px root` });
                }
            }

            // 3. Physical Units (m, cm, mm, in, ft)
            const physMatch = query.match(/^(\d+(?:\.\d+)?)\s*(m|cm|mm|in|ft)$/i);
            if (physMatch) {
                const val = parseFloat(physMatch[1]), unit = physMatch[2].toLowerCase();
                let meters;
                if (unit === 'm') meters = val;
                else if (unit === 'cm') meters = val / 100;
                else if (unit === 'mm') meters = val / 1000;
                else if (unit === 'in') meters = val * 0.0254;
                else if (unit === 'ft') meters = val * 0.3048;

                if (meters !== undefined) {
                    const formats = [
                        { v: meters, u: 'm' },
                        { v: meters * 100, u: 'cm' },
                        { v: meters * 1000, u: 'mm' },
                        { v: meters / 0.0254, u: 'in' },
                        { v: meters / 0.3048, u: 'ft' }
                    ];
                    formats.forEach(f => {
                        if (f.u === unit) return;
                        const rounded = parseFloat(f.v.toFixed(4));
                        virtualResults.push({ type: 'action', id: `copy_clipboard|${rounded}${f.u}`, category: 'Physical Converter', title: `${rounded}${f.u}`, subtitle: `Converted from ${val}${unit}` });
                    });
                }
            }

            // 4. Case Converter (slug, camel, snake, title, upper, lower)
            const caseMatch = query.match(/^(slug|camel|snake|title|upper|lower)\s+(.+)$/i);
            if (caseMatch) {
                const op = caseMatch[1].toLowerCase(), text = caseMatch[2];
                let res;
                if (op === 'slug') res = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
                else if (op === 'snake') res = text.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g).map(x => x.toLowerCase()).join('_');
                else if (op === 'camel') res = text.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g).map((x, i) => i === 0 ? x.toLowerCase() : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join('');
                else if (op === 'title') res = text.toLowerCase().split(' ').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' ');
                else if (op === 'upper') res = text.toUpperCase();
                else if (op === 'lower') res = text.toLowerCase();

                if (res) virtualResults.push({ type: 'action', id: `copy_clipboard|${res}`, category: 'Case Converter', title: res, subtitle: `Converted to ${op}` });
            }

            // 5. Encoding (base64, url)
            const encMatch = query.match(/^(base64|url)\s+(.+)$/i);
            if (encMatch) {
                const op = encMatch[1].toLowerCase(), text = encMatch[2];
                let res;
                try {
                    if (op === 'base64') {
                        const isB64 = /^[A-Za-z0-9+/]*={0,2}$/.test(text) && text.length % 4 === 0;
                        if (isB64) {
                            try { res = atob(text); } catch(e) { res = btoa(text); }
                        } else {
                            res = btoa(text);
                        }
                    } else if (op === 'url') {
                        const isEncoded = text.includes('%');
                        res = isEncoded ? decodeURIComponent(text) : encodeURIComponent(text);
                    }
                } catch(e) {}

                if (res) virtualResults.push({ type: 'action', id: `copy_clipboard|${res}`, category: 'Encoding', title: res, subtitle: `${op} transformation` });
            }

            // 6. Lorem Ipsum (lorem [count|p])
            const loremMatch = query.match(/^lorem(?:\s+(p|\d+))?$/i);
            if (loremMatch) {
                const words = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "ut", "enim", "ad", "minim", "veniam", "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi", "ut", "aliquip", "ex", "ea", "commodo", "consequat"];
                let count = 5;
                if (loremMatch[1] === 'p') count = 40;
                else if (loremMatch[1]) count = parseInt(loremMatch[1]);
                
                let res = [];
                for (let i = 0; i < count; i++) {
                    res.push(words[Math.floor(Math.random() * words.length)]);
                }
                let text = res.join(' ');
                text = text.charAt(0).toUpperCase() + text.slice(1) + '.';
                virtualResults.push({ type: 'action', id: `copy_clipboard|${text}`, category: 'Lorem Ipsum', title: text.length > 50 ? text.substring(0, 50) + '...' : text, subtitle: `Generate ${count} words` });
            }

            // 7. Colors (Hex -> RGB/HSL)
            const hexMatch = query.match(/^#?([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/);
            if (hexMatch) {
                const rgb = hexToRgb(hexMatch[0]);
                const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
                const rgbStr = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                const hslStr = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
                virtualResults.push({ type: 'action', id: `copy_clipboard|${rgbStr}`, category: 'Color Converter', title: rgbStr, subtitle: 'Copy RGB' });
                virtualResults.push({ type: 'action', id: `copy_clipboard|${hslStr}`, category: 'Color Converter', title: hslStr, subtitle: 'Copy HSL' });
            }


        }
    }

    Promise.all([
        withTimeout(pTabs, 5000, []),
        withTimeout(pHistory, 3000, []),
        withTimeout(pBookmarks, 3000, []),
        withTimeout(pSuggestions, 2000, []),
        withTimeout(pClosed, 3000, [])
    ]).then(async ([tabs, history, bookmarks, suggestions, closedSessions]) => {
        if (currentGen !== searchGeneration) return;
        let results = [...virtualResults];
        if (query) {
            const bang = resolveBang(query);
            if (bang) results.push(bang);
            else if (/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(lowerQuery)) results.push({ type: 'navigate', title: `Go to ${query}`, url: lowerQuery.startsWith('http') ? lowerQuery : 'https://' + lowerQuery });
            else results.push({ type: 'search', title: `Search ${SEARCH_ENGINES[globalSettings.searchEngine]?.label || 'Google'} for "${query}"`, url: getSearchUrl(query) });
        }
        suggestions.slice(0, 5).forEach(s => results.push({ type: 'search', title: s, url: getSearchUrl(s) }));
        
        const formattedTabs = tabs.filter(t => !query || (t.title && t.title.toLowerCase().includes(lowerQuery)) || (t.url && t.url.toLowerCase().includes(lowerQuery))).slice(0, query ? 5 : 15).map(t => ({
            type: 'tab', id: t.id, title: t.title || t.url, url: t.url, windowId: t.windowId, favIconUrl: t.favIconUrl || null, groupId: t.groupId ?? NONE_GROUP
        }));
        
        results.push(...formattedTabs);
        results.push(...bookmarks.filter(b => b.url).slice(0, 5).map(b => ({ type: 'bookmark', title: b.title || b.url, url: b.url })));
        results.push(...history.filter(h => h.url && !tabs.some(t => t.url === h.url)).slice(0, 10).map(h => ({ type: 'history', title: h.title || h.url, url: h.url })));
        if (!query && closedSessions) results.push(...closedSessions.filter(s => s.tab && s.tab.url && !s.tab.url.startsWith('chrome')).slice(0, 5).map(s => ({ type: 'closed', title: s.tab.title || s.tab.url, url: s.tab.url, favIconUrl: s.tab.favIconUrl || null })));
        if (sessionVault.length > 0 && (!query || "restore".includes(lowerQuery))) {
            results.unshift({ type: 'vault', title: `Restore ${sessionVault.length} protected tabs`, url: 'virtual:restore-vault' });
        }

        const setResults = [];
        Object.keys(tabSets).forEach(setName => {
            if (query && setName.toLowerCase().includes(lowerQuery)) {
                setResults.push({ 
                    type: 'action', 
                    id: `replace_set_palette|${setName}`, 
                    category: 'Sets', 
                    title: `Replace Workspace: "${setName}"`,
                    subtitle: 'Ghost-proof swap'
                });
                setResults.push({ 
                    type: 'action', 
                    id: `summon_set_palette|${setName}`, 
                    category: 'Sets', 
                    title: `Summon Set: "${setName}"`,
                    subtitle: `Merge ${tabSets[setName].tabs.length} tabs into this window`
                });
            }
        });
        if (setResults.length > 0) {
            results = [...setResults, ...results];
        }

        const seen = new Set();
        sendResponse({ results: results.filter(r => !r.url || (seen.has(r.url) ? false : seen.add(r.url))) });
    }).catch(() => sendResponse({ results: [] }));
}

export async function executeAction(commandId, args, senderTab = null) {
    await ensureLoaded();
    recordRecentAction(commandId);
    try {
        // Pipe-delimited dynamic palette commands
        if (commandId.includes('|')) {
            const [base, extra] = commandId.split('|');
            if (base === 'summon_group_palette') {
                const gid = parseInt(extra);
                if (!isNaN(gid)) {
                    const currentWinId = senderTab ? senderTab.windowId : chrome.windows.WINDOW_ID_CURRENT;
                    const gTabs = await chrome.tabs.query({ groupId: gid });
                    if (gTabs.length > 0) await chrome.tabs.move(gTabs.map(t => t.id), { windowId: currentWinId, index: -1 });
                }
                return;
            }
            if (base === 'summon_set_palette') { performSummonSet(extra).catch(() => {}); return; }
            if (base === 'replace_set_palette') { performReplaceSet(extra).catch(() => {}); return; }
            if (base === 'launch_set_palette') { performLaunchSet(extra).catch(() => {}); return; }
            if (base === 'delete_set_palette') { performDeleteSet(extra).catch(() => {}); return; }

            if (base === 'set_search_engine') {
                if (SEARCH_ENGINES[extra]) {
                    updateSettings({ searchEngine: extra });
                    chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                }
                return;
            }

            if (base === 'pomo_custom') {
                const mins = parseInt(extra);
                startPomoTimer(mins, 'work');
                return;
            }

            if (base === 'set_volume') {
                if (globalSettings.enableVolumeControl) {
                    const level = Math.min(100, Math.max(0, parseInt(extra, 10)));
                    const tab = senderTab || (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
                    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'set-volume', level }).catch(() => {});
                }
                return;
            }

            if (base === 'set_clean_time' || base === 'set_hibernate_time') {
                const match = extra.trim().match(/^(\d+(?:\.\d+)?)\s*(m|h)$/i);
                if (match) {
                    const val = parseFloat(match[1]);
                    const unit = match[2].toLowerCase();
                    const raw = `${val}${unit}`;
                    let ms = unit === 'm' ? val * 60 * 1000 : val * 3600 * 1000;
                    if (ms >= 60 * 1000) {
                        if (base === 'set_clean_time') updateSettings({ archiveThresholdRaw: raw });
                        else updateSettings({ hibernateThresholdRaw: raw });
                        chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                        updateCleanupAlarms();
                    }
                }
                return;
            }
        }

        // --- NEW: Command Palette Prompts ---
        if (commandId === 'replace_workspace_prompt') {
            const tab = senderTab || (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
            if (tab) chrome.tabs.sendMessage(tab.id, { action: 'update-palette-query', query: '> replace ' }).catch(() => {});
            return;
        }
        if (commandId === 'summon_set_prompt') {
            const tab = senderTab || (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
            if (tab) chrome.tabs.sendMessage(tab.id, { action: 'update-palette-query', query: '> summon ' }).catch(() => {});
            return;
        }

        const tab = senderTab || (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
        const currentWinId = tab ? tab.windowId : chrome.windows.WINDOW_ID_CURRENT;

        switch (commandId) {
            case 'toggle_time_format': {
                const next = globalSettings.timeFormat === '24h' ? '12h' : '24h';
                updateSettings({ timeFormat: next });
                chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                break;
            }
            case 'toggle_show_clock': {
                globalSettings.showClock = !globalSettings.showClock;
                chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                break;
            }
            case 'toggle_default_ntp': {
                updateSettings({ useDefaultNtp: !globalSettings.useDefaultNtp });
                chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                break;
            }
            case 'peek_block_site': {
                if (tab && tab.url) {
                    try {
                        const hostname = new URL(tab.url).hostname;
                        const domain = getBaseDomain(hostname);
                        const list = globalSettings.peekExcludedDomains || [];
                        if (!list.includes(domain)) {
                            updateSettings({ peekExcludedDomains: [...list, domain] });
                            chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                        }
                    } catch (e) {}
                }
                break;
            }
            case 'peek_unblock_site': {
                if (tab && tab.url) {
                    try {
                        const hostname = new URL(tab.url).hostname;
                        const domain = getBaseDomain(hostname);
                        const list = globalSettings.peekExcludedDomains || [];
                        const idx = list.indexOf(domain);
                        if (idx !== -1) {
                            const next = [...list];
                            next.splice(idx, 1);
                            updateSettings({ peekExcludedDomains: next });
                            chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                        }
                    } catch (e) {}
                }
                break;
            }
            case 'magic_organize': {
                const tabs = await chrome.tabs.query({ windowId: currentWinId, pinned: false });
                const domainMap = {};
                tabs.forEach(t => { try { const d = new URL(t.url).hostname.replace('www.', ''); if (!domainMap[d]) domainMap[d] = []; domainMap[d].push(t); } catch (e) {} });
                for (const d in domainMap) if (domainMap[d].length > 1) { const gid = await chrome.tabs.group({ tabIds: domainMap[d].map(t => t.id) }); await chrome.tabGroups.update(gid, { title: d }); }
                break;
            }
            case 'ungroup_all': {
                const tabs = await chrome.tabs.query({ windowId: currentWinId });
                tabs.forEach(t => { if (t.groupId !== NONE_GROUP) chrome.tabs.ungroup(t.id).catch(() => {}); });
                break;
            }
            case 'dedupe_window': {
                const tabs = await chrome.tabs.query({ windowId: currentWinId });
                const seen = new Set(); const toClose = [];
                tabs.forEach(t => { if (!t.url) return; const c = t.url.split('#')[0]; if (seen.has(c)) { if (!t.active) toClose.push(t.id); } else seen.add(c); });
                if (toClose.length > 0) chrome.tabs.remove(toClose);
                break;
            }
            case 'merge_groups': {
                if (!chrome.tabGroups) break;
                const groups = await chrome.tabGroups.query({});
                const titleMap = {};
                for (const g of groups) {
                    const title = g.title || '';
                    if (!titleMap[title]) {
                        const tabsInG = await chrome.tabs.query({ groupId: g.id });
                        titleMap[title] = { id: g.id, tabs: tabsInG };
                    } else {
                        const extraTabs = await chrome.tabs.query({ groupId: g.id });
                        if (extraTabs.length > 0) {
                            await chrome.tabs.group({ tabIds: extraTabs.map(t => t.id), groupId: titleMap[title].id });
                        }
                    }
                }
                break;
            }
            case 'gather_standalone': {
                if (!tab) break;
                const tabs = await chrome.tabs.query({ windowId: currentWinId });
                const standaloneIds = tabs.filter(t => !t.pinned && t.groupId === NONE_GROUP && t.id !== tab.id).map(t => t.id);
                if (standaloneIds.length > 1) { const gid = await chrome.tabs.group({ tabIds: standaloneIds }); await chrome.tabGroups.update(gid, { title: 'Standalone' }); }
                break;
            }
            case 'consolidate_domain': {
                if (!tab?.url) break;
                const host = new URL(tab.url).hostname;
                const tabs = await chrome.tabs.query({ windowId: currentWinId });
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
            case 'set_clean_time':
            case 'set_hibernate_time': {
                const match = (args || '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|h)$/i);
                if (match) {
                    const val = parseFloat(match[1]);
                    const unit = match[2].toLowerCase();
                    const raw = `${val}${unit}`;
                    let ms = 0;
                    if (unit === 'm') ms = val * 60 * 1000;
                    else if (unit === 'h') ms = val * 60 * 60 * 1000;
                    if (ms >= 1 * 60 * 1000) { // minimum: 1 minute
                        if (commandId === 'set_clean_time') {
                            updateSettings({ archiveThresholdRaw: raw });
                        } else {
                            updateSettings({ hibernateThresholdRaw: raw });
                        }
                        chrome.storage.local.set({ settings: globalSettings }).catch(() => {});
                        updateCleanupAlarms(); // apply new alarm frequencies immediately
                    }
                }
                break;
            }
            case 'save_workspace':
                performSaveSet({ setType: 'workspace', name: args || 'Workspace' }).catch(() => {});
                break;
            case 'save_window_all':
                performSaveSet({ setType: 'all', name: args || 'Complete Set' }).catch(() => {});
                break;
            case 'save_group':
                if (tab && tab.groupId !== NONE_GROUP) performSaveSet({ setType: 'group', name: args || 'Group', groupId: tab.groupId }).catch(() => {});
                break;
            case 'stash_group': {
                if (!tab || tab.groupId === NONE_GROUP) break;
                await performSaveSet({ setType: 'group', name: args || 'Stashed Group', groupId: tab.groupId }).catch(() => {});
                const gTabs = await chrome.tabs.query({ groupId: tab.groupId });
                chrome.tabs.remove(gTabs.map(t => t.id));
                break;
            }
            case 'export_sets':
                ensureLoaded().then(() => {
                    const res = { sets: tabSets };
                    if (!res?.sets) return;
                    const url = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.sets, null, 2));
                    chrome.downloads.download({ url, filename: 'tabs_plus_plus_sets.json' });
                });
                break;
            case 'hibernate_all': {
                const tabs = await chrome.tabs.query({ active: false });
                tabs.forEach(t => safeHibernate(t).catch(() => {}));
                break;
            }
            case 'hibernate_window': {
                const tabs = await chrome.tabs.query({ windowId: currentWinId, active: false });
                tabs.forEach(t => safeHibernate(t).catch(() => {}));
                break;
            }
            case 'hibernate_pinned': {
                const tabs = await chrome.tabs.query({ pinned: true });
                tabs.forEach(t => safeHibernate(t).catch(() => {}));
                break;
            }
            case 'hibernate_current':
                if (tab) safeHibernate(tab).catch(() => {});
                break;
            case 'pause_media':
                if (tab) chrome.tabs.sendMessage(tab.id, { action: 'pause-media' }).catch(() => {});
                break;
            case 'toggle_pip':
                if (tab && globalSettings.autoPiP) chrome.tabs.sendMessage(tab.id, { action: 'toggle-pip' }).catch(() => {});
                break;
            case 'open_eyedropper':
                if (tab && globalSettings.enableEyedropper) {
                    // Wait for the command palette to completely fade out (approx 300ms)
                    // before taking the screenshot so it doesn't obstruct the image.
                    setTimeout(async () => {
                        try {
                            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
                            chrome.tabs.sendMessage(tab.id, { action: 'start-custom-eyedropper', dataUrl }).catch(() => {});
                        } catch (e) {
                            console.error('[Tabs++] Error capturing tab for eyedropper:', e);
                        }
                    }, 350);
                }
                break;
            case 'take_screenshot': {
                if (!tab || !globalSettings.enableScreenshot) break;
                // Just tell content to start — content drives the loop via capture-viewport messages
                setTimeout(() => {
                    chrome.tabs.sendMessage(tab.id, { action: 'start-screenshot-capture' }).catch(() => {});
                }, 350);
                break;
            }
            case 'mute_background': {
                const tabs = await chrome.tabs.query({ audible: true, active: false });
                tabs.forEach(t => chrome.tabs.update(t.id, { muted: true }));
                break;
            }
            case 'zen_fullscreen':
                chrome.windows.update(currentWinId, { state: 'fullscreen' });
                break;
            case 'snapshot_session':
                syncBaselinesToStorage(); saveSnapshot();
                break;
            case 'clear_cache_hour':
                chrome.browsingData.remove({ since: Date.now() - 3600000 }, { cache: true, cookies: false, history: true });
                break;
            case 'clear_unprotected': {
                const tabs = await chrome.tabs.query({ windowId: currentWinId });
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
            case 'group_all_tabs': {
                const tabs = await chrome.tabs.query({ windowId: currentWinId, pinned: false });
                const toGroup = tabs.filter(t => t.groupId === NONE_GROUP).map(t => t.id);
                if (toGroup.length > 0) {
                    const gid = await chrome.tabs.group({ tabIds: toGroup });
                    await chrome.tabGroups.update(gid, { title: 'Grouped Tabs' }).catch(() => {});
                }
                break;
            }
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
                const tabs = await chrome.tabs.query({ windowId: currentWinId });
                const toClose = tabs.filter(t => t.id !== tab?.id).map(t => t.id);
                if (toClose.length > 0) chrome.tabs.remove(toClose);
                break;
            }
            case "update_baseline":
                if (tab) {
                    const stored = memoryBaselines.get(tab.id);
                    if (stored) {
                        let url = tab.url;
                        try {
                            const res = await chrome.tabs.sendMessage(tab.id, { action: "get-video-time" }).catch(() => null);
                            if (res?.timestamp) {
                                const u = new URL(url);
                                if (u.hostname.includes("vimeo.com")) {
                                    u.hash = "t=" + res.timestamp;
                                } else {
                                    u.searchParams.set("t", res.timestamp);
                                }
                                url = u.toString();
                            }
                        } catch (e) {}
                        memoryBaselines.set(tab.id, { ...stored, url });
                        syncBaselinesToStorage();
                    }
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
            case 'pomo_25': if (globalSettings.enablePomo) startPomoTimer(25, 'work'); break;
            case 'pomo_50': if (globalSettings.enablePomo) startPomoTimer(50, 'work'); break;
            case 'pomo_5':  if (globalSettings.enablePomo) startPomoTimer(5, 'break'); break;
            case 'pomo_15': if (globalSettings.enablePomo) startPomoTimer(15, 'break'); break;
            case 'pomo_stop': if (globalSettings.enablePomo) stopPomoTimer(); break;
            case 'vol_up':
                if (globalSettings.enableVolumeControl) chrome.tabs.sendMessage(tab?.id, { action: 'set-volume', delta: 10 }).catch(() => {});
                break;
            case 'vol_down':
                if (globalSettings.enableVolumeControl) chrome.tabs.sendMessage(tab?.id, { action: 'set-volume', delta: -10 }).catch(() => {});
                break;
            case 'vol_max':
                if (globalSettings.enableVolumeControl) chrome.tabs.sendMessage(tab?.id, { action: 'set-volume', level: 100 }).catch(() => {});
                break;
            case 'toggle_reader':
                if (tab && globalSettings.enableFocusView) chrome.tabs.sendMessage(tab.id, { action: 'toggle-reader-view' }).catch(() => {});
                break;
        }
    } catch (e) { console.error('[Tabs++] executeAction error:', commandId, e); }
}
