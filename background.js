// ==========================================================================
// --- GLOBAL STATE & CONFIGURATION ---
// ==========================================================================
let memoryBaselines = new Map(); // tabId -> { url, index, windowId, pinned, groupId }
let globalSettings = { protectPinned: true, protectGrouped: true, enablePalette: true, enableAutoGroup: false, focusNTPOnClose: false };
let lastActiveTabId = null;
let isInitialized = false;
let sessionVault = [];
let lastSession = []; // To store the safety snapshot
let tabSets = {};
let groupCache = new Map(); // groupId -> { title, color }
let peekWindows = new Map(); // Map of active Peek windowIds -> { windowId, groupId }
let evictionGraveyard = new Map(); // tabId -> { data, timeoutIndex }
let recreationRegistry = new Map(); // windowId|title -> Promise<groupId> 
let groupClosureTracker = new Map(); // groupId -> { closedIds: Set, baselineCount: number }
let windowBatchTracker = new Map(); // windowId -> { count: number, timestamp: number }
let closingWindowIds = new Set(); // windowIds already bulk-saved to vault on shutdown

const NTP_EXTENSION_URL = chrome.runtime.getURL('ntp.html');

const GROUPING_RULES = [
    { title: 'Dev', color: 'blue', domains: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'aws.amazon.com', 'console.cloud.google.com', 'vercel.com', 'netlify.com', 'docker.com', 'cloudflare.com', 'jira.com', 'atlassian.net', 'linear.app', 'developer.mozilla.org', 'npmjs.com', 'codepen.io', 'replit.com', 'codesandbox.io', 'postman.com', 'sentry.io', 'datadoghq.com', 'cursor.sh', 'cursor.com', 'warp.dev', 'bun.sh', 'railway.app', 'supabase.com', 'huggingface.co', 'leetcode.com', 'geeksforgeeks.org', 'pypi.org', 'hub.docker.com', 'crates.io', 'search.maven.org'] },
    { title: 'Design', color: 'purple', domains: ['figma.com', 'canva.com', 'dribbble.com', 'behance.net', 'miro.com', 'framer.com', 'spline.design', 'adobe.com', 'awwwards.com', 'lottiefiles.com', 'unsplash.com', 'pexels.com', 'colorhunt.co', 'sketch.com', 'invisionapp.com', 'principleformac.com', 'zeplin.io', 'affinity.serif.com', 'coreldraw.com', 'muz.li', 'land-book.com', 'siteinspire.com', 'fontshare.com', 'fonts.google.com', 'coolors.co', 'iconify.design', 'flaticon.com', 'readymag.com', 'typedream.com', 'poly.cam', 'sketchfab.com'] },
    { title: 'AI', color: 'green', domains: ['chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'grok.com', 'deepseek.com', 'poe.com', 'midjourney.com', 'leonardo.ai', 'runwayml.com', 'pika.art', 'suno.com', 'udio.com', 'elevenlabs.io', 'zapier.com', 'make.com', 'gamma.app', 'notebooklm.google.com', 'consensus.app', 'phind.com'] },
    { title: 'Media', color: 'red', domains: ['youtube.com', 'netflix.com', 'spotify.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'vimeo.com', 'soundcloud.com', 'music.apple.com', 'plex.tv', 'crunchyroll.com', 'paramountplus.com', 'peacocktv.com', 'mubi.com', 'nebula.tv', 'curiositystream.com', 'steampowered.com', 'epicgames.com', 'ign.com', 'gamespot.com', 'roblox.com', 'letterboxd.com', 'pocketcasts.com', 'mixcloud.com', 'bandcamp.com', 'tidal.com', 'audible.com'] },
    { title: 'News', color: 'yellow', domains: ['nytimes.com', 'bbc.com', 'news.google.com', 'theverge.com', 'techcrunch.com', 'wsj.com', 'news.ycombinator.com', 'bloomberg.com', 'cnn.com', 'reuters.com', 'theguardian.com', 'hbr.org', 'wired.com', 'arstechnica.com', 'apnews.com', 'aljazeera.com', 'fortune.com', 'forbes.com', 'qz.com', 'mashable.com', 'engadget.com', 'gizmodo.com', 'medium.com', 'substack.com', 'ted.com', 'wikipedia.org', 'marketwatch.com', 'investopedia.com', 'finance.yahoo.com', 'seekingalpha.com'] },
    { title: 'Social', color: 'cyan', domains: ['x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'discord.com', 'web.whatsapp.com', 'messenger.com', 'tumblr.com', 'threads.net', 'bsky.app', 'polywork.com', 'slack.com', 'mastodon.social', 'fark.com', 'quora.com', 'nextdoor.com', 'wechat.com', 'telegram.org', 'vk.com', 'line.me', 'lemon8-app.com'] }
];

// ==========================================================================
// --- CORE SURVIVAL LOGIC ---
// ==========================================================================

chrome.windows.onRemoved.addListener(async (windowId) => {
    peekWindows.delete(windowId);
    windowBatchTracker.delete(windowId);
    closingWindowIds.delete(windowId);

    // Force-snapshot when the LAST normal window closes so baselines survive
    // a hard-close (Alt+F4, kill) where the debounce never gets to fire.
    try {
        const remaining = await chrome.windows.getAll({ windowTypes: ['normal'] });
        if (remaining.length === 0) {
            syncBaselinesToStorage(true); // bypass debounce
            saveSnapshot();
        }
    } catch (e) {}
});

// Sync Vault Storage
function syncVaultToStorage() {
    chrome.storage.local.set({ vault: sessionVault });
}

// Sync Sets Storage
function syncSetsToStorage() {
    chrome.storage.local.set({ tabSets: tabSets });
}

// Debounced Storage Sync
let syncTimeout = null;
function syncBaselinesToStorage(force = false) {
    if (force) {
        // Bypass debounce — used when restoring tabs to ensure persistence
        // before the service worker can be suspended and memory cleared.
        if (syncTimeout) clearTimeout(syncTimeout);
        const obj = Object.fromEntries(memoryBaselines);
        chrome.storage.local.set({ baselines: obj });
        saveSnapshot();
        return;
    }
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
        loadPromise = chrome.storage.local.get(['baselines', 'settings', 'vault', 'lastSession', 'profiles', 'tabSets']).then((data) => {
            if (data.settings) globalSettings = { ...globalSettings, ...data.settings };
            sessionVault = data.vault || [];
            lastSession = data.lastSession || [];
            
            // Migration: Profiles to Sets
            tabSets = data.tabSets || {};
            if (data.profiles && Object.keys(data.profiles).length > 0) {
                for (const [key, value] of Object.entries(data.profiles)) {
                    if (!tabSets[key]) {
                        tabSets[key] = { type: 'workspace', tabs: value };
                    }
                }
                chrome.storage.local.set({ tabSets: tabSets });
                chrome.storage.local.remove('profiles');
            }

            
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


// ==========================================================================
// --- TAB STATE MANAGEMENT ---
// ==========================================================================
function processTab(tab) {
    if (peekWindows.has(tab.windowId)) return false; // Never protect tabs in Peak windows

    const url = tab.url || tab.pendingUrl;

    // Never protect our own NTP page — it's a transient focus-landing page, not content
    if (url && url.startsWith(NTP_EXTENSION_URL)) return false;

    let isProtected = false;
    if (globalSettings.protectPinned && tab.pinned) isProtected = true;
    if (globalSettings.protectGrouped && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) isProtected = true;
    // Notify the content script so it can intercept links
    try {
        if (url && !url.startsWith('chrome')) {
            chrome.tabs.sendMessage(tab.id, { action: 'update-tab-status', isProtected: isProtected }).catch(() => {});
        }
    } catch (e) {}

    let changed = false;

    if (isProtected) {
        // For discarded tabs, url may be temporarily empty — fall back to existing baseline url
        const existing = memoryBaselines.get(tab.id);
        const effectiveUrl = url || (existing && existing.url);
        
        if (!effectiveUrl || effectiveUrl.startsWith('chrome')) {
            return false; // Nothing useful to do without a URL
        }

        let groupTitle, groupColor;
        if (tab.groupId !== -1 && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1) && groupCache.has(tab.groupId)) {
            const g = groupCache.get(tab.groupId);
            groupTitle = g.title;
            groupColor = g.color;
        } else if (existing && existing.groupId === tab.groupId) {
            // Preserve group metadata from baseline if group not yet in cache
            groupTitle = existing.groupTitle;
            groupColor = existing.groupColor;
        }

        if (!existing) {
            memoryBaselines.set(tab.id, {
                url: effectiveUrl,
                index: tab.index,
                windowId: tab.windowId,
                pinned: tab.pinned,
                groupId: tab.groupId,
                groupTitle: groupTitle,
                groupColor: groupColor
            });
            changed = true;
        } else {
            // Update positional/state metadata; never overwrite url or _restoredAt
            if (existing.index !== tab.index || existing.windowId !== tab.windowId || existing.pinned !== tab.pinned || existing.groupId !== tab.groupId || (groupTitle && existing.groupTitle !== groupTitle) || (groupColor && existing.groupColor !== groupColor)) {
                existing.index = tab.index;
                existing.windowId = tab.windowId;
                existing.pinned = tab.pinned;
                existing.groupId = tab.groupId;
                if (groupTitle) existing.groupTitle = groupTitle;
                if (groupColor) existing.groupColor = groupColor;
                changed = true;
            }
        }
    } else if (memoryBaselines.has(tab.id)) {
        const entry = memoryBaselines.get(tab.id);

        // CRITICAL: Never evict a discarded (hibernated) tab.
        // Chrome can fire onUpdated({groupId:-1}) as a side-effect of the discard process
        // itself — this does NOT mean the user ungrouped it. We distinguish this from
        // deliberate ungroup (which only happens on a non-discarded, active tab).
        if (tab.discarded) return false;

        // _restoredAt is ONLY set during restoration, never refreshed.
        // Protects freshly restored tabs while grouping is settling (2s window).
        const restoredAge = entry._restoredAt ? (Date.now() - entry._restoredAt) : Infinity;

        if (restoredAge > 2000) {
            // Grouping/Unpinning Detection:
            // Chrome fires onUpdated({groupId: -1}) millseconds before onRemoved.
            // If we evict immediately, onRemoved loses the group context and restores ungrouped.
            // SOLUTION: Delay the eviction. If onRemoved fires in next 500ms, it wins.
            if (entry._pendingEviction) return false;

            entry._pendingEviction = true;
            setTimeout(() => {
                // Double check if tab still exists and is still unprotected
                chrome.tabs.get(tab.id, (currentTab) => {
                    if (chrome.runtime.lastError || !currentTab) {
                        // Tab was removed (expected), onRemoved handled it using the baseline.
                        return;
                    }
                    
                    const matchesRestored = memoryBaselines.get(tab.id);
                    if (!matchesRestored || !matchesRestored._pendingEviction) return;

                    const stillUnprotected = !currentTab.pinned && currentTab.groupId === (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1);
                    
                    if (stillUnprotected) {

                        const evictedData = { ...matchesRestored };
                        delete evictedData._pendingEviction;
                        
                        memoryBaselines.delete(tab.id);

                        // Graveyard fallback (just in case)
                        if (evictionGraveyard.has(tab.id)) clearTimeout(evictionGraveyard.get(tab.id).timeout);
                        const tId = setTimeout(() => evictionGraveyard.delete(tab.id), 1000);
                        evictionGraveyard.set(tab.id, { data: evictedData, timeout: tId });
                        
                        syncBaselinesToStorage();
                    } else {
                        delete matchesRestored._pendingEviction;
                    }
                });
            }, 500);
        }
    }
    
    return changed;
}

// ==========================================================================
// --- CORE EVENT HANDLERS ---
// ==========================================================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url !== '' && !changeInfo.url.startsWith('chrome')) {
        // Vault Auto-Heal: Catch native session restore dropping groups
        const vIndex = sessionVault.findIndex(v => v.url === changeInfo.url);
        if (vIndex !== -1) {
            const vData = sessionVault.splice(vIndex, 1)[0];
            syncVaultToStorage();
            
            // Re-apply missing group metadata injected natively by Chromium
            if (!tab.pinned && vData.groupId !== -1 && vData.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                try {
                    let existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId, title: vData.groupTitle });
                    if (existingGroups.length > 0) {
                        await chrome.tabs.group({ tabIds: [tabId], groupId: existingGroups[0].id });
                    } else {
                        let gid = await chrome.tabs.group({ tabIds: [tabId] });
                        await chrome.tabGroups.update(gid, { title: vData.groupTitle || '', color: vData.groupColor || 'grey' });
                    }
                } catch(e) {}
            }
        } else {
            removeFromVault(changeInfo.url);
        }
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

// Group inheritance is permitted natively. 

async function applyAutoGrouping(tab, retryCount = 0) {
    if (!tab.url) return;
    
    // Grouping is only supported in 'normal' browser windows
    try {
        const win = await chrome.windows.get(tab.windowId);
        if (win.type !== 'normal') return;
    } catch (e) { return; }

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
        const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: matchedRule.title });
        let groupIdToUse = (groups && groups.length > 0) ? groups[0].id : null;

        if (groupIdToUse !== null) {
            await chrome.tabs.group({ tabIds: tab.id, groupId: groupIdToUse });
        } else {
            groupIdToUse = await chrome.tabs.group({ tabIds: tab.id });
            await chrome.tabGroups.update(groupIdToUse, { title: matchedRule.title, color: matchedRule.color });
        }
    } catch (e) {
        const msg = e.message || "";
        if (msg.includes("dragging") || msg.includes("edited right now")) {
            // User is interacting. Retry with backoff.
            if (retryCount < 3) {
                setTimeout(() => {
                    chrome.tabs.get(tab.id, (t) => {
                        if (t) applyAutoGrouping(t, retryCount + 1);
                    });
                }, 400);
            }
        } else if (msg.includes("Grouping is not supported")) {
            // Expected for some windows, fail silently
        } else {
            console.error("Auto-grouping failed", e);
        }
    }
}


chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    chrome.tabs.get(tabId, (tab) => {
        if (tab && processTab(tab)) syncBaselinesToStorage();
    });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    lastActiveTabId = activeInfo.tabId;
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
    // Window Batch Closure Tracking (runs synchronously)
    const now = Date.now();
    let batchTracker = windowBatchTracker.get(removeInfo.windowId);
    if (!batchTracker || now - batchTracker.timestamp > 150) {
        batchTracker = { count: 0, timestamp: now };
        windowBatchTracker.set(removeInfo.windowId, batchTracker);
    }
    batchTracker.count++;

    // Focus Guard: If active tab is closed, redirect focus to NTP — reuse existing if present
    if (globalSettings.focusNTPOnClose && tabId === lastActiveTabId && !removeInfo.isWindowClosing) {
        (async () => {
            try {
                const ntpUrl = NTP_EXTENSION_URL;
                const windowTabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
                const existingNtp = windowTabs.find(t => t.url && t.url.startsWith(ntpUrl));

                if (existingNtp) {
                    // Already exists — just focus it
                    chrome.tabs.update(existingNtp.id, { active: true }).catch(() => {});
                } else {
                    // Create standalone at end of strip (high index prevents group inheritance)
                    const created = await chrome.tabs.create({
                        url: ntpUrl,
                        active: true,
                        windowId: removeInfo.windowId,
                        index: 9999
                    });
                    // Force standalone status
                    if (created.groupId !== undefined && created.groupId !== -1 && 
                        chrome.tabGroups && created.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                        chrome.tabs.ungroup([created.id]).catch(() => {});
                    }
                }
            } catch (e) {}
        })();
    }

    await ensureLoaded();

    // O(1) Memory lookup (check active baselines, then fallback to graveyard for race conditions)
    let data = memoryBaselines.get(tabId);
    
    if (!data && evictionGraveyard.has(tabId)) {
        data = evictionGraveyard.get(tabId).data;
        clearTimeout(evictionGraveyard.get(tabId).timeout);
        evictionGraveyard.delete(tabId);
    }
    
    // Group Explicit Deletion Detection
    if (data && data.url && data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
        let tracker = groupClosureTracker.get(data.groupId);
        if (!tracker) {
            let baselineCount = 0;
            for (const b of memoryBaselines.values()) {
                if (b.groupId === data.groupId) baselineCount++;
            }
            tracker = { closedIds: new Set(), baselineCount };
            groupClosureTracker.set(data.groupId, tracker);
            setTimeout(() => groupClosureTracker.delete(data.groupId), 250);
        }
        tracker.closedIds.add(tabId);
    }

    // Check if entire window is being closed
    if (removeInfo.isWindowClosing) {
        // Bulk-dump the ENTIRE window's baselines on the FIRST tab seen from this window.
        // Per-tab push is a race: the SW can die mid-loop leaving a partial vault.
        // One atomic write is safe and complete.
        if (!closingWindowIds.has(removeInfo.windowId)) {
            closingWindowIds.add(removeInfo.windowId);
            const windowBaselines = Array.from(memoryBaselines.values())
                .filter(d => d.windowId === removeInfo.windowId && d.url);
            for (const d of windowBaselines) {
                if (!sessionVault.some(t => t.url === d.url && t.windowId === d.windowId)) {
                    sessionVault.push(d);
                }
            }
            if (windowBaselines.length > 0) syncVaultToStorage();
        }
        return;
    }

    if (data && data.url) {
        // Evict immediately to prevent race conditions during restore loop
        memoryBaselines.delete(tabId);
        syncBaselinesToStorage();

        // Fire-and-forget restoration chain (unblocks main thread instantly), debounced slightly
        setTimeout(() => {
            // Check for Batch Close Bypass (e.g. "Close Other Tabs" or Multi-Select Close)
            let batchTracker = windowBatchTracker.get(removeInfo.windowId);
            if (batchTracker && batchTracker.count > 1) {
                // USER ISSUED A BATCH CLOSE COMMAND
                if (!sessionVault.some(t => t.url === data.url && t.groupId === data.groupId)) {
                    sessionVault.push(data);
                    syncVaultToStorage();
                }
                return; // Abort restore entirely!
            }

            // Re-check group closure intent BEFORE restoring
            if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                let tracker = groupClosureTracker.get(data.groupId);
                if (tracker && tracker.closedIds.size >= tracker.baselineCount) {
                    // USER DELIBERATELY DELETED/CLOSED THE ENTIRE GROUP!
                    // Do NOT revive. Instead, just save to vault.
                    if (!sessionVault.some(t => t.url === data.url && t.groupId === data.groupId)) {
                        sessionVault.push(data);
                        syncVaultToStorage();
                    }
                    return; // Abort restore entirely!
                }
            }

            (async () => {
            try {
                // SMART RE-USE: If Chrome already created a blank new tab (standard behavior
                // when closing tabs), we hijack it instead of creating a second "ghost" tab.
                // Also recognise our own NTP page as a hijackable blank (Focus Guard may have placed it).
                // NOTE: We query all tabs then filter manually for NTP — chrome-extension match patterns
                //       can be unreliable in tabs.query.
                const allWindowTabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
                
                // If Focus Guard is active, we SKIP hijacking to preserve the standalone NTP 
                // and restore the site to its original index via a fresh tab.
                const potentialBlankTabs = globalSettings.focusNTPOnClose ? [] : allWindowTabs.filter(t => {
                    const u = t.url || '';
                    return u === 'chrome://newtab/' ||
                           u === 'chrome-search://local-ntp/local-ntp.html' ||
                           u === 'about:blank' ||
                           u.startsWith(NTP_EXTENSION_URL);
                });
                
                const remainingTabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
                const windowWillBeEmpty = remainingTabs.length === 0;

                let newTab;
                if (potentialBlankTabs.length > 0) {
                    newTab = await chrome.tabs.update(potentialBlankTabs[0].id, {
                        url: data.url,
                        pinned: data.pinned,
                        active: true 
                    });
                } else {
                    newTab = await chrome.tabs.create({
                        url: data.url,
                        pinned: data.pinned,
                        index: data.index >= 0 ? data.index : undefined,
                        windowId: data.windowId,
                        active: windowWillBeEmpty // Focus Guard NTP usually means this is false
                    });
                }
                
                // Immediate recreation (no delay to prevent race conditions)
                try {
                    
                    // === CRITICAL: Force-register BEFORE any other async operation ===
                    memoryBaselines.set(newTab.id, {
                        url: data.url,
                        index: newTab.index,
                        windowId: newTab.windowId,
                        pinned: data.pinned,
                        groupId: data.groupId,
                        groupTitle: data.groupTitle,
                        groupColor: data.groupColor,
                        _restoredAt: Date.now()
                    });
                    syncBaselinesToStorage(true); // Force immediate write — service worker may suspend before debounce fires


                    // Grouping is handled after registration to ensure safety
                    if (data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                        const groupKey = `${newTab.windowId}|${data.groupTitle || ''}`;
                        
                        if (recreationRegistry.has(groupKey)) {
                            // Join the recreation already in progress
                            try {
                                const targetGid = await recreationRegistry.get(groupKey);
                                await chrome.tabs.group({ tabIds: [newTab.id], groupId: targetGid });
                                const entry = memoryBaselines.get(newTab.id);
                                if (entry) { entry.groupId = targetGid; syncBaselinesToStorage(); }
                            } catch (e) {
                                // If joining failed, the group might have been invalid, allow retry
                                recreationRegistry.delete(groupKey);
                                const entry = memoryBaselines.get(newTab.id);
                                if (entry) { entry.groupId = -1; syncBaselinesToStorage(); }
                            }
                        } else {
                            // We are the leader for this group name in this window
                            const recreationPromise = (async () => {
                                try {
                                    // 1. Try original ID (unlikely to work if group was closed)
                                    try {
                                        await chrome.tabs.group({ tabIds: [newTab.id], groupId: data.groupId });
                                        return data.groupId;
                                    } catch {
                                        // 2. Search for existing match that might have been created by previous restoration cycle
                                        if (data.groupTitle) {
                                            const existingGroups = await chrome.tabGroups.query({ 
                                                windowId: newTab.windowId, 
                                                title: data.groupTitle 
                                            });
                                            if (existingGroups.length > 0) {
                                                const gid = existingGroups[0].id;
                                                await chrome.tabs.group({ tabIds: [newTab.id], groupId: gid });
                                                return gid;
                                            }
                                        }

                                        // 3. Recreate fresh
                                        const newGid = await chrome.tabs.group({ tabIds: [newTab.id] });
                                        await chrome.tabGroups.update(newGid, {
                                            title: data.groupTitle || '',
                                            color: data.groupColor || 'grey'
                                        });
                                        return newGid;
                                    }
                                } catch (e) {
                                    throw e;
                                }
                            })();

                            recreationRegistry.set(groupKey, recreationPromise);
                            
                            // Clear lock after 5s to allow for future manual closures/restores
                            setTimeout(() => {
                                if (recreationRegistry.get(groupKey) === recreationPromise) {
                                    recreationRegistry.delete(groupKey);
                                }
                            }, 5000);

                            try {
                                const finalGid = await recreationPromise;
                                const entry = memoryBaselines.get(newTab.id);
                                if (entry) { entry.groupId = finalGid; syncBaselinesToStorage(); }
                            } catch (e) {
                                console.error("Group synchronized recreation failed", e);
                                const entry = memoryBaselines.get(newTab.id);
                                if (entry) { entry.groupId = -1; syncBaselinesToStorage(); }
                            }
                        }
                    }



                    // Hibernate only after all structural changes are done
                    safeDiscard(newTab.id);
                } catch (e) {
                    console.error("Tab creation failed:", e);
                    // Ultimate Safety Net: If strict attributes failed, force generic tab creation
                    chrome.tabs.create({ url: data.url, pinned: data.pinned, active: false }).catch(() => {});
                }

            } catch (e) {
                console.error("Restore logic failed:", e);
                chrome.tabs.create({ url: data.url, pinned: data.pinned });
            }
        })();
        }, 100);
    }
});

