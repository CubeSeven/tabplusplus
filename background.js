// --- Zero-Overhead In-Memory State ---
let memoryBaselines = new Map(); // tabId -> { url, index, windowId, pinned, groupId }
let globalSettings = { protectPinned: true, protectGrouped: true, enablePalette: false, enableAutoGroup: false };
const GROUPING_RULES = [
    { title: 'Dev', color: 'blue', domains: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'aws.amazon.com', 'console.cloud.google.com', 'vercel.com', 'netlify.com', 'docker.com', 'cloudflare.com', 'jira.com', 'atlassian.net', 'linear.app', 'developer.mozilla.org', 'npmjs.com', 'codepen.io', 'replit.com', 'codesandbox.io', 'postman.com', 'sentry.io', 'datadoghq.com', 'cursor.sh', 'cursor.com', 'warp.dev', 'bun.sh', 'railway.app', 'supabase.com', 'huggingface.co', 'leetcode.com', 'geeksforgeeks.org', 'pypi.org', 'hub.docker.com', 'crates.io', 'search.maven.org'] },
    { title: 'Design', color: 'purple', domains: ['figma.com', 'canva.com', 'dribbble.com', 'behance.net', 'miro.com', 'framer.com', 'spline.design', 'adobe.com', 'awwwards.com', 'lottiefiles.com', 'unsplash.com', 'pexels.com', 'colorhunt.co', 'sketch.com', 'invisionapp.com', 'principleformac.com', 'zeplin.io', 'affinity.serif.com', 'coreldraw.com', 'muz.li', 'land-book.com', 'siteinspire.com', 'fontshare.com', 'fonts.google.com', 'coolors.co', 'iconify.design', 'flaticon.com', 'readymag.com', 'typedream.com', 'poly.cam', 'sketchfab.com'] },
    { title: 'AI', color: 'green', domains: ['chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'grok.com', 'deepseek.com', 'poe.com', 'midjourney.com', 'leonardo.ai', 'runwayml.com', 'pika.art', 'suno.com', 'udio.com', 'elevenlabs.io', 'zapier.com', 'make.com', 'gamma.app', 'notebooklm.google.com', 'consensus.app', 'phind.com'] },
    { title: 'Media', color: 'red', domains: ['youtube.com', 'netflix.com', 'spotify.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'vimeo.com', 'soundcloud.com', 'music.apple.com', 'plex.tv', 'crunchyroll.com', 'paramountplus.com', 'peacocktv.com', 'mubi.com', 'nebula.tv', 'curiositystream.com', 'steampowered.com', 'epicgames.com', 'ign.com', 'gamespot.com', 'roblox.com', 'letterboxd.com', 'pocketcasts.com', 'mixcloud.com', 'bandcamp.com', 'tidal.com', 'audible.com'] },
    { title: 'News', color: 'yellow', domains: ['nytimes.com', 'bbc.com', 'news.google.com', 'theverge.com', 'techcrunch.com', 'wsj.com', 'news.ycombinator.com', 'bloomberg.com', 'cnn.com', 'reuters.com', 'theguardian.com', 'hbr.org', 'wired.com', 'arstechnica.com', 'apnews.com', 'aljazeera.com', 'fortune.com', 'forbes.com', 'qz.com', 'mashable.com', 'engadget.com', 'gizmodo.com', 'medium.com', 'substack.com', 'ted.com', 'wikipedia.org', 'marketwatch.com', 'investopedia.com', 'finance.yahoo.com', 'seekingalpha.com'] },
    { title: 'Social', color: 'cyan', domains: ['x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'discord.com', 'web.whatsapp.com', 'messenger.com', 'tumblr.com', 'threads.net', 'bsky.app', 'polywork.com', 'slack.com', 'mastodon.social', 'fark.com', 'quora.com', 'nextdoor.com', 'wechat.com', 'telegram.org', 'vk.com', 'line.me', 'lemon8-app.com'] }
];
let isInitialized = false;
let sessionVault = [];

// Sync Vault Storage
function syncVaultToStorage() {
    chrome.storage.local.set({ vault: sessionVault });
}

// Debounced Storage Sync
let syncTimeout = null;
function syncBaselinesToStorage() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        const obj = Object.fromEntries(memoryBaselines);
        chrome.storage.local.set({ baselines: obj });
    }, 1000);
}

let loadPromise = null;
function ensureLoaded() {
    if (isInitialized) return Promise.resolve();
    if (!loadPromise) {
        loadPromise = chrome.storage.local.get(['baselines', 'settings', 'vault']).then((data) => {
            if (data.settings) globalSettings = { ...globalSettings, ...data.settings };
            sessionVault = data.vault || [];
            
            const storedBaselines = data.baselines || {};
            memoryBaselines.clear();
            for (const [key, value] of Object.entries(storedBaselines)) {
                memoryBaselines.set(parseInt(key, 10), value);
            }
            isInitialized = true;
        });
    }
    return loadPromise;
}

// Full initialization and sync (Run on startup/install)
async function initializeState() {
    await ensureLoaded();
    
    const tabs = await chrome.tabs.query({});
    const currentActiveIds = new Set(tabs.map(t => t.id));
    let changed = false;
    
    // Cleanup ghosts
    for (const id of memoryBaselines.keys()) {
        if (!currentActiveIds.has(id)) {
            memoryBaselines.delete(id);
            changed = true;
        }
    }
    
    for (const tab of tabs) {
        if (processTab(tab)) changed = true;
    }
    
    if (changed) syncBaselinesToStorage();
}

// O(1) process single tab
function processTab(tab) {
    let isProtected = false;
    if (globalSettings.protectPinned && tab.pinned) isProtected = true;
    if (globalSettings.protectGrouped && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) isProtected = true;
    
    const url = tab.url || tab.pendingUrl;
    let changed = false;

    if (isProtected && url && !url.startsWith('chrome')) {
        const existing = memoryBaselines.get(tab.id);
        if (!existing) {
            memoryBaselines.set(tab.id, {
                url: url,
                index: tab.index,
                windowId: tab.windowId,
                pinned: tab.pinned,
                groupId: tab.groupId
            });
            changed = true;
        } else {
            // Update metadata without modifying baseline url
            if (existing.index !== tab.index || existing.windowId !== tab.windowId || existing.pinned !== tab.pinned || existing.groupId !== tab.groupId) {
                existing.index = tab.index;
                existing.windowId = tab.windowId;
                existing.pinned = tab.pinned;
                existing.groupId = tab.groupId;
                changed = true;
            }
        }
    } else if (memoryBaselines.has(tab.id)) {
        memoryBaselines.delete(tab.id);
        changed = true;
    }
    
    return changed;
}

// Debounced generic update logic to ignore ephemeral Chrome close-state events
let updateTrackerTimeout = null;
function scheduleUpdate() {
    if (updateTrackerTimeout) clearTimeout(updateTrackerTimeout);
    updateTrackerTimeout = setTimeout(async () => {
        await ensureLoaded();
        const tabs = await chrome.tabs.query({});
        let changed = false;
        for (const tab of tabs) {
            if (processTab(tab)) changed = true;
        }
        if (changed) syncBaselinesToStorage();
    }, 300);
}

// O(1) Fast-Path Event Listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.pinned !== undefined || changeInfo.groupId !== undefined || changeInfo.url !== undefined) {
        scheduleUpdate();
    }
    
    // Auto-Grouping Logic
    if (globalSettings.enableAutoGroup && changeInfo.url && !tab.pinned && !changeInfo.url.startsWith('chrome')) {
        applyAutoGrouping(tab);
    }
});

