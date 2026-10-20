const urlParams = new URLSearchParams(window.location.search);
const isFallback = urlParams.get('action') === 'palette';

if (urlParams.get('focused') !== 'true' && !isFallback) {
    window.location.replace('ntp.html?focused=true');
}

function closeFallback() {
    try { chrome.runtime.sendMessage({ action: 'palette-closing' }); } catch (e) {}
    window.close();
}

let timeFormat = '24h';
let showClock = true;

let enablePalette = true;

chrome.storage.local.get({ settings: { enablePalette: true, showClock: true } }, (data) => {
    if (data.settings.timeFormat) timeFormat = data.settings.timeFormat;
    enablePalette = data.settings.enablePalette !== false;
    showClock = data.settings.showClock !== false;
    document.body.classList.toggle('fx-off', data.settings.reduceEffects === true);
    initDashboard();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) {
        const oldVal = changes.settings.oldValue?.enablePalette;
        const newVal = changes.settings.newValue?.enablePalette;
        if (newVal !== undefined && newVal !== oldVal) {
            enablePalette = newVal;
            const container = document.getElementById('palette-container');
            if (container) container.style.display = enablePalette ? '' : 'none';
        }

        const newTimeFormat = changes.settings.newValue?.timeFormat;
        if (newTimeFormat && newTimeFormat !== timeFormat) {
            timeFormat = newTimeFormat;
            updateClock();
        }

        const newShowClock = changes.settings.newValue?.showClock;
        if (newShowClock !== undefined && newShowClock !== showClock) {
            showClock = newShowClock;
            const clock = document.getElementById('clock');
            if (clock) clock.classList.toggle('hidden', !showClock);
            const date = document.getElementById('date');
            if (date) date.classList.toggle('hidden', !showClock);
        }

        const newReduce = changes.settings.newValue?.reduceEffects;
        if (newReduce !== undefined) {
            document.body.classList.toggle('fx-off', newReduce === true);
        }
    }
});

let input, resultsContainer;
let currentResults = [];
let domOrderedResults = [];
let selectedIndex = -1;
let pendingCommand = null;
let focusInterval = null;
let clockInterval = null;
let focusoutTimeout = null;
let clipTimeout = null;
let isNavigating = false;
let lastSearchedQuery = '';
let cachedResultItems = [];
let isActionMode = false;
let suppressActionModeToggle = false;
let actionModeIndicator = null;

// ── Search-engine cycling (Tab in the palette input) ──────────────────
const ENGINE_ORDER = ['google', 'chatgpt', 'perplexity', 'duckduckgo', 'bing', 'brave'];
const ENGINE_LABELS = { google: 'Google', chatgpt: 'ChatGPT', perplexity: 'Perplexity', duckduckgo: 'DuckDuckGo', bing: 'Bing', brave: 'Brave' };
const ENGINE_ICON_PATHS = {
"google": "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
"chatgpt": "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
"perplexity": "M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z",
"duckduckgo": "M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 23C5.925 23 1 18.074 1 12S5.926 1 12 1s11 4.925 11 11-4.925 11-11 11zm10.219-11c0 4.805-3.317 8.833-7.786 9.925-.27-.521-.53-1.017-.749-1.438.645.249 1.93.718 2.208.615.376-.144.282-3.149-.14-3.245-.338-.075-1.632.837-2.141 1.209l.034.156c.078.397.144.993.03 1.247-.001.004-.002.01-.004.013a.218.218 0 0 1-.068.088c-.284.188-1.081.284-1.503.188a.516.516 0 0 1-.064-.02c-.694.396-2.01 1.109-2.25.971-.329-.188-.377-2.676-.329-3.288.035-.46 1.653.286 2.442.679.174-.163.602-.272.98-.31-.57-1.389-.99-2.977-.733-4.105 0 .002.002.002.002.002.356.248 2.73 1.05 3.91 1.027 1.18-.024 3.114-.743 2.903-1.323-.212-.58-2.135.51-4.142.324-1.486-.138-1.748-.804-1.42-1.29.414-.611 1.168.116 2.411-.256 1.245-.371 2.987-1.035 3.632-1.397 1.494-.833-.625-1.177-1.125-.947-.474.22-2.123.637-2.889.82.428-1.516-.603-4.149-1.757-5.3-.376-.376-.951-.612-1.603-.736-.25-.344-.654-.671-1.225-.977a5.772 5.772 0 0 0-3.595-.584l-.024.004-.034.004.004.002c-.148.028-.237.08-.357.098.148.016.705.276 1.057.418-.174.068-.412.108-.596.184a.828.828 0 0 0-.204.056c-.173.08-.303.375-.3.515.84-.086 2.082-.026 2.991.246-.644.09-1.235.258-1.661.482-.016.008-.03.018-.048.028-.054.02-.106.042-.152.066-1.367.72-1.971 2.405-1.611 4.424.323 1.824 1.665 8.088 2.29 11.064-3.973-1.4-6.822-5.186-6.822-9.639C1.781 6.356 6.356 1.781 12 1.781S22.219 6.356 22.219 12zM9.095 9.581a.758.758 0 1 0 0 1.516.758.758 0 0 0 0-1.516zm.338.702a.196.196 0 1 1 0-.392.196.196 0 0 1 0 .392zm4.724-1.043a.65.65 0 1 0 0 1.299.65.65 0 0 0 0-1.3zm.29.601a.168.168 0 1 1 0-.336.168.168 0 0 1 0 .336zM9.313 8.146s-.571-.26-1.125.09c-.554.348-.534.704-.534.704s-.294-.656.49-.978c.786-.32 1.17.184 1.17.184zm5.236-.052s-.41-.234-.73-.23c-.654.008-.831.296-.831.296s.11-.688.945-.55a.84.84 0 0 1 .616.484z",
"bing": "M20.176 15.406a6.48 6.48 0 01-1.736 4.414c1.338-1.47.803-3.869-1.003-4.635-.862-.305-2.488-.85-3.367-1.158a1.834 1.834 0 01-.932-.818c-.381-.975-1.163-2.968-1.548-3.948-.095-.285-.31-.625-.265-.938.046-.598.724-1.003 1.276-.754l3.682 1.888c.621.292 1.305.692 1.796 1.172a6.486 6.486 0 012.097 4.777zm-1.44 1.888c-.264-1.194-1.135-1.744-2.216-2.028-1.527.902-4.853 2.878-6.952 4.13-1.103.68-2.13 1.35-2.919 1.242a2.866 2.866 0 01-2.77-2.325c-.012-.048-.008-.03-.001.01a6.4 6.4 0 00.947 2.653 6.498 6.498 0 005.486 3.022c1.908.062 3.536-1.153 5.099-2.096.292-.188.804-.496 1.332-.831l1.423-1.51c.553-.577.764-1.426.571-2.267zm-12.04 2.97c.422 0 .822-.1 1.173-.29.355-.215.964-.579 1.7-1.018L9.57 4.502c0-.99-.497-1.864-1.257-2.382-.08-.059-2.91-1.901-2.99-1.956-.605-.432-1.523.045-1.5.797v14.887l.417 2.36a2.488 2.488 0 002.455 2.056z",
"brave": "M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z"
}; // simple-icons paths, 24x24 viewBox
let engineOverride = null;
let engineBase = 'google';
let engineChip = null;

