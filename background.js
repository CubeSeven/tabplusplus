// Sync baselines from storage on every event if needed
// Or just use storage directly as the source of truth.

async function getBaselines() {
    const data = await chrome.storage.local.get('baselines');
    return data.baselines || {};
}

async function setBaselines(baselines) {
    await chrome.storage.local.set({ baselines });
}

async function getSettings() {
    const data = await chrome.storage.local.get({ settings: { protectPinned: true, protectGrouped: true } });
    return data.settings;
}

// Track pinned or grouped tabs and store their baseline if missing
async function updateTrackedTabs(cleanupGhosts = false) {
    const [tabs, baselines, settings] = await Promise.all([
        chrome.tabs.query({}), // Query all tabs to check both pinned and grouped
        getBaselines(),
        getSettings()
    ]);

    let changed = false;
    const newBaselines = { ...baselines };
    const currentActiveIds = new Set(tabs.map(t => t.id));

    // 1. Optional cleanup of "ghosts" (only on startup or deep sync)
    // We avoid doing this during normal operation to prevent race conditions with onRemoved
    if (cleanupGhosts) {
        for (const idStr of Object.keys(newBaselines)) {
            const id = parseInt(idStr, 10);
            if (!currentActiveIds.has(id)) {
                delete newBaselines[idStr];
                changed = true;
            }
        }
    }

    // 2. Track/update current tabs
    for (const tab of tabs) {
        let isProtected = false;
        if (settings.protectPinned && tab.pinned) isProtected = true;
        if (settings.protectGrouped && tab.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) isProtected = true;
        
        const url = tab.url || tab.pendingUrl;
        
        if (isProtected && url && !url.startsWith('chrome')) {
            if (!newBaselines[tab.id]) {
                newBaselines[tab.id] = {
                    url: url,
                    index: tab.index,
                    windowId: tab.windowId,
                    pinned: tab.pinned,
                    groupId: tab.groupId
                };
                changed = true;
            } else {
                newBaselines[tab.id].index = tab.index;
                newBaselines[tab.id].windowId = tab.windowId;
                newBaselines[tab.id].pinned = tab.pinned;
                newBaselines[tab.id].groupId = tab.groupId;
                // Don't update url, it's the baseline
                changed = true;
            }
        } else if (newBaselines[tab.id]) {
            // Tab was unpinned/ungrouped actively while open
            delete newBaselines[tab.id];
            changed = true;
        }
    }
    
    if (changed) {
        await setBaselines(newBaselines);
    }
}

// Listen for removal
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) return;

    // Fetch baselines inside the listener to minimize the window for race conditions
    let baselines = await getBaselines();
    const data = baselines[tabId];
    
    if (data && data.url) {
        console.log("Restoring protected tab:", data.url);
        
        // Immediately remove from the local baselines and update storage
        // to "claim" this restoration and prevent others from seeing it if they rerun
        delete baselines[tabId];
        await setBaselines(baselines);

        try {
            // First, find if there is an existing New Tab page in this window
            const existingNewTabs = await chrome.tabs.query({ 
                windowId: removeInfo.windowId,
                url: ['chrome://newtab/', 'chrome-search://local-ntp/local-ntp.html'] 
            });

            if (existingNewTabs.length > 0) {
                // Focus the first existing one
                await chrome.tabs.update(existingNewTabs[0].id, { active: true });
            } else {
                // Otherwise, create a new one
                await chrome.tabs.create({ active: true });
            }

            // Then silently recreate the old tab in the background
            const newTab = await chrome.tabs.create({
                url: data.url,
                pinned: data.pinned,
                index: data.index,
                windowId: data.windowId,
                active: false
            });
            
            // Re-group if it was in a group
            if (data.groupId !== (chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1)) {
                try {
                    await chrome.tabs.group({
                        tabIds: [newTab.id],
                        groupId: data.groupId
                    });
                } catch (groupError) {
                    console.log("Group no longer exists or cannot be joined:", groupError);
                }
            }

            // Resource Optimization: Put the tab to sleep after a short delay
            // We delay it slightly so Chrome has time to assign the URL and Group properly
            setTimeout(async () => {
                try {
                    await chrome.tabs.discard(newTab.id);
                } catch (discardError) {
                    console.log("Couldn't discard tab:", discardError);
                }
            }, 1000); // 1 second delay
            
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon128.png',
                title: 'Tabs++',
                message: `Restored: ${data.url.substring(0, 30)}...`
            });
        } catch (e) {
            console.error("Restore failed:", e);
            chrome.tabs.create({ url: data.url, pinned: data.pinned });
        }
    }
});

// Track updates
// Track updates
let updateTimeout = null;
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only react to meaningful changes (pinned status, group change, url change for new tabs)
    if (changeInfo.pinned !== undefined || changeInfo.groupId !== undefined || changeInfo.url !== undefined) {
        // Debounce to prevent rapid-fire storage writes
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
            updateTrackedTabs();
        }, 300);
    }
});

// Settings Update Listener
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
        // Clear trackers instantly for disabled protections
        updateTrackedTabs();
    }
});

// Sync on move
chrome.tabs.onMoved.addListener(() => updateTrackedTabs());

// Initialization
chrome.runtime.onInstalled.addListener(() => updateTrackedTabs(true)); // Cleanup on install
chrome.runtime.onStartup.addListener(() => updateTrackedTabs(true)); // Cleanup on startup
updateTrackedTabs(); // Regular update on service worker start
