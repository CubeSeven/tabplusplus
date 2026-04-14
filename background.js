// --- Zero-Overhead In-Memory State ---
let memoryBaselines = new Map(); // tabId -> { url, index, windowId, pinned, groupId }
let globalSettings = { protectPinned: true, protectGrouped: true, enablePalette: true, enableAutoGroup: false };
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
let lastSession = []; // To store the safety snapshot
let storedProfiles = {};
let groupCache = new Map(); // groupId -> { title, color }
let peekWindows = new Map(); // Map of active Peek windowIds -> { windowId, groupId }
let evictionGraveyard = new Map(); // tabId -> { data, timeoutIndex }

chrome.windows.onRemoved.addListener((windowId) => {
    peekWindows.delete(windowId);
});

// Sync Vault Storage
function syncVaultToStorage() {
    chrome.storage.local.set({ vault: sessionVault });
}

// Sync Profiles Storage
function syncProfilesToStorage() {
    chrome.storage.local.set({ profiles: storedProfiles });
}

// Debounced Storage Sync
let syncTimeout = null;
function syncBaselinesToStorage() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        const obj = Object.fromEntries(memoryBaselines);
        chrome.storage.local.set({ baselines: obj });
        saveSnapshot(); // Save the safety snapshot whenever baselines settle
    }, 1000);
}

// Deterministic hibernation: waits for tab to finish loading before discarding
function safeDiscard(tabId) {
    const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.discard(tabId).catch(() => {});
        }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout: remove listener after 5s if tab hangs
    setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 5000);
}

// Safety Snapshot of all grouped/pinned tabs
function saveSnapshot() {
    const snapshot = Array.from(memoryBaselines.values());
    chrome.storage.local.set({ lastSession: snapshot });
}

// Auto-cleanup for the vault when user manually opens a URL
function removeFromVault(url) {
    if (!url) return;
    const initialLens = sessionVault.length;
    sessionVault = sessionVault.filter(t => t.url !== url);
    if (sessionVault.length !== initialLens) {
        syncVaultToStorage();
    }
}