function updateEngineChip() {
    if (!engineChip) return;
    if (!engineOverride) {
        engineChip.classList.remove('visible');
        return;
    }
    const label = ENGINE_LABELS[engineOverride] || engineOverride;
    engineChip.textContent = '';
    engineChip.title = label + ' — Tab to cycle, click to reset';
    const d = ENGINE_ICON_PATHS[engineOverride];
    if (d) {
        // Brand glyph as monochrome SVG — fill tracks currentColor, so it
        // recolors with the background exactly like text.
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('fill', 'currentColor');
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
        engineChip.appendChild(svg);
    } else {
        engineChip.textContent = label; // unknown engine — plain text
    }
    engineChip.classList.add('visible');
}

function cycleEngine(dir) {
    const cur = engineOverride || engineBase;
    let i = ENGINE_ORDER.indexOf(cur);
    if (i === -1) i = 0;
    engineOverride = ENGINE_ORDER[(i + dir + ENGINE_ORDER.length) % ENGINE_ORDER.length];
    updateEngineChip();
    handleSearch();
}

function createEngineChip(inputWrapper) {
    inputWrapper.style.position = 'relative';
    const style = document.createElement('style');
    style.textContent = `.engine-chip{display:none;position:absolute;right:14px;top:50%;transform:translateY(-50%);padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.02em;background:rgba(124,135,248,.14);color:#7C87F8;cursor:pointer;user-select:none;z-index:5}.engine-chip.visible{display:block}`;
    document.documentElement.appendChild(style);
    engineChip = document.createElement('div');
    engineChip.className = 'engine-chip';
    engineChip.title = 'Search engine — Tab to cycle, click to reset';
    engineChip.addEventListener('click', () => {
        engineOverride = null;
        updateEngineChip();
        handleSearch();
    });
    inputWrapper.appendChild(engineChip);
}

let cachedQueryRegex = null;
let cachedQueryForRegex = '';

// Prompt Vault State
let isPromptsMode = false;
let domOrderedPrompts = [];
let cachedAllPrompts = [];
let cachedPromptItems = [];
let pendingPromptText = '';

function getQueryRegex(query) {
    if (!query) return null;
    if (query === cachedQueryForRegex) return cachedQueryRegex;
    const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cachedQueryRegex = new RegExp(`(${safeQ})`, 'gi');
    cachedQueryForRegex = query;
    return cachedQueryRegex;
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}

