import { DEFAULT_SETTINGS } from './constants.js';

export let memoryBaselines = new Map();
export let globalSettings = { ...DEFAULT_SETTINGS };
export let lastActiveTabId = null;
export let isInitialized = false;
export let sessionVault = [];
export let vaultCanonicalUrls = new Set();
export let tabSets = {};
export let groupCache = new Map();
export let peekWindows = new Map();
export let evictionGraveyard = new Map();
export let recreationRegistry = new Map();
export let groupClosureTracker = new Map();
export let windowBatchTracker = new Map();
export let closingWindowIds = new Set();
export let autoGroupRegistry = new Map();
export let launchingWindowIds = new Set();
export let pendingLaunches = 0;
export function incrementPendingLaunches() { pendingLaunches++; }
export function decrementPendingLaunches() { if (pendingLaunches > 0) pendingLaunches--; }
export let ntpTabCache = new Map();
export let pomoTimer = { endTime: null, type: null, isActive: false };
export let discardedTabs = new Set();
export let recentlyAwakened = new Map();
export let pendingFocusGuardWindowIds = new Set();


export function setLastActiveTabId(id) { lastActiveTabId = id; }
export function setInitialized(val) { isInitialized = val; }
export function setSessionVault(val) { sessionVault = val; }
export function setTabSets(val) { tabSets = val; }
export function setPomoTimer(val) { pomoTimer = val; }


// Helper to update settings
export function updateSettings(newSettings) {
    globalSettings = { ...globalSettings, ...newSettings };
}