let loadPromise = null;
function ensureLoaded() {
    if (isInitialized) return Promise.resolve();
    if (!loadPromise) {
        loadPromise = chrome.storage.local.get(['baselines', 'settings', 'vault', 'lastSession', 'profiles']).then((data) => {
            if (data.settings) globalSettings = { ...globalSettings, ...data.settings };
            sessionVault = data.vault || [];
            lastSession = data.lastSession || [];
            storedProfiles = data.profiles || {};
            
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
    if (chrome.tabGroups) {
        try {
            const groups = await chrome.tabGroups.query({});
            groupCache.clear();
            groups.forEach(g => groupCache.set(g.id, { title: g.title, color: g.color }));
        } catch (e) {}
    }
    const currentActiveIds = new Set(tabs.map(t => t.id));
    let changed = false;
    
    // Cleanup ghosts and move to vault if they are lost during startup
    for (const [id, data] of memoryBaselines.entries()) {
        if (!currentActiveIds.has(id)) {
            // Check if this was a legitimate tab that we lost
            if (data && data.url) {
                if (!sessionVault.some(t => t.url === data.url && t.groupId === data.groupId)) {
                    sessionVault.push(data);
                }
            }
            memoryBaselines.delete(id);
            changed = true;
        }
    }
    
    if (changed) {
        syncVaultToStorage();
    }
    
    for (const tab of tabs) {
        if (processTab(tab)) changed = true;
    }
    
    if (changed) syncBaselinesToStorage();
}

// O(1) Fast-Path Event Listeners
function processTab(tab) {
    if (peekWindows.has(tab.windowId)) return false; // Never protect tabs in Peak windows

    let isProtected = false;
    if (globalSettings.protectPinned && tab.pinned) isProtected = true;
    if (globalSettings.protectGrouped && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) isProtected = true;
    
    const url = tab.url || tab.pendingUrl;
    // Notify the content script so it can intercept links
    try {
        if (url && !url.startsWith('chrome')) {
            chrome.tabs.sendMessage(tab.id, { action: 'update-tab-status', isProtected: isProtected }).catch(() => {});
        }
    } catch (e) {
        // Ignore synchronous errors like "Cannot access chrome:// URLs"
    }

    let changed = false;

    if (isProtected && url && !url.startsWith('chrome')) {
        const existing = memoryBaselines.get(tab.id);
        let groupTitle, groupColor;
        if (tab.groupId !== -1 && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1) && groupCache.has(tab.groupId)) {
            const g = groupCache.get(tab.groupId);
            groupTitle = g.title;
            groupColor = g.color;
        }
        if (!existing) {
            memoryBaselines.set(tab.id, {
                url: url,
                index: tab.index,
                windowId: tab.windowId,
                pinned: tab.pinned,
                groupId: tab.groupId,
                groupTitle: groupTitle,
                groupColor: groupColor
            });
            changed = true;
        } else {
            // Update metadata without modifying baseline url
            if (existing.index !== tab.index || existing.windowId !== tab.windowId || existing.pinned !== tab.pinned || existing.groupId !== tab.groupId || existing.groupTitle !== groupTitle || existing.groupColor !== groupColor) {
                existing.index = tab.index;
                existing.windowId = tab.windowId;
                existing.pinned = tab.pinned;
                existing.groupId = tab.groupId;
                existing.groupTitle = groupTitle;
                existing.groupColor = groupColor;
                changed = true;
            }
        }
    } else if (memoryBaselines.has(tab.id)) {
        const evictedData = memoryBaselines.get(tab.id);
        memoryBaselines.delete(tab.id);
        
        // Anti-race condition: Chrome sometimes ungroups completely right before closing.
        // We throw it in the graveyard for 1 second. If onRemoved hits, we still restore it.
        if (evictionGraveyard.has(tab.id)) clearTimeout(evictionGraveyard.get(tab.id).timeout);
        const tId = setTimeout(() => evictionGraveyard.delete(tab.id), 1000);
        evictionGraveyard.set(tab.id, { data: evictedData, timeout: tId });
        
        changed = true;
    }
    
    return changed;
}

// O(1) Fast-Path Event Listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        removeFromVault(changeInfo.url);
    }
    
    // Trigger sync on structural changes OR load completion (ensures windowId/index are mapped)
    if (changeInfo.pinned !== undefined || changeInfo.groupId !== undefined || changeInfo.url !== undefined || changeInfo.status === 'complete') {
        if (processTab(tab)) {
            syncBaselinesToStorage();
        }
    }
    
    // Auto-Grouping Logic
    if (globalSettings.enableAutoGroup && changeInfo.url && !tab.pinned && !changeInfo.url.startsWith('chrome')) {
        applyAutoGrouping(tab);
    }
});

if (chrome.tabGroups) {
    chrome.tabGroups.onUpdated.addListener((group) => {
        groupCache.set(group.id, { title: group.title, color: group.color });
        let changed = false;
        for (const [id, data] of memoryBaselines.entries()) {
            if (data.groupId === group.id) {
                if (data.groupTitle !== group.title || data.groupColor !== group.color) {
                    data.groupTitle = group.title;
                    data.groupColor = group.color;
                    changed = true;
                }
            }
        }
        if (changed) syncBaselinesToStorage();
    });
    
    chrome.tabGroups.onRemoved.addListener((group) => {
        groupCache.delete(group.id);
    });
}

// Prevent group inheritance for tabs opened from protected (pinned/grouped) tabs
chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.openerTabId && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
        await ensureLoaded();
        try {
            const opener = await chrome.tabs.get(tab.openerTabId);
            if (opener) {
                const isOpenerProtected = (globalSettings.protectPinned && opener.pinned) || 
                                          (globalSettings.protectGrouped && opener.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1));
                
                if (isOpenerProtected) {
                    // Force the new tab to be independent
                    chrome.tabs.ungroup(tab.id).catch(() => {});
                }
            }
        } catch (e) {
            // Opener tab might have been closed already
        }
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
    chrome.tabs.get(tabId, (tab) => {
        if (tab && processTab(tab)) syncBaselinesToStorage();
    });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    chrome.tabs.get(tabId, (tab) => {
        if (tab && processTab(tab)) syncBaselinesToStorage();
    });
});