function highlight(text, queryRegex) {
    if (!text) return '';
    const safe = escapeHTML(text);
    if (!queryRegex) return safe;
    return safe.replace(queryRegex, '<mark>$1</mark>');
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

const GROUP_COLORS = {
    blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04', green: '#34a853',
    pink: '#ff6d9f', purple: '#a142f4', cyan: '#24c1e0', orange: '#fa7b17', grey: '#9e9e9e'
};

const SECTION_ORDER = ['action', 'bang', 'navigate', 'split', 'search', 'tab', 'closed', 'bookmark', 'history', 'vault'];
const SECTION_LABELS = { action: 'Actions', split: 'Split View', tab: 'Open Tabs', closed: 'Recently Closed', bookmark: 'Bookmarks', history: 'History', vault: 'Protected Tabs' };
const ICONS = {
    zap: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    globe: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    star: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    link: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    file: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`
};

const TYPE_FALLBACK = {
    action: ICONS.zap, tab: ICONS.globe, history: ICONS.clock, bookmark: ICONS.star, bang: ICONS.zap,
    search: ICONS.search, navigate: ICONS.link, split: ICONS.link, closed: ICONS.clock, default: ICONS.file
};

const LOGO_ICON = `<svg width="30" height="30" viewBox="0 0 193 193" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M148.277 43.0867C115.56 42.91 82.8308 43.0685 50.1095 43.0074C46.8919 43.1643 44.0688 46.055 44.0143 49.2859C43.9962 58.4749 43.9929 67.6656 44.0143 76.8546C44.1811 79.1642 45.6801 81.1486 47.6282 82.3109C66.3414 96.8621 81.089 118.035 83.6645 142.049C84.2506 144.316 83.2369 147.252 85.043 149.074C85.6902 149.545 86.4017 150.103 87.2569 149.984C102.941 149.997 118.624 149.997 134.308 149.984C136.37 150.06 137.901 147.805 137.453 145.865C136.785 137.62 133.819 129.706 129.694 122.583C125.126 114.979 119.333 108.149 112.833 102.13C105.391 95.0626 97.0468 88.865 87.7505 84.4505C76.5672 79.2352 64.2662 76.5228 51.9288 76.3923C50.0848 76.6895 48.3513 74.8636 48.4702 73.0591C48.4437 65.5739 48.4734 58.0886 48.4553 50.605C48.6006 48.8599 50.1211 47.3279 51.9272 47.4748C60.3238 47.4038 68.6477 49.7547 75.9728 53.811C84.0013 58.2949 90.0833 65.3328 97.0881 71.1507C102.615 76.6103 108.935 81.421 116.252 84.1929C120.985 86.0238 125.989 87.0738 131.038 87.5195C136.638 87.6698 142.246 87.5509 147.849 87.5856C149.591 87.5988 151.012 85.9627 150.974 84.2854C150.987 71.6278 150.989 58.9702 150.973 46.3142C151.06 44.7574 149.823 43.2749 148.277 43.0867Z" fill="#b0b0b8"/></svg>`;

function initDashboard() {
    updateClock();
    if (!showClock) {
        document.getElementById('clock')?.classList.add('hidden');
        document.getElementById('date')?.classList.add('hidden');
    }
    clockInterval = setInterval(updateClock, 1000);
    window.addEventListener('pagehide', () => {
        clearInterval(clockInterval);
        if (focusInterval) clearInterval(focusInterval);
        if (focusoutTimeout) clearTimeout(focusoutTimeout);
        if (clipTimeout) clearTimeout(clipTimeout);
    });

    const paletteContainer = document.getElementById('palette-container');
    if (!enablePalette && paletteContainer) {
        paletteContainer.style.display = 'none';
        initBgPicker();
        return;
    }

    input = document.getElementById('search-input');
    input.value = '';
    resultsContainer = document.getElementById('results-container');

    const inputWrapper = input.parentElement;
    actionModeIndicator = document.createElement('div');
    actionModeIndicator.className = 'action-indicator';
    actionModeIndicator.innerHTML = LOGO_ICON;
    inputWrapper.insertBefore(actionModeIndicator, input);
    createEngineChip(inputWrapper);

    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item) {
            const idx = parseInt(item.getAttribute('data-idx'));
            if (idx >= 0 && idx < domOrderedResults.length) {
                activateResult(domOrderedResults[idx]);
            }
            return;
        }

        const promptItem = e.target.closest('.prompt-item');
        if (promptItem) {
            const pidx = parseInt(promptItem.getAttribute('data-pidx'));
            if (pidx >= 0 && pidx < domOrderedPrompts.length) {
                const prompt = domOrderedPrompts[pidx];
                updateSelection(pidx);
                navigator.clipboard.writeText(prompt.text).catch(() => {});
                showPromptsFeedback(`Copied: ${prompt.name}`, '#4ade80');
                if (clipTimeout) clearTimeout(clipTimeout);
                clipTimeout = setTimeout(() => {
                    if (isFallback) closeFallback();
                    else { exitPromptsMode(); }
                }, 500);
            }
        }
    });

    resultsContainer.addEventListener('mousemove', (e) => {
        const item = e.target.closest('.result-item');
        if (!item) return;
        const idx = parseInt(item.getAttribute('data-idx'));
        if (idx >= 0 && idx < domOrderedResults.length && selectedIndex !== idx) {
            updateSelection(idx);
        }
    });

    resultsContainer.addEventListener('error', (e) => {
        const img = e.target;
        if (img && img.matches && img.matches('img[data-type]')) {
            const type = img.getAttribute('data-type') || 'default';
            img.outerHTML = TYPE_FALLBACK[type] || TYPE_FALLBACK.default;
        }
    }, true);

    // Aggressively attempt to focus the input to fight Chrome's omnibox
    let attempts = 0;
    const focusTarget = () => {
        if (isNavigating || document.visibilityState === 'hidden') return;
        window.focus();
        document.body.focus();
        if (input) input.focus();
    };

    focusTarget();
    if (focusInterval) clearInterval(focusInterval);
    focusInterval = setInterval(() => {
        focusTarget();
        attempts++;
        if (attempts > 50) clearInterval(focusInterval); // Try for ~2.5s
    }, 50);

    // Snatch focus back if lost to the omnibox (detected by null relatedTarget)
    input.addEventListener('focusout', (e) => {
        if (isNavigating || document.visibilityState === 'hidden') return;
        
        // If relatedTarget is null, focus likely went to the browser's own UI (URL bar)
        if (!e.relatedTarget) {
            if (focusoutTimeout) clearTimeout(focusoutTimeout);
            focusoutTimeout = setTimeout(() => {
                if (!isNavigating && input && document.visibilityState === 'visible') {
                    window.focus();
                    input.focus();
                }
            }, 50);
        }
    });

    // Also focus whenever user returns to this tab
    window.addEventListener('focus', () => {
        if (!isNavigating && input) input.focus();
    });

    // Also focus if they click or tap anywhere on the page
    ['mousedown', 'touchstart'].forEach(type => {
        document.addEventListener(type, (e) => {
            if (isNavigating) return;
            if (input && e.target !== input) {
                // Check if user is clicking a result or other interactive element
                if (!e.target.closest('.result-item') && !e.target.closest('a') && !e.target.closest('button')) {
                    input.focus();
                }
            }
        });
    });

    input.addEventListener('input', handleActionModeInput);
    input.addEventListener('input', debounce(handleSearch, 150));
    input.addEventListener('keydown', handleKeydown);

    // Initial search to populate open tabs
    handleSearch();

    initBgPicker();
}

