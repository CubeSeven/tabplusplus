import { DEFAULT_SETTINGS } from './constants.js';

export let memoryBaselines = new Map();
export let globalSettings = { ...DEFAULT_SETTINGS };
export let lastActiveTabId = null;
export let isInitialized = false;
export let sessionVault = [];
export let lastSession = [];
export let tabSets = {};
export let groupCache = new Map();
export let peekWindows = new Map();
export let evictionGraveyard = new Map();
export let recreationRegistry = new Map();
export let groupClosureTracker = new Map();
export let windowBatchTracker = new Map();
export let closingWindowIds = new Set();
export let ntpTabCache = new Map();

export function setLastActiveTabId(id) { lastActiveTabId = id; }
export function setInitialized(val) { isInitialized = val; }
export function setSessionVault(val) { sessionVault = val; }
export function setLastSession(val) { lastSession = val; }
export function setTabSets(val) { tabSets = val; }

// Helper to update settings
export function updateSettings(newSettings) {
    globalSettings = { ...globalSettings, ...newSettings };
}
