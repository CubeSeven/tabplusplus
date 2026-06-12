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
let enableLiquidGlass = false;

chrome.storage.local.get({ settings: { enablePalette: true, showClock: true } }, (data) => {
    if (data.settings.timeFormat) timeFormat = data.settings.timeFormat;
    enablePalette = data.settings.enablePalette !== false;
    showClock = data.settings.showClock !== false;
    enableLiquidGlass = data.settings.enableLiquidGlass === true;
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

        const newLiquidGlass = changes.settings.newValue?.enableLiquidGlass;
        if (newLiquidGlass !== undefined && newLiquidGlass !== enableLiquidGlass) {
            enableLiquidGlass = newLiquidGlass;
            const container = document.getElementById('palette-container');
            if (container) {
                if (enableLiquidGlass) {
                    injectLiquidGlassFilter();
                    container.classList.add('liquid-glass');
                } else {
                    container.classList.remove('liquid-glass');
                }
            }
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

function generateLiquidGlassMap(width, height, radius, bezel, glassThickness) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const d = imgData.data;
    const cx = width / 2;
    const cy = height / 2;
    const hw = width / 2;
    const hh = height / 2;
    const bx = hw - radius;
    const by = hh - radius;
    const nGlass = 1.5;

    function surfaceSlope(t) {
        const u = Math.max(0.0001, Math.min(0.9999, 1 - t));
        return Math.pow(u, 3) / Math.pow(1 - Math.pow(u, 4), 0.75);
    }

    const rawDisp = new Float32Array(width * height * 2);
    let maxDisp = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = Math.abs(x - cx);
            const py = Math.abs(y - cy);

            let dist;
            if (px > bx && py > by) {
                dist = Math.sqrt((px - bx) ** 2 + (py - by) ** 2) - radius;
            } else {
                dist = Math.max(px - hw, py - hh);
            }

            const idx = (y * width + x) * 2;

            if (dist < 0 && dist > -bezel) {
                const t = Math.max(0, Math.min(1, -dist / bezel));
                const slope = surfaceSlope(t);
                const actualSlope = (glassThickness / bezel) * slope;
                const surfaceAngle = Math.atan(actualSlope);
                const sinTheta1 = Math.sin(Math.min(surfaceAngle, Math.PI / 2 - 0.001));
                const sinTheta2 = Math.min(sinTheta1 / nGlass, 0.999);
                const theta2 = Math.asin(sinTheta2);
                const dispMag = glassThickness * Math.tan(theta2);

                let nx = 0, ny = 0;
                if (px > bx && py > by) {
                    const cdx = px - bx;
                    const cdy = py - by;
                    const cl = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
                    nx = cdx / cl;
                    ny = cdy / cl;
                } else if (px > bx) {
                    nx = 1;
                } else if (py > by) {
                    ny = 1;
                } else {
                    if (px > hw - bezel) nx = 1;
                    else if (py > hh - bezel) ny = 1;
                }

                rawDisp[idx] = -nx * Math.sign(x - cx) * dispMag;
                rawDisp[idx + 1] = -ny * Math.sign(y - cy) * dispMag;

                const mag = Math.sqrt(rawDisp[idx] ** 2 + rawDisp[idx + 1] ** 2);
                if (mag > maxDisp) maxDisp = mag;
            } else {
                rawDisp[idx] = 0;
                rawDisp[idx + 1] = 0;
            }
        }
    }

    const scale = Math.max(maxDisp, 1);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 2;
            const i = (y * width + x) * 4;

            const dx = rawDisp[idx] / scale;
            const dy = rawDisp[idx + 1] / scale;

            d[i] = Math.max(0, Math.min(255, 128 + dx * 127));
            d[i + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
            d[i + 2] = 128;
            d[i + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), maxDisp: scale };
}

function injectLiquidGlassFilter() {
    if (document.getElementById('tabspp-liquid-glass-svg')) return;
    let dataUrl, maxDisp;
    try {
        ({ dataUrl, maxDisp } = generateLiquidGlassMap(750, 520, 20, 18, 55));
    } catch (e) { return; }
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.id = 'tabspp-liquid-glass-svg';
    svg.style.cssText = 'position:absolute;width:0;height:0;';
    const defs = document.createElementNS(svgNS, 'defs');
    const filter = document.createElementNS(svgNS, 'filter');
    filter.id = 'tabspp-liquid-glass';
    filter.setAttribute('x', '-20%');
    filter.setAttribute('y', '-20%');
    filter.setAttribute('width', '140%');
    filter.setAttribute('height', '140%');
    const feImage = document.createElementNS(svgNS, 'feImage');
    feImage.setAttribute('href', dataUrl);
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('width', '100%');
    feImage.setAttribute('height', '100%');
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('result', 'displacement_map');
    const feDisp = document.createElementNS(svgNS, 'feDisplacementMap');
    feDisp.setAttribute('in', 'SourceGraphic');
    feDisp.setAttribute('in2', 'displacement_map');
    feDisp.setAttribute('scale', String(Math.round(maxDisp * 1.5)));
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');
    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);
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

    if (enableLiquidGlass) {
        injectLiquidGlassFilter();
        paletteContainer.classList.add('liquid-glass');
    }

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
        chrome.storage.local.set({ ntpBgColor: currentColor }).catch(() => {});
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
    const sentQuery = query;
    chrome.runtime.sendMessage({ action: 'search-items', query }, response => {
        if (chrome.runtime.lastError) return;
        if (getSearchQuery() !== sentQuery) return;
        if (response && response.results) {
            lastSearchedQuery = query;
            currentResults = response.results;
            renderResults(currentResults, query);
        }
    });
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
            chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: pendingCommand, args: name }).catch(() => {});
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

    if (domOrderedResults.length === 0 && e.key !== 'ArrowRight' && e.key !== 'Backspace') return;

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
            chrome.runtime.sendMessage({ action: 'open-query', query: currentQuery }).catch(() => {});
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
            if (clipTimeout) clearTimeout(clipTimeout);
            clipTimeout = setTimeout(() => {
                input.value = '';
                input.style.color = '';
                isNavigating = false;
                handleSearch();
            }, 500);
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