let currentDesign = 0;
let currentColor = '#7C87F8';

function initBgPicker() {
    const trigger = document.getElementById('bg-picker-trigger');
    const picker = document.getElementById('bg-color-picker');
    const switcher = document.getElementById('bg-design-switcher');
    if (!trigger || !picker) return;

    const keyActivate = (el, fn) => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
        });
    };

    trigger.addEventListener('click', () => picker.click());
    keyActivate(trigger, () => picker.click());

    picker.addEventListener('input', (e) => {
        currentColor = e.target.value;
        applyBgColor(currentColor);
        chrome.storage.local.set({ ntpBgColor: currentColor }).catch(() => {});
    });

    if (switcher) {
        switcher.addEventListener('click', cycleBgDesign);
        keyActivate(switcher, cycleBgDesign);
    }

    // Load saved settings
    chrome.storage.local.get({ ntpBgColor: '#7C87F8', ntpBgDesign: 0 }, (data) => {
        currentColor = data.ntpBgColor;
        currentDesign = data.ntpBgDesign;
        picker.value = currentColor;
        applyBgDesign(currentDesign);
        applyBgColor(currentColor);
    });
}

function cycleBgDesign() {
    currentDesign = (currentDesign + 1) % 4;
    applyBgDesign(currentDesign);
    applyBgColor(currentColor);
    chrome.storage.local.set({ ntpBgDesign: currentDesign }).catch(() => {});
}

function applyBgDesign(designIndex) {
    const layers = document.querySelectorAll('.bg-layer');
    layers.forEach((layer, i) => {
        if (i === designIndex) layer.classList.add('active');
        else layer.classList.remove('active');
    });
}

function applyBgColor(primaryColor) {
    // Design 0: Mesh Blobs
    const defaultBlobs = document.querySelectorAll('.bg-layer-0 .blob path');
    defaultBlobs.forEach((path, i) => {
        const fill = path.getAttribute('fill');
        if (fill !== '#000' && fill !== 'black') {
            path.setAttribute('fill', primaryColor);
            if (i % 2 !== 0) path.style.opacity = "0.8";
        }
    });

    // Design 1: Complex SVG Blobs
    const design1Paths = document.querySelectorAll('.bg-layer-1 .dynamic-color');
    design1Paths.forEach((path) => {
        path.setAttribute('fill', primaryColor);
    });

    // Design 2: Grid Mask
    const grid = document.querySelector('.grid-pattern');
    if (grid) {
        grid.style.setProperty('--grid-color', primaryColor + '2e');
    }

    // Design 3: Grid SVG Focal Point
    const focalEllipse = document.querySelector('.dynamic-color-ellipse');
    if (focalEllipse) {
        focalEllipse.setAttribute('fill', primaryColor);
    }
}

const clockFormatters = {};
function getClockFormatter(hour12) {
    const key = hour12 ? '12' : '24';
    if (!clockFormatters[key]) {
        clockFormatters[key] = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12 });
    }
    return clockFormatters[key];
}