async function applyAutoGrouping(tab) {
    if (!tab.url) return;
    
    let matchedRule = null;
    try {
        const urlObj = new URL(tab.url);
        const host = urlObj.hostname;
        
        // Match specific rules first
        matchedRule = GROUPING_RULES.find(rule => rule.domains.some(domain => host === domain || host.endsWith('.' + domain)));
        
        // If no specifically matched rule, apply catch-all for .ai domains
        if (!matchedRule && host.endsWith('.ai')) {
            matchedRule = GROUPING_RULES.find(rule => rule.title === 'AI');
        }
    } catch(e) { return; }

    if (!matchedRule) return;

    try {
        // Find if a group with the expected title already exists in the same window
        const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: matchedRule.title });
        
        let groupIdToUse = (groups && groups.length > 0) ? groups[0].id : null;

        if (groupIdToUse !== null) {
            // Join existing group
            await chrome.tabs.group({ tabIds: tab.id, groupId: groupIdToUse });
        } else {
            // Create new group
            groupIdToUse = await chrome.tabs.group({ tabIds: tab.id });
            await chrome.tabGroups.update(groupIdToUse, { title: matchedRule.title, color: matchedRule.color });
        }
    } catch (e) {
        console.error("Auto-grouping failed", e);
    }
}

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    scheduleUpdate();
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    scheduleUpdate();
});

