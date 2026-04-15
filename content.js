let palette = null;
let shadow = null;
let input = null;
let resultsContainer = null;
let isVisible = false;
let selectedIndex = -1;
let currentResults = [];
let lastSearchedQuery = "";
let isPaletteEnabled = false;
let isProtectedTab = false;
let pendingCommand = null;
let domOrderedResults = [];

// Initialize setting and listen for changes
chrome.storage.local.get({ settings: { enablePalette: false } }, (data) => {
    isPaletteEnabled = data.settings.enablePalette;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
        isPaletteEnabled = changes.settings.newValue.enablePalette;
    }
});



/* =========================================================================
   PALETTE & PEEK STYLES
   ========================================================================= */
const PALETTE_STYLES = `
    :host {
        --bg-color: rgba(22, 22, 26, 0.82);
        --text-color: #ffffff;
        --input-bg: transparent;
        --border-color: rgba(255, 255, 255, 0.08);
        --border-top: rgba(255, 255, 255, 0.18);
        --highlight: #0a84ff;
        --result-bg-hover: rgba(255, 255, 255, 0.06);
        --subtext: #8e8e93;
        --separator: rgba(255, 255, 255, 0.07);
    }

    @media (prefers-color-scheme: light) {
        :host {
            --bg-color: rgba(248, 248, 252, 0.82);
            --text-color: #1c1c1e;
            --input-bg: transparent;
            --border-color: rgba(0, 0, 0, 0.07);
            --border-top: rgba(255, 255, 255, 0.9);
            --highlight: #007aff;
            --result-bg-hover: rgba(0, 0, 0, 0.04);
            --subtext: #86868b;
            --separator: rgba(0, 0, 0, 0.06);
        }
    }

    .container {
        width: 750px;
        max-width: 95vw;
        position: relative;
        background:
            linear-gradient(180deg,
                rgba(255,255,255,0.04) 0%,
                rgba(255,255,255,0.0) 60%
            ),
            var(--bg-color);
        backdrop-filter: blur(48px) saturate(200%) brightness(0.95);
        -webkit-backdrop-filter: blur(48px) saturate(200%) brightness(0.95);
        border-radius: 20px;
        box-shadow:
            0 32px 72px rgba(0,0,0,0.55),
            0 0 0 1px rgba(255,255,255,0.06),
            inset 0 1px 0 var(--border-top),
            inset 0 -1px 0 rgba(0,0,0,0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transform: translateY(-40px) scale(0.96);
        transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .container.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
    }

    .input-wrapper {
        padding: 22px 28px;
        border-bottom: 1px solid var(--separator);
        box-shadow: 0 1px 0 rgba(255,255,255,0.03);
        display: flex;
        align-items: center;
        gap: 16px;
    }

    input {
        width: 100%;
        background: transparent;
        border: none;
        outline: none;
        font-size: 21px;
        color: var(--text-color);
        font-family: inherit;
        font-weight: 400;
        letter-spacing: -0.2px;
    }

    input::placeholder {
        color: var(--subtext);
        opacity: 0.5;
    }

    .results {
        max-height: 520px;
        overflow-y: auto;
        padding: 12px;
        display: none;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }

    .results::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
    }

    .results.has-items {
        display: block;
    }

    .result-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 16px;
        border-radius: 10px;
        cursor: pointer;
        color: var(--text-color);
        margin-bottom: 1px;
        overflow: hidden;
        transition: background 0.12s ease;
    }

    .result-item.selected {
        background: rgba(128, 128, 128, 0.15);
        box-shadow: inset 0 0 0 1px var(--border-color);
    }

    .result-item.selected .title {
        color: rgba(10, 132, 255, 0.85);
    }

    .result-item.selected .subtext,
    .result-item.selected .badge {
        color: var(--text-color);
        opacity: 0.8;
    }

    .icon {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(128, 128, 128, 0.1);
        color: var(--subtext);
        font-size: 18px;
    }
    
    .icon img {
        width: 24px;
        height: 24px;
        object-fit: contain;
    }

    .details {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        flex-grow: 1;
    }

    .title {
        font-size: 16px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
    }

    .subtext {
        font-size: 13px;
        color: var(--subtext);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
    }
    
    .badge {
        font-size: 10px;
        padding: 4px 10px;
        border-radius: 8px;
        background: rgba(128, 128, 128, 0.1);
        color: var(--subtext);
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.8px;
    }

    mark {
        background: transparent;
        color: rgba(10, 132, 255, 0.75);
        font-weight: 700;
        font-style: normal;
    }

    .section-header {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: var(--subtext);
        padding: 8px 16px 4px;
        pointer-events: none;
        user-select: none;
    }

    .icon-wrap {
        position: relative;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
    }

    .group-dot {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid var(--bg-color);
    }

    .empty-state {
        text-align: center;
        padding: 32px 16px;
        color: var(--subtext);
    }
    .empty-state .empty-icon { font-size: 32px; margin-bottom: 8px; }
    .empty-state .empty-title { font-size: 15px; font-weight: 600; color: var(--text-color); margin-bottom: 4px; }
    .empty-state .empty-hint { font-size: 13px; opacity: 0.6; }
`;