function updateClock() {
    const now = new Date();
    const hour12 = timeFormat === '12h';
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date');

    if (hour12) {
        const parts = getClockFormatter(true).formatToParts(now);
        const timeStr = parts.filter(p => p.type === 'hour' || p.type === 'minute' || p.type === 'literal').map(p => p.value).join('');
        const periodStr = parts.find(p => p.type === 'dayPeriod')?.value || '';
        clockEl.innerHTML = `${timeStr} <span class="clock-period">${periodStr}</span>`;
    } else {
        clockEl.textContent = getClockFormatter(false).format(now);
    }

    dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function getSearchQuery() {
    const raw = input.value.trim();
    return isActionMode ? '>' + raw : raw;
}

function handleActionModeInput() {
    if (!actionModeIndicator) return;
    const val = input.value;
    if (suppressActionModeToggle) { suppressActionModeToggle = false; return; }
    if (!isActionMode && val.startsWith('>')) {
        isActionMode = true;
        suppressActionModeToggle = true;
        input.value = val.substring(1);
        actionModeIndicator.classList.add('visible');
        return;
    }
    if (isActionMode && val === '') {
        isActionMode = false;
        actionModeIndicator.classList.remove('visible');
    }
}

async function handleSearch() {
    if (pendingCommand) return;
    if (!chrome.runtime?.id) return;
    const query = getSearchQuery();

    if (isPromptsMode) {
        const filtered = filterPromptsByQuery(cachedAllPrompts, query);
        renderPromptsResults(filtered);
        return;
    }

    const sentQuery = query;
    chrome.runtime.sendMessage({ action: 'search-items', query, ...(engineOverride ? { engine: engineOverride } : {}) }, response => {
        if (chrome.runtime.lastError) return;
        if (getSearchQuery() !== sentQuery) return;
        if (response && response.engine) engineBase = response.engine;
        if (response && response.results) {
            lastSearchedQuery = query;
            currentResults = response.results;
            renderResults(currentResults, query);
        }
    });
}

function getFaviconHtml(result) {
    if (result.favIconUrl && result.favIconUrl.startsWith('http')) {
        return `<img src="${escapeHTML(result.favIconUrl)}" data-type="${result.type}" />`;
    }
    if (result.url) {
        try {
            const domain = new URL(result.url).hostname;
            return `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" data-type="${result.type}" />`;
        } catch {}
    }
    return TYPE_FALLBACK[result.type] || TYPE_FALLBACK.default;
}

function renderResults(results, query) {
    resultsContainer.innerHTML = '';
    resultsContainer.scrollTop = 0;
    domOrderedResults = [];
    selectedIndex = results.length > 0 ? 0 : -1;

    if (results.length === 0) {
        resultsContainer.classList.add('has-items');
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${ICONS.search}</div>
                <div class="empty-title">${query ? `No results for "${escapeHTML(query)}"` : 'Nothing to show'}</div>
                <div class="empty-hint">Try a bang like !yt, !gh, !px, or !gpt</div>
            </div>`;
        return;
    }

    resultsContainer.classList.add('has-items');

    const queryRegex = getQueryRegex(query);

    const grouped = {};
    SECTION_ORDER.forEach(t => grouped[t] = []);
    results.forEach(r => {
        const key = SECTION_ORDER.includes(r.type) ? r.type : 'history';
        grouped[key].push(r);
    });

    let html = '';
    let domIdx = 0;

    const buildItem = (result) => {
        domOrderedResults.push(result);

        const faviconContent = getFaviconHtml(result);
        const groupDot = (result.groupColor && GROUP_COLORS[result.groupColor])
            ? `<div class="group-dot" style="background:${GROUP_COLORS[result.groupColor]}"></div>` : '';
        const iconHtml = `<div class="icon-wrap"><div class="icon">${faviconContent}</div>${groupDot}</div>`;

        let subtext = result.url || '';
        if (result.type === 'bang') subtext = result.label || result.bang;
        else if (result.type === 'search') subtext = 'Google Search';
        else if (result.type === 'navigate') subtext = 'Open URL';
        else if (result.type === 'closed') subtext = result.url || '';

        const badge = result.type === 'navigate' ? 'link' : result.type === 'bang' ? result.bang : result.type === 'closed' ? 'closed' : result.type;

        const sel = domIdx === 0 ? ' selected' : '';
        const ariaSel = domIdx === 0 ? 'true' : 'false';
        const itemHtml = `<div class="result-item${sel}" role="option" aria-selected="${ariaSel}" id="ntp-result-${domIdx}" data-idx="${domIdx}">
            ${iconHtml}
            <div class="details">
                <div class="title">${highlight(result.title, queryRegex)}</div>
                <div class="subtext">${escapeHTML(subtext)}</div>
            </div>
            <div class="badge">${escapeHTML(badge)}</div>
        </div>`;
        domIdx++;
        return itemHtml;
    };

    SECTION_ORDER.forEach(type => {
        const items = grouped[type];
        if (!items || items.length === 0) return;

        if (type === 'action' && items[0]._cmdPalette) {
            const recentItems = items.filter(r => r._recent);
            const restItems = items.filter(r => !r._recent);

            const byCategory = {};
            restItems.forEach(r => {
                const cat = r.category || 'Other';
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(r);
            });

            const CATEGORY_ORDER = [
                'Focus', 'Sets', 'Performance', 'Tools', 'Media',
                'Privacy', 'System', 'Organization', 'Appearance',
                'Control', 'Data', 'Productivity', 'Window', 'Safety', 'Settings'
            ];

            if (recentItems.length > 0) {
                html += '<div class="section-header">Recent Actions</div>';
                recentItems.forEach(result => { html += buildItem(result); });
            }

            for (const cat of CATEGORY_ORDER) {
                const catItems = byCategory[cat];
                if (!catItems || catItems.length === 0) continue;
                html += `<div class="section-header">${cat}</div>`;
                catItems.forEach(result => { html += buildItem(result); });
            }
        } else {
            if (SECTION_LABELS[type]) {
                html += `<div class="section-header">${SECTION_LABELS[type]}</div>`;
            }
            items.forEach(result => { html += buildItem(result); });
        }
    });

    resultsContainer.innerHTML = html;
    cachedResultItems = Array.from(resultsContainer.querySelectorAll('.result-item'));
}

function updateSelection(index) {
    if (isPromptsMode) {
        if (selectedIndex >= 0 && selectedIndex < cachedPromptItems.length) cachedPromptItems[selectedIndex].classList.remove('focused');
        selectedIndex = index;
        if (selectedIndex >= 0 && selectedIndex < cachedPromptItems.length) {
            cachedPromptItems[selectedIndex].classList.add('focused');
            cachedPromptItems[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
    }
    if (selectedIndex >= 0 && selectedIndex < cachedResultItems.length) {
        cachedResultItems[selectedIndex].classList.remove('selected');
        cachedResultItems[selectedIndex].setAttribute('aria-selected', 'false');
    }
    selectedIndex = index;
    if (selectedIndex >= 0 && selectedIndex < cachedResultItems.length) {
        cachedResultItems[selectedIndex].classList.add('selected');
        cachedResultItems[selectedIndex].setAttribute('aria-selected', 'true');
        cachedResultItems[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const inputEl = document.getElementById('search-input');
        if (inputEl) inputEl.setAttribute('aria-activedescendant', cachedResultItems[selectedIndex].id);
    }
}

function filterPromptsByQuery(prompts, query) {
    if (!query) return prompts;
    const lower = query.toLowerCase();
    const parts = lower.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return prompts;
    return prompts.filter(p => {
        const hay = `${p.name} ${p.text}`.toLowerCase();
        return parts.every(part => hay.includes(part));
    });
}

function renderPromptsResults(results) {
    resultsContainer.innerHTML = '';
    resultsContainer.scrollTop = 0;
    domOrderedPrompts = results;
    selectedIndex = results.length > 0 ? 0 : -1;
    resultsContainer.classList.add('prompts-grid');

    if (results.length === 0) {
        resultsContainer.classList.remove('prompts-grid');
        resultsContainer.classList.add('has-items');
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-title">No saved prompts</div>
                <div class="empty-hint">Use &gt;save prompt on a page with selected text</div>
            </div>`;
        return;
    }

    let html = '';
    results.forEach((prompt, index) => {
        const focused = index === 0 ? ' focused' : '';
        const preview = (prompt.text || '').replace(/\s+/g, ' ').trim();
        html += `<div class="prompt-item${focused}" data-pidx="${index}">
            <div class="prompt-name">${escapeHTML(prompt.name)}</div>
            <div class="prompt-preview">${escapeHTML(preview)}</div>
        </div>`;
    });
    resultsContainer.innerHTML = html;
    cachedPromptItems = Array.from(resultsContainer.querySelectorAll('.prompt-item'));
}

function showPromptsFeedback(message, color, restoreValue) {
    if (!input) return;
    input.value = message;
    input.style.color = color;
    if (clipTimeout) clearTimeout(clipTimeout);
    clipTimeout = setTimeout(() => {
        if (!input) return;
        input.style.color = '';
        input.value = restoreValue !== undefined ? restoreValue : '';
    }, 400);
}

function exitPromptsMode() {
    isPromptsMode = false;
    domOrderedPrompts = [];
    cachedAllPrompts = [];
    cachedPromptItems = [];
    pendingPromptText = '';
    input.value = '';
    input.placeholder = "Search tabs, history, bookmarks... try !yt, !gh, or > for tools";
    resultsContainer.classList.remove('prompts-grid');
    handleSearch();
}

function handleKeydown(e) {
    if (e.key === 'Escape') {
        if (isPromptsMode) {
            exitPromptsMode();
            e.preventDefault();
            return;
        }
        if (pendingCommand) {
            pendingCommand = null;
            pendingPromptText = '';
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... try !yt, !gh, or > for tools";
            handleSearch();
            e.preventDefault();
            return;
        }
    }

    if (pendingCommand === 'save_prompt_data') {
        if (e.key === 'Enter') {
            const name = input.value.trim();
            if (name && pendingPromptText) {
                const captured = pendingPromptText;
                chrome.runtime.sendMessage({ action: 'save-prompt', name, text: captured }, (response) => {
                    pendingCommand = null;
                    pendingPromptText = '';
                    if (chrome.runtime.lastError || !response?.success) {
                        showPromptsFeedback('Save failed', '#ff3b30');
                        if (clipTimeout) clearTimeout(clipTimeout);
                        clipTimeout = setTimeout(() => {
                            input.value = '';
                            input.style.color = '';
                            if (isFallback) closeFallback();
                            else handleSearch();
                        }, 500);
                        return;
                    }
                    showPromptsFeedback(`Saved: ${name}`, '#4ade80');
                    if (clipTimeout) clearTimeout(clipTimeout);
                    clipTimeout = setTimeout(() => {
                        input.value = '';
                        input.style.color = '';
                        if (isFallback) closeFallback();
                        else handleSearch();
                    }, 500);
                });
            } else {
                pendingCommand = null;
                pendingPromptText = '';
                if (isFallback) closeFallback();
                else handleSearch();
            }
            e.preventDefault();
        }
        return;
    }

    if (isPromptsMode) {
        if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            if (selectedIndex >= 0 && selectedIndex < domOrderedPrompts.length) {
                const target = domOrderedPrompts[selectedIndex];
                const savedQuery = input.value;
                const deletedIdx = selectedIndex;
                chrome.runtime.sendMessage({ action: 'delete-prompt', id: target.id }, (response) => {
                    if (chrome.runtime.lastError || !response?.success) {
                        showPromptsFeedback('Delete failed', '#ff3b30', savedQuery);
                        return;
                    }
                    const remaining = response.prompts || [];
                    showPromptsFeedback(`Deleted: ${target.name}`, '#ff3b30', savedQuery);
                    if (remaining.length === 0) {
                        exitPromptsMode();
                    } else {
                        cachedAllPrompts = remaining;
                        const filtered = filterPromptsByQuery(remaining, savedQuery);
                        renderPromptsResults(filtered);
                        const newIdx = Math.min(deletedIdx, domOrderedPrompts.length - 1);
                        if (newIdx >= 0) updateSelection(newIdx);
                    }
                });
            }
            e.preventDefault();
            return;
        }

        const items = cachedPromptItems;
        if (!items || items.length === 0) return;

        if (e.key === 'ArrowRight') {
            updateSelection(selectedIndex + 1 >= domOrderedPrompts.length ? 0 : selectedIndex + 1);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            updateSelection(selectedIndex - 1 < 0 ? domOrderedPrompts.length - 1 : selectedIndex - 1);
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            let newIndex = selectedIndex + 2;
            if (newIndex >= domOrderedPrompts.length) newIndex = domOrderedPrompts.length - 1;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            let newIndex = selectedIndex - 2;
            if (newIndex < 0) newIndex = 0;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'Enter' || e.key === ' ') {
            if (selectedIndex >= 0 && selectedIndex < domOrderedPrompts.length) {
                const prompt = domOrderedPrompts[selectedIndex];
                navigator.clipboard.writeText(prompt.text).catch(() => {});
                showPromptsFeedback(`Copied: ${prompt.name}`, '#4ade80');
                if (clipTimeout) clearTimeout(clipTimeout);
                clipTimeout = setTimeout(() => {
                    if (isFallback) closeFallback();
                    else { exitPromptsMode(); }
                }, 500);
            }
            e.preventDefault();
        }
        return;
    }

    if (pendingCommand) {
        if (pendingCommand === 'save_prompt_empty') {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
            return;
        }
        if (e.key === 'Enter') {
            const name = input.value.trim();
            isNavigating = true;
            if (focusInterval) clearInterval(focusInterval);
            chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: pendingCommand, args: name }).catch(() => {});
            pendingCommand = null;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... try !yt, !gh, or > for tools";
            if (isFallback) closeFallback();
            else {
                isNavigating = false;
                handleSearch();
            }
            e.preventDefault();
        }
        return;
    }

    if (domOrderedResults.length === 0 && e.key !== 'ArrowRight' && e.key !== 'Backspace' && e.key !== 'Tab') return;

    if (e.key === 'Tab') {
        e.preventDefault();
        cycleEngine(e.shiftKey ? -1 : 1);
        return;
    }

    if (e.key === 'ArrowRight' && input.value === '' && !isActionMode) {
        isActionMode = true;
        actionModeIndicator.classList.add('visible');
        handleSearch();
        e.preventDefault();
        return;
    }

    if (e.key === 'Backspace' && isActionMode && input.value === '') {
        isActionMode = false;
        actionModeIndicator.classList.remove('visible');
        handleSearch();
        e.preventDefault();
        return;
    }

    if (e.key === 'ArrowDown') {
        updateSelection((selectedIndex + 1) % domOrderedResults.length);
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        updateSelection(selectedIndex - 1 < 0 ? domOrderedResults.length - 1 : selectedIndex - 1);
        e.preventDefault();
    } else if (e.key === 'Enter') {
        const currentQuery = getSearchQuery();
        if (!isActionMode && currentQuery && currentQuery !== lastSearchedQuery) {
            chrome.runtime.sendMessage({ action: 'open-query', query: currentQuery, ...(engineOverride ? { engine: engineOverride } : {}) }).catch(() => {});
            if (isFallback) closeFallback();
            else {
                input.value = '';
                handleSearch();
            }
            e.preventDefault();
            return;
        }

        if (selectedIndex >= 0 && selectedIndex < domOrderedResults.length) {
            activateResult(domOrderedResults[selectedIndex]);
        }
        e.preventDefault();
    }
}