// Settings Update Listener
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
        await ensureLoaded();
        globalSettings = { ...globalSettings, ...changes.settings.newValue };
        // Full re-eval on settings change
        chrome.tabs.query({}).then(async tabs => {
            if (chrome.tabGroups) {
                try {
                    const groups = await chrome.tabGroups.query({});
                    groupCache.clear();
                    groups.forEach(g => groupCache.set(g.id, { title: g.title, color: g.color }));
                } catch (e) {}
            }
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

    // O(1) Memory lookup (check active baselines, then fallback to graveyard for race conditions)
    let data = memoryBaselines.get(tabId);
    if (!data && evictionGraveyard.has(tabId)) {
        data = evictionGraveyard.get(tabId).data;
        clearTimeout(evictionGraveyard.get(tabId).timeout);
        evictionGraveyard.delete(tabId);
    }
    
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
                            index: data.index >= 0 ? data.index : undefined,
                            windowId: data.windowId,
                            active: false
                        });
                        
                        if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                            chrome.tabs.group({ tabIds: [newTab.id], groupId: data.groupId }).catch(() => {});
                        }

                        safeDiscard(newTab.id);
                    } catch (e) {
                        console.error("Delayed restore failed:", e);
                        // Ultimate Safety Net: If strict attributes failed, force generic tab creation
                        chrome.tabs.create({ url: data.url, pinned: data.pinned, active: false }).catch(() => {});
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
chrome.runtime.onInstalled.addListener(() => {
    initializeState();
    chrome.alarms.create("archiveCheck", { periodInMinutes: 60 });
});
chrome.runtime.onStartup.addListener(() => {
    initializeState();
    chrome.alarms.create("archiveCheck", { periodInMinutes: 60 });
});
initializeState();

// --- AUTO-ARCHIVE LOGIC ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "archiveCheck") {
        await ensureLoaded();
        if (!globalSettings.enableAutoArchive) return;

        const cutoffTime = Date.now() - (12 * 60 * 60 * 1000); // 12 hours ago
        const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
        
        for (const t of tabs) {
            // Check if unprotected: not pinned, not active, not in a group
            if (!t.pinned && !t.active && t.groupId === (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                // Remove if it hasn't been accessed recently
                if (t.lastAccessed && t.lastAccessed < cutoffTime) {
                    chrome.tabs.remove(t.id).catch(() => {});
                }
            }
        }
    }
});

// --- COMMAND PALETTE LOGIC ---

