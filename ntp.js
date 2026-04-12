const urlParams = new URLSearchParams(window.location.search);
const isFallback = urlParams.get('action') === 'palette';

chrome.storage.local.get({ settings: { enablePalette: false } }, (data) => {
    initDashboard();
});

let input, resultsContainer;
let currentResults = [];
let selectedIndex = -1;

function initDashboard() {
    updateClock();
    setInterval(updateClock, 1000);

    input = document.getElementById('search-input');
    resultsContainer = document.getElementById('results-container');

    // Aggressively attempt to focus the input to fight Chrome's omnibox
    let attempts = 0;
    let focusInt = setInterval(() => {
        if (input) input.focus();
        attempts++;
        if (attempts > 15) clearInterval(focusInt); // Try for ~750ms
    }, 50);

    // Also focus if they click anywhere on the page
    document.addEventListener('click', (e) => {
        if (e.target !== input) input.focus();
    });

    input.addEventListener('input', debounce(handleSearch, 150));
    input.addEventListener('keydown', handleKeydown);

    // Initial search to populate open tabs
    handleSearch();
}

function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

async function handleSearch() {
    const query = input.value.trim();
    chrome.runtime.sendMessage({ action: 'search-items', query }, response => {
        if (chrome.runtime.lastError) return;
        if (response && response.results) {
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
const TYPE_FALLBACK = { action: '⚡', tab: '🌍', history: '🕒', bookmark: '⭐', bang: '⚡', search: '🔍', navigate: '↗️', closed: '🕒', default: '📄' };

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}

function highlight(text, query) {
    if (!query || !text) return escapeHTML(text || '');
    const safe = escapeHTML(text);
    const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
}

function getFaviconHtml(result) {
    if (result.favIconUrl && result.favIconUrl.startsWith('http')) {
        return `<img src="${result.favIconUrl}" />`;
    }
    if (result.url) {
        try {
            const domain = new URL(result.url).hostname;
            return `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" />`;
        } catch {}
    }
    return TYPE_FALLBACK[result.type] || TYPE_FALLBACK.default;
}

function renderResults(results, query) {
    resultsContainer.innerHTML = '';
    resultsContainer.scrollTop = 0;
    selectedIndex = results.length > 0 ? 0 : -1;

    if (results.length === 0) {
        resultsContainer.classList.add('has-items');
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <div class="empty-title">${query ? `No results for "${escapeHTML(query)}"` : 'Nothing to show'}</div>
                <div class="empty-hint">Try a bang like !yt, !gh, !px, or !gpt</div>
            </div>`;
        return;
    }

    resultsContainer.classList.add('has-items');

    const grouped = {};
    SECTION_ORDER.forEach(t => grouped[t] = []);
    results.forEach((r, i) => {
        const key = SECTION_ORDER.includes(r.type) ? r.type : 'history';
        grouped[key].push({ result: r, index: i });
    });

    SECTION_ORDER.forEach(type => {
        const items = grouped[type];
        if (!items || items.length === 0) return;

        if (SECTION_LABELS[type]) {
            const header = document.createElement('div');
            header.className = 'section-header';
            header.textContent = SECTION_LABELS[type];
            resultsContainer.appendChild(header);
        }

        items.forEach(({ result, index }) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            if (index === selectedIndex) item.classList.add('selected');

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

            item.innerHTML = `${iconHtml}<div class="details"><div class="title">${highlight(result.title, query)}</div><div class="subtext">${escapeHTML(subtext)}</div></div><div class="badge">${escapeHTML(badge)}</div>`;

            item.addEventListener('click', () => activateResult(result));
            item.addEventListener('mousemove', () => updateSelection(index));

            resultsContainer.appendChild(item);
            
            const img = item.querySelector('img');
            if (img) img.addEventListener('error', () => img.style.display = 'none');
        });
    });
}

function updateSelection(index) {
    const items = resultsContainer.querySelectorAll('.result-item');
    if (selectedIndex >= 0 && selectedIndex < items.length) items[selectedIndex].classList.remove('selected');
    selectedIndex = index;
    if (selectedIndex >= 0 && selectedIndex < items.length) {
        items[selectedIndex].classList.add('selected');
        items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function handleKeydown(e) {
    if (currentResults.length === 0) return;

    if (e.key === 'ArrowDown') {
        updateSelection((selectedIndex + 1) % currentResults.length);
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        updateSelection(selectedIndex - 1 < 0 ? currentResults.length - 1 : selectedIndex - 1);
        e.preventDefault();
    } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
            activateResult(currentResults[selectedIndex]);
        }
        e.preventDefault();
    }
}

function activateResult(result) {
    if (result.type === 'action') {
        chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: result.id });
        if (isFallback) window.close();
    } else if (result.type === 'tab') {
        chrome.runtime.sendMessage({ action: 'switch-to-tab', tabId: result.id, windowId: result.windowId }, () => {
            if (isFallback) window.close(); // Close the fallback tab if used as a router
        });
    } else {
        if (isFallback) {
             chrome.runtime.sendMessage({ action: 'open-url', url: result.url });
             window.close(); // Close fallback tab
        } else {
             // We are acting as a real new tab page, so reuse default behavior for navigating
             // If they command-clicked or something, we could open in BG, but standard is self-navigate
             window.location.href = result.url;
        }
    }
}