// Settings Update Listener
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
        await ensureLoaded();
        globalSettings = { ...globalSettings, ...changes.settings.newValue };
        // Full re-eval on settings change
        chrome.tabs.query({}).then(tabs => {
            let changed = false;
            for (const tab of tabs) {
                if (processTab(tab)) changed = true;
            }
            if (changed) syncBaselinesToStorage();
        });
    }
});

// Memory-backed instantaneous restore
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await ensureLoaded();

    // O(1) Memory lookup
    const data = memoryBaselines.get(tabId);
    
    // Check if entire window is being closed
    if (removeInfo.isWindowClosing) {
        if (data && data.url) {
            // Save to Vault instead of ignoring
            if (!sessionVault.some(t => t.url === data.url && t.groupId === data.groupId)) {
                sessionVault.push(data);
                syncVaultToStorage();
            }
        }
        return;
    }

    if (data && data.url) {
        console.log("Restoring protected tab:", data.url);
        
        // Evict immediately to prevent race conditions during restore loop
        memoryBaselines.delete(tabId);
        syncBaselinesToStorage();

        // Fire-and-forget restoration chain (unblocks main thread instantly)
        (async () => {
            try {
                // Determine recovery window/tab focus
                const existingNewTabs = await chrome.tabs.query({ 
                    windowId: removeInfo.windowId,
                    url: ['chrome://newtab/', 'chrome-search://local-ntp/local-ntp.html'] 
                });

                if (existingNewTabs.length > 0) {
                    chrome.tabs.update(existingNewTabs[0].id, { active: true }).catch(() => {});
                } else {
                    chrome.tabs.create({ windowId: removeInfo.windowId, active: true }).catch(() => {});
                }

                // Silent background recreation
                setTimeout(async () => {
                    try {
                        const newTab = await chrome.tabs.create({
                            url: data.url,
                            pinned: data.pinned,
                            index: data.index,
                            windowId: data.windowId,
                            active: false
                        });
                        
                        if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                            chrome.tabs.group({ tabIds: [newTab.id], groupId: data.groupId }).catch(() => {});
                        }

                        // Strict discard optimized for Chrome's tab scheduling
                        setTimeout(() => {
                            chrome.tabs.discard(newTab.id).catch(() => {});
                        }, 800); 
                    } catch (e) {
                        console.error("Delayed restore failed:", e);
                    }
                }, 50);

            } catch (e) {
                console.error("Restore logic failed:", e);
                chrome.tabs.create({ url: data.url, pinned: data.pinned });
            }
        })();
    }
});

// Init Hooks
chrome.runtime.onInstalled.addListener(() => initializeState());
chrome.runtime.onStartup.addListener(() => initializeState());
initializeState();

// --- COMMAND PALETTE LOGIC ---

// Bang shortcuts — resolved entirely within the extension, browser-agnostic
const BANGS = {
    '!g':     { url: 'https://www.google.com/search?q=',                  label: 'Google' },
    '!ddg':   { url: 'https://duckduckgo.com/?q=',                         label: 'DuckDuckGo' },
    '!yt':    { url: 'https://www.youtube.com/results?search_query=',      label: 'YouTube' },
    '!w':     { url: 'https://en.wikipedia.org/wiki/Special:Search?search=', label: 'Wikipedia' },
    '!gh':    { url: 'https://github.com/search?q=',                       label: 'GitHub' },
    '!r':     { url: 'https://www.reddit.com/search/?q=',                  label: 'Reddit' },
    '!x':     { url: 'https://x.com/search?q=',                            label: 'X (Twitter)' },
    '!maps':  { url: 'https://www.google.com/maps/search/',                label: 'Google Maps' },
    '!mdn':   { url: 'https://developer.mozilla.org/en-US/search?q=',      label: 'MDN' },
    '!npm':   { url: 'https://www.npmjs.com/search?q=',                    label: 'npm' },
    '!img':   { url: 'https://www.google.com/search?tbm=isch&q=',         label: 'Google Images' },
    '!tw':    { url: 'https://x.com/search?q=',                            label: 'X (Twitter)' },
    '!sp':    { url: 'https://open.spotify.com/search/',                   label: 'Spotify' },
    '!a':     { url: 'https://www.amazon.com/s?k=',                        label: 'Amazon' },
    '!so':    { url: 'https://stackoverflow.com/search?q=',                label: 'Stack Overflow' },
    '!fig':   { url: 'https://www.figma.com/search?q=',                    label: 'Figma Community' },
    '!can':   { url: 'https://www.canva.com/search?q=',                    label: 'Canva' },
    '!pin':   { url: 'https://www.pinterest.com/search/pins/?q=',          label: 'Pinterest' },
    // AI
    '!px':    { url: 'https://www.perplexity.ai/search?q=',               label: 'Perplexity' },
    '!gpt':   { url: 'https://chatgpt.com/?q=',                            label: 'ChatGPT' },
};