function createPalette() {
    if (palette) return;

    palette = document.createElement('div');
    palette.id = 'tabs-plus-plus-palette-host';
    palette.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: 2147483647;
        display: none;
        align-items: flex-start;
        justify-content: center;
        padding-top: 15vh;
        background: rgba(0,0,0,0.22);
        backdrop-filter: blur(12px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
    `;

    shadow = palette.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PALETTE_STYLES;

    const container = document.createElement('div');
    container.className = 'container';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'input-wrapper';
    
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search tabs, history, bookmarks... or try !yt, !gh, !mdn';
    input.spellcheck = false;
    input.autocomplete = 'off';
    
    inputWrapper.appendChild(input);

    resultsContainer = document.createElement('div');
    resultsContainer.className = 'results';

    container.appendChild(inputWrapper);
    container.appendChild(resultsContainer);


    shadow.appendChild(style);
    shadow.appendChild(container);

    document.documentElement.appendChild(palette);

    // Event Listeners
    input.addEventListener('input', debounce(handleSearch, 150));
    input.addEventListener('keydown', handleKeydown);

    // Refocus guard: some sites (e.g. Google) steal focus back after we open.
    // If the input loses focus while the palette is visible, grab it back.
    input.addEventListener('focusout', () => {
        if (isVisible) {
            // Small delay so legitimate blur-then-activate (Enter key) still works.
            setTimeout(() => {
                if (isVisible) input.focus();
            }, 50);
        }
    });

    // Prevent result clicks from blurring the input — mousedown preventDefault
    // means focus stays on the input, but click still fires normally.
    resultsContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    palette.addEventListener('click', (e) => {
        if (e.target === palette) hidePalette();
    });

    // Prevent key events inside the palette from triggering host page shortcuts
    // (e.g. typing "w" on DuckDuckGo, "/" on YouTube/GitHub)
    ['keydown', 'keyup', 'keypress'].forEach(eventType => {
        palette.addEventListener(eventType, (e) => {
            e.stopPropagation();
        });
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showPalette() {
    if (!palette) createPalette();
    palette.style.display = 'flex';
    isVisible = true;
    
    // Force reflow for animation
    palette.offsetHeight;
    shadow.querySelector('.container').classList.add('visible');
    
    input.value = '';
    currentResults = [];
    renderResults([]);

    // Multi-stage aggressive focus: some sites (Google, Twitter, Reddit) fight
    // hard to reclaim focus. We hit it at 0ms, 80ms, and 200ms to win.
    input.focus();
    setTimeout(() => { if (isVisible) input.focus(); }, 80);
    setTimeout(() => { if (isVisible) input.focus(); }, 200);
    
    handleSearch(); // Fetch initial tabs list
}

function hidePalette() {
    if (!isVisible || !palette) return;
    isVisible = false;
    shadow.querySelector('.container').classList.remove('visible');
    setTimeout(() => {
        if (!isVisible) {
            palette.style.display = 'none';
            // Aggressive Garbage Collection to free RAM
            if (input) {
                input.value = '';
                input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh";
            }
            if (resultsContainer) resultsContainer.innerHTML = '';
            currentResults = [];
            pendingCommand = null;
        }
    }, 150); // wait for animation
}

function togglePalette() {
    if (isVisible) hidePalette();
    else showPalette();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggle-palette') {
        togglePalette();
    }
    if (request.action === 'update-tab-status') {
        isProtectedTab = request.isProtected;
        sendResponse({ success: true });
        return true;
    }
});

async function handleSearch() {
    const query = input.value.trim();

    // Guard: context becomes invalid when the extension is reloaded
    // while this content script is still alive on an already-open tab.
    if (!chrome.runtime?.id) {
        hidePalette();
        return;
    }

    try {
        chrome.runtime.sendMessage({ action: 'search-items', query }, response => {
            if (chrome.runtime.lastError) {
                // Extension was reloaded mid-session — hide and bail out silently.
                hidePalette();
                return;
            }
            if (response && response.results) {
                lastSearchedQuery = query;
                currentResults = response.results;
                renderResults(currentResults);
            }
        });
    } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
            hidePalette();
        }
    }
}

const GROUP_COLORS = {
    blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04', green: '#34a853',
    pink: '#ff6d9f', purple: '#a142f4', cyan: '#24c1e0', orange: '#fa7b17', grey: '#9e9e9e'
};

const SECTION_ORDER = ['action', 'bang', 'navigate', 'search', 'tab', 'closed', 'bookmark', 'history'];
const SECTION_LABELS = {
    action: 'Actions',
    tab: 'Open Tabs',
    closed: 'Recently Closed',
    bookmark: 'Bookmarks',
    history: 'History'
};
const TYPE_FALLBACK = {
    action: '⚡', tab: '🌍', history: '🕒', bookmark: '⭐', bang: '⚡',
    search: '🔍', navigate: '↗️', closed: '🕒', default: '📄'
};

function getFaviconHtml(result) {
    const fallback = TYPE_FALLBACK[result.type] || TYPE_FALLBACK.default;
    if (result.favIconUrl && result.favIconUrl.startsWith('http')) {
        return `<img src="${result.favIconUrl}" onerror="this.outerHTML='${fallback}'" />`;
    }
    if (result.url) {
        try {
            const domain = new URL(result.url).hostname;
            return `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" onerror="this.outerHTML='${fallback}'" />`;
        } catch {}
    }
    return fallback;
}