// Chrome can secretly CHANGE a tab's ID when it discards/hibernates it! 
// We MUST migrate our tracking data to the new ID, otherwise the next time 
// the user clicks or closes the tab, we won't recognize it.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    let data = memoryBaselines.get(removedTabId);
    if (data) {

        memoryBaselines.set(addedTabId, data);
        memoryBaselines.delete(removedTabId);
        syncBaselinesToStorage();
    }
    
    // Also migrate graveyard just in case
    if (evictionGraveyard.has(removedTabId)) {
        evictionGraveyard.set(addedTabId, evictionGraveyard.get(removedTabId));
        evictionGraveyard.delete(removedTabId);
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

// Last-resort flush: fires when Chrome is about to kill the service worker
// (complements windows.onRemoved which handles clean window-close path)
chrome.runtime.onSuspend.addListener(() => {
    const obj = Object.fromEntries(memoryBaselines);
    chrome.storage.local.set({ baselines: obj });
    saveSnapshot();
});

// ==========================================================================
// --- COMMAND PALETTE & ACTIONS ---
// ==========================================================================
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
    { type: 'action', id: 'toggle_group', category: 'Organization', title: 'Toggle Group', aliases: ['group', 'ungroup', 'cluster'] },
    { type: 'action', id: 'duplicate_tab', category: 'Organization', title: 'Duplicate Tab', aliases: ['clone', 'copy tab'] },
    { type: 'action', id: 'copy_md_link', category: 'Productivity', title: 'Copy Markdown Link', aliases: ['markdown', 'url', 'copy link'] },
    { type: 'action', id: 'new_incognito', category: 'Window', title: 'New Incognito Window', aliases: ['private', 'secret', 'incognito'] },
    
    { type: 'action', id: 'gather_groups', category: 'Organization', title: 'Gather All Groups to Window', aliases: ['summon all groups', 'collect groups', 'move groups'] },
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
        ensureLoaded().then(async () => {
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
                
                // Dynamic Group & Set Commands
                const dynamicRegex = /^(summon|launch|delete set)\s*(.*)/;
                const dynamicMatch = actionQuery.match(dynamicRegex);
                
                if (dynamicMatch) {
                    const op = dynamicMatch[1];
                    let term = dynamicMatch[2];
                    let dynamicResults = [];
                    
                    // 1. Check Active Groups first (for 'summon' op)
                    if (op === 'summon' && chrome.tabGroups) {
                        try {
                            const allGroups = await chrome.tabGroups.query({});
                            for (const g of allGroups) {
                                if (!term || (g.title && g.title.toLowerCase().includes(term))) {
                                    dynamicResults.push({
                                        type: 'action',
                                        id: `summon_group_palette|${g.id}`,
                                        category: 'Groups',
                                        title: `Summon Group: "${g.title || 'Untitled'}"`,
                                        aliases: []
                                    });
                                }
                            }
                        } catch (e) {}
                    }

                    // 2. Check Saved Sets
                    for (const setName of Object.keys(tabSets)) {
                        if (!term || setName.toLowerCase().includes(term)) {
                            let title = "";
                            let id = "";
                            let category = 'Sets';
                            
                            if (op === 'summon') {
                                title = `Summon Set: "${setName}"`;
                                id = `summon_set_palette|${setName}`;
                            } else if (op === 'launch') {
                                title = `Launch Set: "${setName}"`;
                                id = `launch_set_palette|${setName}`;
                            } else if (op === 'delete set') {
                                title = `Delete Set: "${setName}"`;
                                id = `delete_set_palette|${setName}`;
                            }
                            
                            dynamicResults.push({
                                type: 'action',
                                id: id,
                                category: category,
                                title: title,
                                aliases: []
                            });
                        }
                    }

                    if (dynamicResults.length > 0) {
                        sendResponse({ results: dynamicResults.slice(0, 15) });
                    } else {
                        sendResponse({ results: [{ type: 'action', id: 'noop', category: 'Sets', title: `No matches found for "${term}"` }] });
                    }
                    return;
                }


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
            
            // Sort: pinned first → grouped (by title) → standalone
            // Pinned tabs MUST be created before grouped tabs so Chrome anchors them at index 0.
            const sorted = sessionVault.slice().sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (b.pinned && !a.pinned) return 1;
                return (a.groupTitle || '').localeCompare(b.groupTitle || '');
            });
            
            // ONE window for everything — old windowIds are stale across sessions.
            // Opening N windows (by original windowId) is wrong and confusing.
            const newWin = await chrome.windows.create({ focused: true });
            const startTabs = await chrome.tabs.query({ windowId: newWin.id });

            let groupMap = {};
            let first = true;
            for (const data of sorted) {
                const newTab = await chrome.tabs.create({
                    url: data.url,
                    pinned: data.pinned,
                    windowId: newWin.id,
                    active: first // Make the first real tab active
                });

                if (first) {
                    // Now that we have a real tab, safely remove the default blank tab(s)
                    first = false;
                    await Promise.all(startTabs.map(t => chrome.tabs.remove(t.id).catch(() => {})));
                }

                // Only group non-pinned tabs — Chrome rejects grouping pinned tabs
                if (!data.pinned && data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                    const groupKey = `${data.groupTitle || ''}-${data.groupColor || 'grey'}`;
                    if (!groupMap[groupKey]) {
                        const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                        await chrome.tabGroups.update(gid, {
                            title: data.groupTitle || '',
                            color: data.groupColor || 'grey'
                        });
                        groupMap[groupKey] = gid;
                    } else {
                        await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[groupKey] });
                    }
                }
                safeDiscard(newTab.id);
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
            // Palette vault restore — same single-window logic as restore-vault action
            ensureLoaded().then(async () => {
                if (!sessionVault || sessionVault.length === 0) {
                    sendResponse({ success: false });
                    return;
                }
                
                const sorted = sessionVault.slice().sort((a, b) => {
                    if (a.pinned && !b.pinned) return -1;
                    if (b.pinned && !a.pinned) return 1;
                    return (a.groupTitle || '').localeCompare(b.groupTitle || '');
                });
                
                const newWin = await chrome.windows.create({ focused: true });
                const startTabs = await chrome.tabs.query({ windowId: newWin.id });

                let groupMap = {};
                let first = true;
                for (const data of sorted) {
                    const newTab = await chrome.tabs.create({
                        url: data.url,
                        pinned: data.pinned,
                        windowId: newWin.id,
                        active: first
                    });

                    if (first) {
                        first = false;
                        await Promise.all(startTabs.map(t => chrome.tabs.remove(t.id).catch(() => {})));
                    }

                    if (!data.pinned && data.groupId !== -1 && data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                        const groupKey = `${data.groupTitle || ''}-${data.groupColor || 'grey'}`;
                        if (!groupMap[groupKey]) {
                            const gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                            await chrome.tabGroups.update(gid, {
                                title: data.groupTitle || '',
                                color: data.groupColor || 'grey'
                            });
                            groupMap[groupKey] = gid;
                        } else {
                            await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[groupKey] });
                        }
                    }
                    safeDiscard(newTab.id);
                }
                
                sessionVault = [];
                syncVaultToStorage();
                sendResponse({ success: true });
            });
            return true;
        }

        // ALWAYS New Tab as requested by user
        chrome.tabs.create({ url: request.url, active: true }, (tab) => {
            if (tab) chrome.windows.update(tab.windowId, { focused: true });
        });
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

        chrome.tabs.create({ url: url, active: true }, (tab) => {
            if (tab) chrome.windows.update(tab.windowId, { focused: true });
        });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === "get-sets") {
        ensureLoaded().then(() => {
            sendResponse({ sets: tabSets });
        });
        return true;
    }

    if (request.action === "save-set") {
        ensureLoaded().then(async () => {
             const tabs = await chrome.tabs.query({ windowId: request.windowId || chrome.windows.WINDOW_ID_CURRENT });
             const protectedTabs = [];
             
             for(let t of tabs) {
                 let shouldSave = false;
                 if (request.setType === 'group') {
                     shouldSave = (t.groupId === request.groupId);
                 } else {
                     shouldSave = (t.pinned || (t.groupId !== -1 && t.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)));
                 }
                 
                 if (shouldSave) {
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
             
             tabSets[request.name] = { type: request.setType || 'workspace', tabs: protectedTabs };
             syncSetsToStorage();
             sendResponse({ success: true, sets: tabSets });
        });
        return true;
    }

    if (request.action === "launch-set") {
        ensureLoaded().then(async () => {
             const setObj = tabSets[request.name];
             if (!setObj || !setObj.tabs || setObj.tabs.length === 0) {
                 sendResponse({ success: false });
                 return;
             }
             
             const newWin = await chrome.windows.create({ focused: true });
             let groupMap = {}; 

             for (const data of setObj.tabs) {
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
                 
                if (!data.active) safeDiscard(newTab.id);
             }
             
             const allWinTabs = await chrome.tabs.query({ windowId: newWin.id });
             if (allWinTabs.length > setObj.tabs.length) {
                 chrome.tabs.remove(allWinTabs[0].id).catch(() => {});
             }
             
             sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "summon-set") {
        ensureLoaded().then(async () => {
             const setObj = tabSets[request.name];
             if (!setObj || !setObj.tabs || setObj.tabs.length === 0) {
                 sendResponse({ success: false });
                 return;
             }
             
             const targetWinId = request.windowId || chrome.windows.WINDOW_ID_CURRENT;
             
             const existingGroups = chrome.tabGroups ? await chrome.tabGroups.query({ windowId: targetWinId }) : [];
             let groupMap = {};
             
             for (const g of existingGroups) {
                 let groupKey = `${g.title || ""}-${g.color || "grey"}`;
                 groupMap[groupKey] = g.id;
             }

             for (const data of setObj.tabs) {
                 const newTab = await chrome.tabs.create({
                     url: data.url,
                     pinned: data.pinned,
                     windowId: targetWinId,
                     active: false
                 });
                 
                 if (data.groupId !== -1 && chrome.tabGroups) {
                     let groupKey = `${data.groupTitle || ""}-${data.groupColor || "grey"}`;
                     if (!groupMap[groupKey]) {
                         let gid = await chrome.tabs.group({ tabIds: [newTab.id] });
                         await chrome.tabGroups.update(gid, { title: data.groupTitle || "", color: data.groupColor || "grey" });
                         groupMap[groupKey] = gid;
                     } else {
                         await chrome.tabs.group({ tabIds: [newTab.id], groupId: groupMap[groupKey] });
                     }
                 }
                 
                if (!data.active) safeDiscard(newTab.id);
             }
             
             sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "delete-set") {
        ensureLoaded().then(() => {
            delete tabSets[request.name];
            syncSetsToStorage();
            sendResponse({ success: true, sets: tabSets });
        });
        return true;
    }

    if (request.action === "import-sets") {
        ensureLoaded().then(() => {
            const imported = request.sets;
            if (imported && typeof imported === 'object') {
                for (let key in imported) {
                    if (Array.isArray(imported[key])) {
                        tabSets[key] = { type: 'workspace', tabs: imported[key] };
                    } else {
                        tabSets[key] = imported[key];
                    }
                }
                syncSetsToStorage();
                sendResponse({ success: true, sets: tabSets });
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
        executeBrowserAction(request.commandId, request.args).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

/**
 * Optimized Action Dispatcher
 * Maps command IDs to specific logic blocks
 */
async function executeBrowserAction(commandId, args) {
    await ensureLoaded();
    try {
        switch(commandId) {
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
            case 'gather_groups': {
                const currentWinId = chrome.windows.WINDOW_ID_CURRENT;
                const allGroups = await chrome.tabGroups.query({});
                for (const g of allGroups) {
                    if (g.windowId !== currentWinId) {
                        const gTabs = await chrome.tabs.query({ groupId: g.id });
                        if (gTabs.length > 0) {
                            await chrome.tabs.move(gTabs.map(t => t.id), { windowId: currentWinId, index: -1 });
                        }
                    }
                }
                break;
            }
            case 'summon_group_palette': {
                const currentWinId = chrome.windows.WINDOW_ID_CURRENT;
                const gid = parseInt(args);
                if (!isNaN(gid)) {
                    const gTabs = await chrome.tabs.query({ groupId: gid });
                    if (gTabs.length > 0) {
                        await chrome.tabs.move(gTabs.map(t => t.id), { windowId: currentWinId, index: -1 });
                    }
                }
                break;
            }
            case 'save_workspace': {
                let setName = args || "Workspace - " + new Date().toLocaleTimeString();
                chrome.runtime.onMessage.dispatch({ action: 'save-set', setType: 'workspace', name: setName }, {}, () => {});
                break;
            }
            case 'export_sets': {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tabSets, null, 2));
                chrome.downloads.download({
                    url: dataStr,
                    filename: "tabs_plus_plus_sets.json",
                    saveAs: true
                });
                break;
            }
            case 'summon_set_palette':
            case 'launch_set_palette':
            case 'delete_set_palette': {
                 let op = commandId.split('_')[0];
                 let actionMap = { 'summon': 'summon-set', 'launch': 'launch-set', 'delete': 'delete-set' };
                 chrome.runtime.onMessage.dispatch({ action: actionMap[op], name: args }, {}, () => {});
                 break;
            }
            case 'save_group':
            case 'stash_group': {
                const activeArray = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                if (!activeArray.length) break;
                const currentTab = activeArray[0];
                if (currentTab.groupId === -1 || currentTab.groupId === (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) break;
                
                let gName = "Group";
                if (chrome.tabGroups) {
                    try { let g = await chrome.tabGroups.get(currentTab.groupId); gName = g.title || "Group"; } catch(e){}
                }
                
                let setName = args || gName;
                chrome.runtime.onMessage.dispatch({ action: 'save-set', setType: 'group', groupId: currentTab.groupId, name: setName }, {}, () => {
                    if (commandId === 'stash_group') {
                        chrome.tabs.query({ groupId: currentTab.groupId }, (tabsToStash) => {
                            chrome.tabs.remove(tabsToStash.map(t => t.id)).catch(()=>{});
                        });
                    }
                });
                break;
            }
            case 'hibernate_all': {
                const hatabs = await chrome.tabs.query({ active: false });
                hatabs.forEach(t => { if (!t.discarded) chrome.tabs.discard(t.id).catch(()=>{}); });
                break;
            }
            case 'hibernate_window': {
                const hwtabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT, active: false });
                hwtabs.forEach(t => { if (!t.discarded) chrome.tabs.discard(t.id).catch(()=>{}); });
                break;
            }
            case 'pause_media': {
                const pmtabs = await chrome.tabs.query({});
                pmtabs.forEach(t => {
                    if (t.url && (t.url.startsWith('chrome://') || t.url.startsWith('edge://') || t.url.startsWith('chrome-extension://'))) return;
                    chrome.scripting.executeScript({
                        target: { tabId: t.id },
                        func: () => { document.querySelectorAll('video, audio').forEach(m => m.pause()); }
                    }).catch(()=>{});
                });
                break;
            }
            case 'mute_background': {
                const mbtabs = await chrome.tabs.query({ active: false });
                mbtabs.forEach(t => { chrome.tabs.update(t.id, { muted: true }).catch(()=>{}); });
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
                    try { await chrome.tabs.duplicate(tabs[0].id); }
                    catch(e) { chrome.tabs.create({ url: tabs[0].url }).catch(()=>{}); }
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
                        const targetLeft = win.left + w;
                        await chrome.windows.update(win.id, { width: w, left: win.left, state: 'normal' }).catch(()=>{});
                        chrome.windows.create({ tabId: t.id, left: targetLeft, width: w, height: win.height, top: win.top }).catch(()=>{});
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
                const activeId = tabs.find(t => t.active)?.id;
                if (activeId) {
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
            case 'open_downloads': chrome.tabs.create({ url: 'chrome://downloads/' }); break;
            case 'open_extensions': chrome.tabs.create({ url: 'chrome://extensions/' }); break;
            case 'open_settings': chrome.tabs.create({ url: 'chrome://settings/' }); break;
            
            // --- Settings Direct Links ---
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
                tabs.forEach(t => { if (!t.active && !t.discarded) chrome.tabs.discard(t.id).catch(()=>{}); });
                break;
            }
            case 'hibernate_current': {
                const tabs = await chrome.tabs.query({ active: true, windowId: chrome.windows.WINDOW_ID_CURRENT });
                if (tabs.length > 0) chrome.tabs.discard(tabs[0].id).catch(()=>{});
                break;
            }
        }
    } catch (e) {
        console.error("Action error:", e);
    }
}