function resolveBang(query) {
    const match = query.match(/^(!\S+)\s*(.*)/);
    if (!match) return null;
    const [, bang, rest] = match;
    const entry = BANGS[bang.toLowerCase()];
    if (!entry) return null;
    return {
        type: 'bang',
        bang: bang.toLowerCase(),
        label: entry.label,
        title: rest ? `${entry.label} → "${rest}"` : `Open ${entry.label}`,
        url: entry.url + encodeURIComponent(rest)
    };
}

// Listen for global shortcut
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-palette") {
        await ensureLoaded();
        const settings = globalSettings;
        if (!settings.enablePalette) return;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "toggle-palette" }).catch(err => {
                    // Fallback to the dedicated Magic Tab if messaging fails (restricted pages)
                    chrome.tabs.create({ url: chrome.runtime.getURL("ntp.html?action=palette"), active: true });
                });
            } else {
                chrome.tabs.create({ url: chrome.runtime.getURL("ntp.html?action=palette"), active: true });
            }
        });
    }
});

// Handle search queries from the palette
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "search-items") {
        ensureLoaded().then(() => {
            const settings = globalSettings;
            if (!settings.enablePalette) {
                sendResponse({ results: [] });
                return;
            }

            const query = (request.query || "").trim();
            const lowerQuery = query.toLowerCase();
            
            const pTabs = chrome.tabs.query({}).catch(() => []);
            const pHistory = (query && chrome.history) ? chrome.history.search({ text: query, maxResults: 10 }).catch(() => []) : Promise.resolve([]);
            const pBookmarks = (query && chrome.bookmarks) ? chrome.bookmarks.search({ query: query }).catch(() => []) : Promise.resolve([]);
            const pClosed = (!query && chrome.sessions) ? chrome.sessions.getRecentlyClosed({ maxResults: 7 }).catch(() => []) : Promise.resolve([]);
            
            // Google Suggest API
            const pSuggestions = (query) ? 
                fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`)
                    .then(r => r.json())
                    .then(data => data[1] || [])
                    .catch(() => []) : 
                Promise.resolve([]);

            Promise.all([pTabs, pHistory, pBookmarks, pSuggestions, pClosed]).then(async ([tabs, history, bookmarks, suggestions, closedSessions]) => {
                let results = [];

                // 1. Direct URL, Bang, or Search Heuristic
                if (query) {
                    const bangResult = resolveBang(query);
                    const isUrl = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(lowerQuery) || lowerQuery.startsWith('localhost');

                    if (bangResult) {
                        // Known bang — resolve directly, skip Google entirely
                        results.push(bangResult);
                    } else if (query.match(/^!\S+/)) {
                        // Unknown bang — degrade gracefully to Google with a hint
                        results.push({
                            type: 'search',
                            title: `Search Google for "${query}"`,
                            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
                        });
                    } else if (isUrl) {
                        let url = lowerQuery;
                        if (!url.startsWith('http')) url = 'https://' + url;
                        results.push({
                            type: 'navigate',
                            title: `Go to ${query}`,
                            url: url
                        });
                    } else {
                        results.push({
                            type: 'search',
                            title: `Search Google for "${query}"`,
                            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
                        });
                    }
                }

                // 2. Google Suggestions
                suggestions.slice(0, 5).forEach(s => {
                    results.push({
                        type: 'search',
                        title: s,
                        url: `https://www.google.com/search?q=${encodeURIComponent(s)}`
                    });
                });

                // 3. Formatted Tabs
                const formattedTabs = tabs
                    .filter(t => !query || (t.title && t.title.toLowerCase().includes(lowerQuery)) || (t.url && t.url.toLowerCase().includes(lowerQuery)))
                    .slice(0, query ? 5 : 15)
                    .map(t => ({
                        type: 'tab',
                        id: t.id,
                        title: t.title || t.url,
                        url: t.url,
                        windowId: t.windowId,
                        favIconUrl: t.favIconUrl || null,
                        groupId: t.groupId ?? -1,
                    }));

                // Attach group colors
                const groupIds = [...new Set(formattedTabs.filter(t => t.groupId !== -1).map(t => t.groupId))];
                const groupColorMap = {};
                await Promise.all(groupIds.map(async gid => {
                    try {
                        const g = await chrome.tabGroups.get(gid);
                        groupColorMap[gid] = g.color;
                    } catch {}
                }));
                formattedTabs.forEach(t => {
                    if (t.groupId !== -1) t.groupColor = groupColorMap[t.groupId] || null;
                });

                results.push(...formattedTabs);

                // 4. Bookmarks
                const formattedBookmarks = bookmarks
                    .filter(b => b.url)
                    .slice(0, 5)
                    .map(b => ({
                        type: 'bookmark',
                        title: b.title || b.url,
                        url: b.url
                    }));
                results.push(...formattedBookmarks);

                // 5. History
                const formattedHistory = history
                    .filter(h => h.url && !tabs.some(t => t.url === h.url))
                    .slice(0, 10)
                    .map(h => ({
                        type: 'history',
                        title: h.title || h.url,
                        url: h.url
                    }));
                results.push(...formattedHistory);

                // 6. Recently Closed (only shown when no query)
                if (!query && closedSessions && closedSessions.length > 0) {
                    const formattedClosed = closedSessions
                        .filter(s => s.tab && s.tab.url && !s.tab.url.startsWith('chrome'))
                        .slice(0, 5)
                        .map(s => ({
                            type: 'closed',
                            title: s.tab.title || s.tab.url,
                            url: s.tab.url,
                            favIconUrl: s.tab.favIconUrl || null,
                        }));
                    results.push(...formattedClosed);
                }

                // Deduplicate by URL (prefer types in order)
                const seen = new Set();
                const finalResults = results.filter(r => {
                    if (!r.url) return true;
                    if (seen.has(r.url)) return false;
                    seen.add(r.url);
                    return true;
                });

                sendResponse({ results: finalResults });
            }).catch(err => {
                console.error("Search error:", err);
                sendResponse({ results: [] });
            });
        });
        
        return true; 
    }
    
    if (request.action === "switch-to-tab") {
        chrome.tabs.update(request.tabId, { active: true });
        chrome.windows.update(request.windowId, { focused: true });
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === "restore-vault") {
        ensureLoaded().then(async () => {
            if (!sessionVault || sessionVault.length === 0) {
                sendResponse({ success: false });
                return;
            }
            
            // Group by original windowId
            const windowsToRestore = {};
            sessionVault.forEach(tab => {
                if (!windowsToRestore[tab.windowId]) windowsToRestore[tab.windowId] = [];
                windowsToRestore[tab.windowId].push(tab);
            });
            
            for (const winId of Object.keys(windowsToRestore)) {
                const newWin = await chrome.windows.create({ focused: true });
                for (const data of windowsToRestore[winId]) {
                    const newTab = await chrome.tabs.create({
                        url: data.url,
                        pinned: data.pinned,
                        windowId: newWin.id,
                        active: false
                    });
                    if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                        chrome.tabs.group({ tabIds: [newTab.id], groupId: data.groupId }).catch(() => {});
                    }
                }
                // Cleanup blank default tab
                const allWinTabs = await chrome.tabs.query({ windowId: newWin.id });
                if (allWinTabs.length > windowsToRestore[winId].length) {
                    chrome.tabs.remove(allWinTabs[0].id).catch(() => {});
                }
            }
            
            sessionVault = [];
            syncVaultToStorage();
            sendResponse({ success: true });
        });
        return true;
    }
    
    if (request.action === "clear-vault") {
        ensureLoaded().then(() => {
            sessionVault = [];
            syncVaultToStorage();
            sendResponse({ success: true });
        });
        return true;
    }
    
    if (request.action === "open-url") {
        // ALWAYS New Tab as requested by user
        chrome.tabs.create({ url: request.url, active: true });
        sendResponse({ success: true });
        return true;
    }
});
