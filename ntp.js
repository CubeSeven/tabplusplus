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
    }
});

let input, resultsContainer;
let currentResults = [];
let domOrderedResults = [];
let selectedIndex = -1;
let pendingCommand = null;
let focusInterval = null;
let isNavigating = false;
let lastSearchedQuery = '';
let cachedResultItems = [];

let cachedQueryRegex = null;
let cachedQueryForRegex = '';

function getQueryRegex(query) {
    if (!query) return null;
    if (query === cachedQueryForRegex) return cachedQueryRegex;
    const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cachedQueryRegex = new RegExp(`(${safeQ})`, 'gi');
    cachedQueryForRegex = query;
    return cachedQueryRegex;
}

function initDashboard() {
    updateClock();
    if (!showClock) {
        document.getElementById('clock')?.classList.add('hidden');
        document.getElementById('date')?.classList.add('hidden');
    }
    setInterval(updateClock, 1000);

    const paletteContainer = document.getElementById('palette-container');
    if (!enablePalette && paletteContainer) {
        paletteContainer.style.display = 'none';
        initBgPicker();
        return;
    }

    input = document.getElementById('search-input');
    input.value = '';
    resultsContainer = document.getElementById('results-container');

    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (!item) return;
        const idx = parseInt(item.getAttribute('data-idx'));
        if (idx >= 0 && idx < domOrderedResults.length) {
            activateResult(domOrderedResults[idx]);
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
            setTimeout(() => {
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

    trigger.addEventListener('click', () => picker.click());

    picker.addEventListener('input', (e) => {
        currentColor = e.target.value;
        applyBgColor(currentColor);
        chrome.storage.local.set({ ntpBgColor: currentColor });
    });

    if (switcher) {
        switcher.addEventListener('click', cycleBgDesign);
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
    chrome.storage.local.set({ ntpBgDesign: currentDesign });
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

function updateClock() {
    const now = new Date();
    const hour12 = timeFormat === '12h';
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date');

    if (hour12) {
        const parts = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(now);
        const timeStr = parts.filter(p => p.type === 'hour' || p.type === 'minute' || p.type === 'literal').map(p => p.value).join('');
        const periodStr = parts.find(p => p.type === 'dayPeriod')?.value || '';
        clockEl.innerHTML = `${timeStr} <span class="clock-period">${periodStr}</span>`;
    } else {
        clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

async function handleSearch() {
    if (pendingCommand) return;
    if (!chrome.runtime?.id) return;
    const query = input.value.trim();
    const sentQuery = query;
    chrome.runtime.sendMessage({ action: 'search-items', query }, response => {
        if (chrome.runtime.lastError) return;
        if (input.value.trim() !== sentQuery) return;
        if (response && response.results) {
            lastSearchedQuery = query;
            currentResults = response.results;
            renderResults(currentResults, query);
        }
    });
}

const GROUP_COLORS = {
    blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04', green: '#34a853',
    pink: '#ff6d9f', purple: '#a142f4', cyan: '#24c1e0', orange: '#fa7b17', grey: '#9e9e9e'
};

const SECTION_ORDER = ['action', 'bang', 'navigate', 'search', 'tab', 'closed', 'bookmark', 'history'];
const SECTION_LABELS = { action: 'Actions', tab: 'Open Tabs', closed: 'Recently Closed', bookmark: 'Bookmarks', history: 'History' };
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
    search: ICONS.search, navigate: ICONS.link, closed: ICONS.clock, default: ICONS.file
};

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

function getFaviconHtml(result) {
    if (result.favIconUrl && result.favIconUrl.startsWith('http')) {
        return `<img src="${result.favIconUrl}" data-type="${result.type}" />`;
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
        const itemHtml = `<div class="result-item${sel}" data-idx="${domIdx}">
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
    if (selectedIndex >= 0 && selectedIndex < cachedResultItems.length) cachedResultItems[selectedIndex].classList.remove('selected');
    selectedIndex = index;
    if (selectedIndex >= 0 && selectedIndex < cachedResultItems.length) {
        cachedResultItems[selectedIndex].classList.add('selected');
        cachedResultItems[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function handleKeydown(e) {
    if (e.key === 'Escape') {
        if (pendingCommand) {
            pendingCommand = null;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
            handleSearch();
            e.preventDefault();
            return;
        }
    }

    if (pendingCommand) {
        if (e.key === 'Enter') {
            const name = input.value.trim();
            isNavigating = true;
            if (focusInterval) clearInterval(focusInterval);
            chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: pendingCommand, args: name });
            pendingCommand = null;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
            if (isFallback) closeFallback();
            else {
                isNavigating = false;
                handleSearch();
            }
            e.preventDefault();
        }
        return;
    }

    if (domOrderedResults.length === 0 && e.key !== 'ArrowRight') return;

    if (e.key === 'ArrowRight' && input.value === '') {
        input.value = '>';
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
        const currentQuery = input.value.trim();
        if (currentQuery && currentQuery !== lastSearchedQuery) {
            chrome.runtime.sendMessage({ action: 'open-query', query: currentQuery });
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
            setTimeout(() => {
                input.value = '';
                input.style.color = '';
                isNavigating = false;
                handleSearch();
            }, 500);
            return;
        }

        chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: result.id });
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
        chrome.runtime.sendMessage({ action: 'open-url', url: result.url });
        if (isFallback) closeFallback();
        else {
            input.value = '';
            isNavigating = false;
            handleSearch();
        }
    }
}