function highlight(text, query) {
    if (!query || !text) return escapeHTML(text || '');
    const safe = escapeHTML(text);
    const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
}

function renderResults(results) {
    resultsContainer.innerHTML = '';
    resultsContainer.scrollTop = 0;
    currentResults = results;
    domOrderedResults = [];
    selectedIndex = results.length > 0 ? 0 : -1;

    if (results.length === 0) {
        resultsContainer.classList.add('has-items');
        const query = input ? input.value.trim() : '';
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <div class="empty-title">${query ? `No results for "${escapeHTML(query)}"` : 'Nothing to show'}</div>
                <div class="empty-hint">Try a bang like !yt, !gh, !px, or !gpt</div>
            </div>`;
        return;
    }

    resultsContainer.classList.add('has-items');
    const query = input ? input.value.trim() : '';

    // Group results by type, preserving SECTION_ORDER
    const grouped = {};
    SECTION_ORDER.forEach(t => grouped[t] = []);
    results.forEach((r, i) => {
        const key = SECTION_ORDER.includes(r.type) ? r.type : 'history';
        grouped[key].push({ result: r, index: i });
    });

    // Render sections
    SECTION_ORDER.forEach(type => {
        const items = grouped[type];
        if (!items || items.length === 0) return;

        const label = SECTION_LABELS[type];
        if (label) {
            const header = document.createElement('div');
            header.className = 'section-header';
            header.textContent = label;
            resultsContainer.appendChild(header);
        }

        items.forEach(({ result }) => {
            const domIndex = domOrderedResults.length;
            domOrderedResults.push(result);

            const item = document.createElement('div');
            item.className = 'result-item';
            if (domIndex === 0) item.classList.add('selected');

            // Favicon / icon
            const faviconContent = getFaviconHtml(result);
            const groupDot = (result.groupColor && GROUP_COLORS[result.groupColor])
                ? `<div class="group-dot" style="background:${GROUP_COLORS[result.groupColor]}"></div>`
                : '';
            const iconHtml = `<div class="icon-wrap"><div class="icon">${faviconContent}</div>${groupDot}</div>`;

            // Subtext
            let subtext = result.url || '';
            if (result.type === 'bang') subtext = result.label || result.bang;
            else if (result.type === 'search') subtext = 'Google Search';
            else if (result.type === 'navigate') subtext = 'Open URL';
            else if (result.type === 'closed') subtext = result.url || '';

            // Badge text
            const badge = result.type === 'navigate' ? 'link'
                : result.type === 'bang' ? result.bang
                : result.type === 'closed' ? 'closed'
                : result.type;

            item.innerHTML = `
                ${iconHtml}
                <div class="details">
                    <div class="title">${highlight(result.title, query)}</div>
                    <div class="subtext">${escapeHTML(subtext)}</div>
                </div>
                <div class="badge">${escapeHTML(badge)}</div>
            `;

            item.addEventListener('click', () => activateResult(result));
            item.addEventListener('mousemove', () => {
                if (selectedIndex !== domIndex) updateSelection(domIndex);
            });

            resultsContainer.appendChild(item);
            
            // Secure CSP resolution for favicon fallback
            const img = item.querySelector('img');
            if (img) img.addEventListener('error', () => img.style.display = 'none');
        });
    });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

function updateSelection(index) {
    const items = resultsContainer.querySelectorAll('.result-item');
    if (selectedIndex >= 0 && selectedIndex < items.length) {
        items[selectedIndex].classList.remove('selected');
    }
    selectedIndex = index;
    if (selectedIndex >= 0 && selectedIndex < items.length) {
        items[selectedIndex].classList.add('selected');
        items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function handleKeydown(e) {
    if (!isVisible) return;

    if (e.key === 'Escape') {
        if (pendingCommand) {
            pendingCommand = null;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh";
            handleSearch();
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        hidePalette();
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    if (pendingCommand) {
        if (e.key === 'Enter') {
            const name = input.value.trim();
            chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: pendingCommand, args: name });
            pendingCommand = null;
            hidePalette();
            e.preventDefault();
        }
        return;
    }

    if (domOrderedResults.length === 0 && e.key !== 'ArrowRight') return;

    if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && !input.value.startsWith('>')) {
        input.value = '>' + input.value;
        handleSearch();
        e.preventDefault();
        return;
    }

    if (e.key === 'ArrowDown') {
        let newIndex = selectedIndex + 1;
        if (newIndex >= domOrderedResults.length) newIndex = 0;
        updateSelection(newIndex);
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        let newIndex = selectedIndex - 1;
        if (newIndex < 0) newIndex = domOrderedResults.length - 1;
        updateSelection(newIndex);
        e.preventDefault();
    } else if (e.key === 'Enter') {
        const currentQuery = input.value.trim();
        if (currentQuery && currentQuery !== lastSearchedQuery) {
            chrome.runtime.sendMessage({ action: 'open-query', query: currentQuery });
            hidePalette();
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
        if (result.id === 'save_workspace' || result.id === 'save_group' || result.id === 'stash_group') {
            pendingCommand = result.id;
            input.value = '';
            input.placeholder = `Enter name for this Set (or Esc to cancel)...`;
            resultsContainer.innerHTML = '';
            return;
        }

        if (result.id.startsWith('summon_set_palette|') || result.id.startsWith('launch_set_palette|') || result.id.startsWith('delete_set_palette|')) {
            const parts = result.id.split('|');
            chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: parts[0], args: parts.slice(1).join('|') });
            hidePalette();
            return;
        }

        chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: result.id });
    } else if (result.type === 'tab') {
        chrome.runtime.sendMessage({ action: 'switch-to-tab', tabId: result.id, windowId: result.windowId });
    } else {
        // Includes 'search', 'navigate', 'history', 'bookmark', 'bang', 'closed'
        chrome.runtime.sendMessage({ action: 'open-url', url: result.url });
    }
    hidePalette();
}

// Intercept clicks for Transient Peek Windows
document.addEventListener('click', (e) => {
    // Ignore middle clicks or command/ctrl/alt clicks
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;

    const link = e.target.closest('a');
    if (!link || !link.href || !link.href.startsWith('http')) return;

    let isCrossDomain = false;
    try {
        isCrossDomain = new URL(link.href).hostname !== window.location.hostname;
    } catch(err) {}

    // Only Shift+Click, OR protected tab + cross domain. 
    if (e.shiftKey || (isProtectedTab && isCrossDomain)) {
        // Guard against extension reload destroying the background context
        if (!chrome.runtime?.id) return;
        
        try {
            e.preventDefault();
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: 'open-peek', url: link.href });
        } catch (err) {
            // Context invalidated, fail silently
        }
    }
}, true);

// Initialize Peek UI check
if (chrome.runtime?.id) {
    try {
        chrome.runtime.sendMessage({ action: 'check-peek-status' }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.isPeek) {
                injectPeekUI();
            }
        });
    } catch(e) {}
}

function injectPeekUI() {
    const host = document.createElement('div');
    host.id = 'tabs-plus-plus-peek-host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        .promote-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: rgba(28, 28, 30, 0.7);
            backdrop-filter: blur(16px) saturate(180%);
            -webkit-backdrop-filter: blur(16px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #ffffff;
            padding: 12px 20px;
            border-radius: 50px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 2147483647;
            text-decoration: none;
            letter-spacing: 0.3px;
        }

        @media (prefers-color-scheme: light) {
            .promote-btn {
                background: rgba(255, 255, 255, 0.75);
                color: #000000;
                border-color: rgba(0, 0, 0, 0.1);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            }
        }

        .promote-btn:hover {
            transform: translateY(-3px) scale(1.02);
            background: rgba(28, 28, 30, 0.9);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
            border-color: rgba(255, 255, 255, 0.3);
        }
        
        @media (prefers-color-scheme: light) {
             .promote-btn:hover {
                 background: rgba(255, 255, 255, 0.95);
                 box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
                 border-color: rgba(0, 0, 0, 0.2);
             }
        }

        .promote-btn:active {
            transform: translateY(1px) scale(0.98);
        }

        .icon {
            font-size: 16px;
            line-height: 1;
        }
    `;

    const btn = document.createElement('button');
    btn.className = 'promote-btn';
    btn.innerHTML = `<span class="icon">↗</span> Promote to Workspace`;
    
    btn.addEventListener('click', () => {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
        chrome.runtime.sendMessage({ action: 'promote-peek' });
    });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    document.documentElement.appendChild(host);
}