const EXTENSION_ACTIONS = [
    { type: 'action', id: 'magic_organize', category: 'Organization', title: 'Magic Organize Workspace', aliases: ['group', 'sort', 'tidy'] },
    { type: 'action', id: 'ungroup_all', category: 'Organization', title: 'Ungroup All Tabs', aliases: ['flatten', 'remove groups'] },
    { type: 'action', id: 'dedupe_window', category: 'Organization', title: 'Close Duplicate Tabs', aliases: ['dedupe', 'duplicates', 'clean'] },
    { type: 'action', id: 'gather_standalone', category: 'Organization', title: 'Gather Standalone Tabs', aliases: ['extract', 'pull'] },
    { type: 'action', id: 'consolidate_domain', category: 'Organization', title: 'Consolidate Domain', aliases: ['merge', 'same site'] },
    { type: 'action', id: 'extract_group', category: 'Organization', title: 'Extract Group to Window', aliases: ['move group', 'pop out'] },
    { type: 'action', id: 'stash_workspace', category: 'Organization', title: 'Stash Workspace', aliases: ['save', 'hide', 'store'] },
    
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
    { type: 'action', id: 'toggle_group', category: 'Organization', title: 'Toggle Group', aliases: ['group', 'ungroup', 'cluster'] },
    { type: 'action', id: 'duplicate_tab', category: 'Organization', title: 'Duplicate Tab', aliases: ['clone', 'copy tab'] },
    { type: 'action', id: 'copy_md_link', category: 'Productivity', title: 'Copy Markdown Link', aliases: ['markdown', 'url', 'copy link'] },
    { type: 'action', id: 'new_incognito', category: 'Window', title: 'New Incognito Window', aliases: ['private', 'secret', 'incognito'] },
    
    { type: 'action', id: 'update_baseline', category: 'Control', title: 'Update Pinned URL', aliases: ['reset url', 'change baseline', 'set url'] },
    { type: 'action', id: 'split_view', category: 'Window', title: 'Split View (Side-by-Side)', aliases: ['split', 'half', 'tile', 'side by side'] },
    { type: 'action', id: 'hard_reload', category: 'Control', title: 'Hard Reload', aliases: ['refresh', 'f5', 'cache', 'bypass'] },
    { type: 'action', id: 'close_other_tabs', category: 'Organization', title: 'Close Other Tabs', aliases: ['close rest', 'keep only this', 'isolate'] },
    { type: 'action', id: 'toggle_mute', category: 'Control', title: 'Toggle Mute', aliases: ['mute', 'unmute', 'silence', 'tab audio'] },
    
    { type: 'action', id: 'open_downloads', category: 'System', title: 'Open Downloads', aliases: ['downloads', 'files', 'system'] },
    { type: 'action', id: 'open_extensions', category: 'System', title: 'Open Extensions', aliases: ['extensions', 'addons', 'plugins', 'system'] },
    { type: 'action', id: 'open_settings', category: 'System', title: 'Open Settings', aliases: ['settings', 'preferences', 'config', 'system'] },
    
    // --- Big 30 Deep Settings ---
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
            
            // ACTION ENGINE INTERCEPTOR
            if (query.startsWith('>')) {
                const actionQuery = query.substring(1).trim().toLowerCase();
                let filtered = EXTENSION_ACTIONS;
                if (actionQuery) {
                    filtered = filtered.filter(a => {
                        if (a.title.toLowerCase().includes(actionQuery)) return true;
                        if (a.category.toLowerCase().includes(actionQuery)) return true;
                        if (a.aliases && a.aliases.some(alias => alias.toLowerCase().includes(actionQuery))) return true;
                        return false;
                    });
                }
                sendResponse({ results: filtered.slice(0, 15) });
                return;
            }
            
            const pTabs = chrome.tabs.query({}).catch(() => []);
            const pHistory = (query && chrome.history) ? chrome.history.search({ text: query, maxResults: 10 }).catch(() => []) : Promise.resolve([]);
            const pBookmarks = (query && chrome.bookmarks) ? chrome.bookmarks.search({ query: query }).catch(() => []) : Promise.resolve([]);
            const pClosed = (!query && chrome.sessions) ? chrome.sessions.getRecentlyClosed({ maxResults: 7 }).catch(() => []) : Promise.resolve([]);
            
            // Google Suggest API
            const pSuggestions = (query) ? 
                Promise.race([
                    fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`)
                        .then(r => r.json())
                        .then(data => data[1] || []),
                    new Promise(resolve => setTimeout(() => resolve([]), 300))
                ]).catch(() => []) : 
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

                // 7. Session Vault Recovery Options
                if (sessionVault && sessionVault.length > 0) {
                    // Check if query matches "restore" or "session" or if no query
                    if (!query || "restore".includes(lowerQuery) || "session".includes(lowerQuery)) {
                        // Put it right at the top
                        results.unshift({
                            type: 'vault',
                            title: `Restore ${sessionVault.length} protected tab${sessionVault.length > 1 ? 's' : ''} from last session`,
                            url: 'virtual:restore-vault', // Magic indicator
                            icon: '🔄' // Or we can rely on ntp.js to render an icon based on type
                        });
                    }
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
                let groupMap = {};
                for (const data of windowsToRestore[winId]) {
                    const newTab = await chrome.tabs.create({
                        url: data.url,
                        pinned: data.pinned,
                        windowId: newWin.id,
                        active: false
                    });
                    if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                        let groupKey = `${data.groupTitle}-${data.groupColor}`;
                        if (!groupMap[groupKey]) {
                            let gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                            if (data.groupTitle !== undefined || data.groupColor !== undefined) {
                                await chrome.tabGroups.update(gid, { title: data.groupTitle || "", color: data.groupColor || "grey" });
                            }
                            groupMap[groupKey] = gid;
                        } else {
                            await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[groupKey] });
                        }
                    }
                    safeDiscard(newTab.id);
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
        if (request.url === 'virtual:restore-vault') {
            // It's the vault restore command from the palette
            ensureLoaded().then(async () => {
                if (!sessionVault || sessionVault.length === 0) {
                    sendResponse({ success: false });
                    return;
                }
                
                const windowsToRestore = {};
                sessionVault.forEach(tab => {
                    if (!windowsToRestore[tab.windowId]) windowsToRestore[tab.windowId] = [];
                    windowsToRestore[tab.windowId].push(tab);
                });
                
                for (const winId of Object.keys(windowsToRestore)) {
                    const newWin = await chrome.windows.create({ focused: true });
                    let groupMap = {};
                    for (const data of windowsToRestore[winId]) {
                        const newTab = await chrome.tabs.create({
                            url: data.url,
                            pinned: data.pinned,
                            windowId: newWin.id,
                            active: false
                        });
                        if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                            let groupKey = `${data.groupTitle}-${data.groupColor}`;
                            if (!groupMap[groupKey]) {
                                let gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                                if (data.groupTitle !== undefined || data.groupColor !== undefined) {
                                    await chrome.tabGroups.update(gid, { title: data.groupTitle || "", color: data.groupColor || "grey" });
                                }
                                groupMap[groupKey] = gid;
                            } else {
                                await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[groupKey] });
                        }
                    }
                    safeDiscard(newTab.id);
                }
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

        // ALWAYS New Tab as requested by user
        chrome.tabs.create({ url: request.url, active: true });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === "open-query") {
        const query = request.query || "";
        const lowerQuery = query.toLowerCase();
        const bangResult = resolveBang(query);
        const isUrl = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(lowerQuery) || lowerQuery.startsWith('localhost');

        let url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        if (bangResult) {
            url = bangResult.url;
        } else if (isUrl) {
            url = lowerQuery;
            if (!url.startsWith('http')) url = 'https://' + url;
        } else if (query.match(/^!\S+/)) {
            // unknown bang defaults to google
        }

        chrome.tabs.create({ url: url, active: true });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === "get-profiles") {
        ensureLoaded().then(() => {
            sendResponse({ profiles: storedProfiles });
        });
        return true;
    }

    if (request.action === "save-profile") {
        ensureLoaded().then(async () => {
             const tabs = await chrome.tabs.query({ windowId: request.windowId || chrome.windows.WINDOW_ID_CURRENT });
             const protectedTabs = [];
             
             for(let t of tabs) {
                 if (t.pinned || (t.groupId !== -1 && t.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1))) {
                     let tabData = { url: t.url, pinned: t.pinned, groupId: t.groupId !== -1 ? t.groupId : -1 };
                     if (t.groupId !== -1 && t.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                         try {
                              let g = await chrome.tabGroups.get(t.groupId);
                              tabData.groupTitle = g.title;
                              tabData.groupColor = g.color;
                          } catch (e) { }
                     }
                     protectedTabs.push(tabData);
                 }
             }
             
             storedProfiles[request.name] = protectedTabs;
             syncProfilesToStorage();
             sendResponse({ success: true, profiles: storedProfiles });
        });
        return true;
    }

    if (request.action === "launch-profile") {
        ensureLoaded().then(async () => {
             const profileTabs = storedProfiles[request.name];
             if (!profileTabs || profileTabs.length === 0) {
                 sendResponse({ success: false });
                 return;
             }
             
             const newWin = await chrome.windows.create({ focused: true });
             let groupMap = {}; 

             for (const data of profileTabs) {
                 const newTab = await chrome.tabs.create({
                     url: data.url,
                     pinned: data.pinned,
                     windowId: newWin.id,
                     active: false
                 });
                 
                 if (data.groupId !== -1) {
                     let groupKey = `${data.groupTitle}-${data.groupColor}`;
                     if (!groupMap[groupKey]) {
                         let gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                         await chrome.tabGroups.update(gid, { title: data.groupTitle || "", color: data.groupColor || "grey" });
                         groupMap[groupKey] = gid;
                     } else {
                         await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[groupKey] });
                     }
                 }
                 
                // Strict discard optimized for Chrome's tab scheduling
                if (!data.active) safeDiscard(newTab.id);
             }
             
             const allWinTabs = await chrome.tabs.query({ windowId: newWin.id });
             if (allWinTabs.length > profileTabs.length) {
                 chrome.tabs.remove(allWinTabs[0].id).catch(() => {});
             }
             
             sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "delete-profile") {
        ensureLoaded().then(() => {
            delete storedProfiles[request.name];
            syncProfilesToStorage();
            sendResponse({ success: true, profiles: storedProfiles });
        });
        return true;
    }

    if (request.action === "import-profiles") {
        ensureLoaded().then(() => {
            const imported = request.profiles;
            if (imported && typeof imported === 'object') {
                for (let key in imported) {
                    storedProfiles[key] = imported[key];
                }
                syncProfilesToStorage();
                sendResponse({ success: true, profiles: storedProfiles });
            } else {
                sendResponse({ success: false });
            }
        });
        return true;
    }

    if (request.action === 'check-peek-status') {
        const isPeek = sender.tab && sender.tab.windowId && peekWindows.has(sender.tab.windowId);
        sendResponse({ isPeek: !!isPeek });
        return true;
    }

    if (request.action === 'promote-peek') {
        if (!sender.tab) {
            sendResponse({ success: false });
            return true;
        }
        
        const sourceData = peekWindows.get(sender.tab.windowId);
        
        chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
            let targetWinId = null;
            if (sourceData && windows.some(w => w.id === sourceData.windowId)) {
                targetWinId = sourceData.windowId;
            } else {
                let backupWin = windows.find(w => !peekWindows.has(w.id));
                if (backupWin) targetWinId = backupWin.id;
            }
            
            if (targetWinId) {
                chrome.tabs.move(sender.tab.id, { windowId: targetWinId, index: -1 }, (movedTab) => {
                    chrome.tabs.update(movedTab.id, { active: true });
                    chrome.windows.update(targetWinId, { focused: true });
                });
            } else {
                chrome.windows.create({ tabId: sender.tab.id });
            }
        });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === "open-peek") {
        chrome.windows.getCurrent((currentWin) => {
             const w = currentWin.width || 1200;
             const h = currentWin.height || 800;
             const width = Math.round(w * 0.85);
             const height = Math.round(h * 0.9);
             const left = (currentWin.left || 0) + Math.round((w - width) / 2);
             const top = (currentWin.top || 0) + Math.round((h - height) / 2);
             
             chrome.windows.create({
                 url: request.url,
                 type: 'popup',
                 width: width,
                 height: height,
                 left: left,
                 top: top,
                 focused: true
             }, (newWin) => {
                 if (newWin) {
                     peekWindows.set(newWin.id, {
                         windowId: sender.tab ? sender.tab.windowId : currentWin.id,
                         groupId: sender.tab && sender.tab.groupId !== -1 ? sender.tab.groupId : null
                     });
                 }
             });
        });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'execute-browser-action') {
        ensureLoaded().then(async () => {
            try {
                switch(request.commandId) {
                    case 'magic_organize': {
                        const allT = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                        let domainMap = {};
                        for (let t of allT) {
                            if (t.pinned) continue;
                            try {
                                let domain = new URL(t.url).hostname.replace('www.', '');
                                if (!domainMap[domain]) domainMap[domain] = [];
                                domainMap[domain].push(t);
                            } catch(e) {}
                        }
                        for (let domain in domainMap) {
                            if (domainMap[domain].length > 1) {
                                let ids = domainMap[domain].map(t => t.id);
                                let gid = await chrome.tabs.group({ tabIds: ids });
                                await chrome.tabGroups.update(gid, { title: domain });
                            }
                        }
                        break;
                    }
                    case 'ungroup_all': {
                        const utabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                        for (let t of utabs) {
                            if (t.groupId !== -1 && t.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                                chrome.tabs.ungroup(t.id).catch(()=>{});
                            }
                        }
                        break;
                    }
                    case 'dedupe_window': {
                        const dtabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                        let seenUrls = new Set();
                        let toClose = [];
                        for (let t of dtabs) {
                            if (!t.url) continue;
                            let cleanUrl = t.url.split('#')[0];
                            if (seenUrls.has(cleanUrl)) {
                                if (!t.active) toClose.push(t.id);
                            } else seenUrls.add(cleanUrl);
                        }
                        if (toClose.length > 0) chrome.tabs.remove(toClose).catch(()=>{});
                        break;
                    }
                    case 'gather_standalone': {
                        const stabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT, pinned: false });
                        let standaloneIds = stabs.filter(t => (t.groupId === -1 || t.groupId === (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) && !t.active).map(t => t.id);
                        if (standaloneIds.length > 0) {
                            chrome.windows.create({ tabId: standaloneIds[0] }, (w) => {
                                if (standaloneIds.length > 1) {
                                    chrome.tabs.move(standaloneIds.slice(1), { windowId: w.id, index: -1 });
                                }
                            });
                        }
                        break;
                    }
                    case 'consolidate_domain': {
                        const activeArray = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (activeArray.length) {
                            try {
                                let d = new URL(activeArray[0].url).hostname.replace('www.', '');
                                const allWindowsTabs = await chrome.tabs.query({});
                                let matchingIds = allWindowsTabs.filter(t => t.url && t.url.includes(d) && t.windowId !== chrome.windows.WINDOW_ID_CURRENT).map(t => t.id);
                                if (matchingIds.length > 0) {
                                    chrome.tabs.move(matchingIds, { windowId: chrome.windows.WINDOW_ID_CURRENT, index: -1 });
                                }
                            } catch(e) {}
                        }
                        break;
                    }
                    case 'extract_group': {
                        const extractTabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (extractTabs.length && extractTabs[0].groupId !== -1 && extractTabs[0].groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                            const gtabs = await chrome.tabs.query({ groupId: extractTabs[0].groupId });
                            let gIds = gtabs.map(t => t.id);
                            if (gIds.length > 0) {
                                chrome.windows.create({ tabId: gIds[0] }, (w) => {
                                    if (gIds.length > 1) {
                                        chrome.tabs.move(gIds.slice(1), { windowId: w.id, index: -1 });
                                    }
                                });
                            }
                        }
                        break;
                    }
                    case 'stash_workspace': {
                        const stashTabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                        const protectedStash = [];
                        for(let t of stashTabs) {
                             let tabData = { url: t.url, pinned: t.pinned, groupId: t.groupId !== -1 ? t.groupId : -1 };
                             if (t.groupId !== -1 && chrome.tabGroups) {
                                 try {
                                      let g = await chrome.tabGroups.get(t.groupId);
                                      tabData.groupTitle = g.title; 
                                      tabData.groupColor = g.color;
                                  } catch (e) { }
                             }
                             protectedStash.push(tabData);
                        }
                        const name = "Stash_" + new Date().toLocaleTimeString();
                        storedProfiles[name] = protectedStash;
                        syncProfilesToStorage();
                        chrome.windows.remove(chrome.windows.WINDOW_ID_CURRENT).catch(()=>{});
                        break;
                    }
                    case 'hibernate_all': {
                        const hatabs = await chrome.tabs.query({ active: false });
                        for (let t of hatabs) {
                            if (!t.discarded) chrome.tabs.discard(t.id).catch(()=>{});
                        }
                        break;
                    }
                    case 'hibernate_window': {
                        const hwtabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT, active: false });
                        for (let t of hwtabs) {
                            if (!t.discarded) chrome.tabs.discard(t.id).catch(()=>{});
                        }
                        break;
                    }
                    case 'pause_media': {
                        const pmtabs = await chrome.tabs.query({});
                        for (let t of pmtabs) {
                            if (t.url && (t.url.startsWith('chrome://') || t.url.startsWith('edge://') || t.url.startsWith('chrome-extension://'))) continue;
                            chrome.scripting.executeScript({
                                target: { tabId: t.id },
                                func: () => {
                                    document.querySelectorAll('video, audio').forEach(m => m.pause());
                                }
                            }).catch(()=>{});
                        }
                        break;
                    }
                    case 'mute_background': {
                        const mbtabs = await chrome.tabs.query({ active: false });
                        for (let t of mbtabs) {
                            chrome.tabs.update(t.id, { muted: true }).catch(()=>{});
                        }
                        break;
                    }
                    case 'zen_fullscreen': {
                        chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'fullscreen' }).catch(()=>{});
                        break;
                    }
                    case 'snapshot_session': {
                        syncBaselinesToStorage();
                        saveSnapshot();
                        break;
                    }
                    case 'clear_cache_hour': {
                        if (chrome.browsingData) {
                            const hourAgo = new Date().getTime() - (1000 * 60 * 60);
                            chrome.browsingData.remove({ since: hourAgo }, { appcache: true, cache: true, cacheStorage: true, cookies: true, downloads: true, fileSystems: true, formData: true, history: true, indexedDB: true, localStorage: true, pluginData: true, passwords: true, webSQL: true });
                        }
                        break;
                    }
                    case 'clear_unprotected': {
                        const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                        const toClose = tabs.filter(t => !t.pinned && (t.groupId === -1 || (chrome.tabGroups && t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE))).map(t => t.id);
                        if (toClose.length > 0) chrome.tabs.remove(toClose).catch(()=>{});
                        break;
                    }
                    case 'toggle_pin': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) chrome.tabs.update(tabs[0].id, { pinned: !tabs[0].pinned }).catch(()=>{});
                        break;
                    }
                    case 'duplicate_tab': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            try {
                                await chrome.tabs.duplicate(tabs[0].id);
                            } catch(e) {
                                chrome.tabs.create({ url: tabs[0].url }).catch(()=>{});
                            }
                        }
                        break;
                    }
                    case 'copy_md_link': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            const t = tabs[0];
                            const mdLink = `[${t.title}](${t.url})`;
                            chrome.scripting.executeScript({
                                target: { tabId: t.id },
                                func: (text) => navigator.clipboard.writeText(text),
                                args: [mdLink]
                            }).catch(()=>{});
                        }
                        break;
                    }
                    case 'new_incognito': {
                        chrome.windows.create({ incognito: true }).catch(()=>{});
                        break;
                    }
                    case 'update_baseline': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            const data = memoryBaselines.get(tabs[0].id);
                            if (data) {
                                data.url = tabs[0].url;
                                syncBaselinesToStorage();
                            }
                        }
                        break;
                    }
                    case 'toggle_group': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            const t = tabs[0];
                            if (t.groupId !== -1 && (chrome.tabGroups && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)) {
                                chrome.tabs.ungroup(t.id).catch(()=>{});
                            } else {
                                chrome.tabs.group({ tabIds: [t.id] }).catch(()=>{});
                            }
                        }
                        break;
                    }
                    case 'split_view': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            const t = tabs[0];
                            if (t.pinned) chrome.tabs.update(t.id, { pinned: false }).catch(()=>{});
                            if (chrome.tabGroups && t.groupId !== -1 && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                                chrome.tabs.ungroup(t.id).catch(()=>{});
                            }

                            chrome.windows.getCurrent(async (win) => {
                                const w = Math.floor(win.width / 2);
                                const h = win.height;
                                const targetLeft = win.left + w;
                                
                                await chrome.windows.update(win.id, { width: w, left: win.left, state: 'normal' }).catch(()=>{});
                                chrome.windows.create({ 
                                    tabId: t.id, 
                                    left: targetLeft, 
                                    width: w, 
                                    height: h,
                                    top: win.top
                                }).catch(()=>{});
                            });
                        }
                        break;
                    }
                    case 'hard_reload': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) chrome.tabs.reload(tabs[0].id, { bypassCache: true }).catch(()=>{});
                        break;
                    }
                    case 'close_other_tabs': {
                        const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
                        const activeTabs = tabs.filter(t => t.active);
                        if (activeTabs.length > 0) {
                            const activeId = activeTabs[0].id;
                            const toClose = tabs.filter(t => t.id !== activeId).map(t => t.id);
                            if (toClose.length > 0) chrome.tabs.remove(toClose).catch(()=>{});
                        }
                        break;
                    }
                    case 'toggle_mute': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            const isMuted = tabs[0].mutedInfo && tabs[0].mutedInfo.muted;
                            chrome.tabs.update(tabs[0].id, { muted: !isMuted }).catch(()=>{});
                        }
                        break;
                    }
                    case 'open_downloads': {
                        chrome.tabs.create({ url: 'chrome://downloads/' }).catch(()=>{});
                        break;
                    }
                    case 'open_extensions': {
                        chrome.tabs.create({ url: 'chrome://extensions/' }).catch(()=>{});
                        break;
                    }
                    case 'open_settings': {
                        chrome.tabs.create({ url: 'chrome://settings/' }).catch(()=>{});
                        break;
                    }
                    // --- Big 30 Deep Settings Handlers ---
                    case 'set_gpu': chrome.tabs.create({ url: 'chrome://settings/system' }); break;
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
                    case 'set_flags': chrome.tabs.create({ url: 'chrome://flags' }); break;
                    case 'set_reset': chrome.tabs.create({ url: 'chrome://settings/reset' }); break;
                    case 'set_help': chrome.tabs.create({ url: 'chrome://settings/help' }); break;
                    case 'set_sync': chrome.tabs.create({ url: 'chrome://settings/people' }); break;
                    case 'set_startup': chrome.tabs.create({ url: 'chrome://settings/onStartup' }); break;
                    case 'set_extensions': chrome.tabs.create({ url: 'chrome://extensions' }); break;
                    case 'hibernate_pinned': {
                        const tabs = await chrome.tabs.query({ pinned: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        tabs.forEach(t => {
                            if (!t.active && !t.discarded) chrome.tabs.discard(t.id).catch(()=>{});
                        });
                        break;
                    }
                    case 'hibernate_current': {
                        const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                        if (tabs.length > 0) {
                            // Note: Chrome may ignore discard for the active tab, but we can try
                            chrome.tabs.discard(tabs[0].id).catch(()=>{});
                        }
                        break;
                    }
                }
            } catch (e) {
                console.error("Action error:", e);
            }
            sendResponse({ success: true });
        });
        return true;
    }
});