function activateResult(result) {
    if (result.type === 'action') {
        if (result.id === 'show_prompts') {
            isPromptsMode = true;
            cachedAllPrompts = [];
            input.value = '';
            input.placeholder = 'Loading prompts...';
            renderPromptsResults([]);
            chrome.runtime.sendMessage({ action: 'get-prompts' }, (response) => {
                if (chrome.runtime.lastError || !response?.prompts) {
                    renderPromptsResults([]);
                    input.placeholder = 'Filter prompts (name or text)...';
                    return;
                }
                cachedAllPrompts = response.prompts;
                input.placeholder = 'Filter prompts (name or text)...';
                renderPromptsResults(cachedAllPrompts);
            });
            return;
        }

        if (result.id === 'save_prompt') {
            let selection = '';
            try { selection = window.getSelection() ? window.getSelection().toString() : ''; }
            catch (e) { selection = ''; }
            selection = (selection || '').trim();
            resultsContainer.classList.remove('prompts-grid');
            resultsContainer.innerHTML = '';
            if (!selection) {
                resultsContainer.classList.add('has-items');
                resultsContainer.innerHTML = `<div class="empty-state"><div class="empty-title">No text selected</div><div class="empty-hint">Select text on the page first, then try &gt;save prompt again</div></div>`;
                input.value = '';
                input.placeholder = 'Select text on the page first, then try again';
                pendingCommand = 'save_prompt_empty';
                input.focus();
                return;
            }
            pendingCommand = 'save_prompt_data';
            pendingPromptText = selection;
            input.value = '';
            input.placeholder = 'Name for this prompt...';
            input.focus();
            return;
        }

        if (result.id === 'save_workspace' || result.id === 'save_group' || result.id === 'stash_group' || result.id === 'set_baseline_url' || result.id === 'save_window_all' || result.id === 'set_clean_time' || result.id === 'set_hibernate_time') {
            pendingCommand = result.id;
            input.value = '';
            const promptMap = {
                'save_workspace': 'Enter name for this Workspace Set...',
                'save_window_all': 'Enter name for this Complete Set...',
                'save_group': 'Enter name for this Group Set...',
                'stash_group': 'Enter name for stashed Group...',
                'set_baseline_url': 'Enter/Paste new persistent URL for this tab...',
                'set_clean_time': 'Enter close time (e.g., 30m, 2h, 12h)...',
                'set_hibernate_time': 'Enter sleep time (e.g., 10m, 1h)...'
            };
            input.placeholder = `${promptMap[result.id]} (or Esc to cancel)`;
            resultsContainer.innerHTML = '';
            input.focus();
            return;
        }

        isNavigating = true;
        if (focusInterval) clearInterval(focusInterval);

        if (result.id.startsWith('copy_clipboard|')) {
            const text = result.id.split('|')[1];
            navigator.clipboard.writeText(text).catch(() => {});
            input.value = `Copied: ${text}`;
            input.style.color = '#4ade80';
            if (clipTimeout) clearTimeout(clipTimeout);
            clipTimeout = setTimeout(() => {
                input.value = '';
                input.style.color = '';
                isNavigating = false;
                handleSearch();
            }, 500);
            return;
        }

        // Prompt-style actions rewrite the query locally instead of round-
        // tripping through the background (ntp.js has no onMessage listener, so
        // a background-sent update-palette-query message would never arrive).
        if (result.id === 'summon_set_prompt' || result.id === 'replace_workspace_prompt' || result.id === 'open_bookmarks_folder_prompt') {
            // Action mode strips '>' from input.value and shows a separate badge
            // (getSearchQuery re-prepends it at search time). So the rewrite value
            // must NOT include '>' — enter action mode programmatically instead.
            const rewriteMap = {
                'summon_set_prompt': 'summon ',
                'replace_workspace_prompt': 'replace ',
                'open_bookmarks_folder_prompt': 'open folder '
            };
            isActionMode = true;
            actionModeIndicator.classList.add('visible');
            input.value = rewriteMap[result.id];
            input.focus();
            setTimeout(() => { input.selectionStart = input.selectionEnd = input.value.length; }, 0);
            handleSearch();
            return;
        }

        chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: result.id }).catch(() => {});
        if (isFallback) closeFallback();
        else {
            input.value = '';
            isNavigating = false;
            handleSearch();
        }
    } else if (result.type === 'tab') {
        isNavigating = true;
        if (focusInterval) clearInterval(focusInterval);
        chrome.runtime.sendMessage({ action: 'switch-to-tab', tabId: result.id, windowId: result.windowId }, () => {
            if (isFallback) closeFallback();
            else {
                input.value = '';
                isNavigating = false;
                handleSearch();
            }
        });
    } else {
        isNavigating = true;
        if (focusInterval) clearInterval(focusInterval);
        chrome.runtime.sendMessage({ action: 'open-url', url: result.url }).catch(() => {});
        if (isFallback) closeFallback();
        else {
            input.value = '';
            isNavigating = false;
            handleSearch();
        }
    }
}
