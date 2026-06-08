// ─────────────────────────────────────────────
//  Feature definitions — add new features here
// ─────────────────────────────────────────────
const FEATURES = [
  {
    id: 'protectPinned',
    title: 'Pinned Protection',
    description: 'Auto-recreates pinned tabs if closed.',
    default: true,
    badge: 'Core',
    category: 'Guard',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
  },
  {
    id: 'protectGrouped',
    title: 'Group Guard',
    description: 'Keeps grouped tabs alive and persistent.',
    default: true,
    badge: 'Core',
    category: 'Guard',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
  },
  {
    id: 'enablePalette',
    title: 'Command Palette',
    description: 'Search tabs & history instantly.',
    default: true,
    badge: 'Core',
    category: 'Tools',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M6 8h.01"></path><path d="M10 8h.01"></path><path d="M14 8h.01"></path><path d="M18 8h.01"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path><path d="M7 16h10"></path></svg>`
  },
  {
    id: 'enableAutoGroup',
    title: 'Smart Groups',
    description: 'Auto-sorts tabs by domain category.',
    default: false,
    badge: null,
    category: 'Tools',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`
  },
  {
    id: 'enableAutoArchive',
    title: 'Ruthless Clean',
    description: 'Auto-closes idle tabs.',
    default: false,
    badge: null,
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
  },
  {
    id: 'focusNTPOnClose',
    title: 'Focus Guard',
    description: 'Always land on NTP when closing tabs.',
    default: false,
    badge: null,
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`
  },
  {
    id: 'autoCollapseGroups',
    title: 'Auto-Collapse',
    description: 'Collapse groups when inactive to save space.',
    default: false,
    badge: null,
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h16"/><path d="M4 10h16"/><path d="M12 6v12"/><path d="M12 6l-3 3"/><path d="M12 6l3 3"/><path d="M12 18l-3-3"/><path d="M12 18l3-3"/></svg>`
  },
  {
    id: 'enableAutoHibernate',
    title: 'Smart Hibernate',
    description: 'Auto-sleeps idle tabs independently.',
    default: false,
    badge: null,
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"/><path d="M12 2v20"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/></svg>`
  },
  {
    id: 'autoPeekCrossDomain',
    title: 'Cross-Domain Peek',
    description: 'Auto-open any cross-domain link in a peek window.',
    default: false,
    badge: null,
    category: 'Guard',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
  },
  {
    id: 'useDefaultNtp',
    title: 'Use Browser\'s New Tab Page',
    description: 'Show browser default instead of the Tab++ new tab page.',
    default: false,
    badge: null,
    category: 'Appearance',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`
  }
];

// ─────────────────────────────────────────────
//  Tools definitions
// ─────────────────────────────────────────────
const TOOLS = [
  {
    id: 'pip-player',
    title: 'PiP Player',
    description: 'Pop out any video into a floating window.',
    badge: null,
    category: 'Media',
    settingId: 'autoPiP',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><rect x="13" y="11" width="7" height="4" rx="1" ry="1"></rect></svg>`
  },
  {
    id: 'color-eyedropper',
    title: 'Eyedropper',
    description: 'Pick any color from the screen via the Command Palette.',
    badge: null,
    category: 'Tools',
    settingId: 'enableEyedropper',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5.5l-4-4a2.5 2.5 0 0 0-3.5 0L3 12.5V21h8.5l10.5-10.5a2.5 2.5 0 0 0 0-3.5z"/><path d="M14.5 2.5l7 7"/></svg>`
  },
  {
    id: 'full-screenshot',
    title: 'Full-Page Screenshot',
    description: 'Capture the entire scrollable page as a PNG.',
    badge: 'NEW',
    category: 'Tools',
    settingId: 'enableScreenshot',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9h18M9 21V9"/></svg>`
  },
  {
    id: 'unit-converter',
    title: 'Smart Converter',
    description: 'Auto-convert units, math, and colors in the Palette.',
    badge: 'NEW',
    category: 'Tools',
    settingId: 'enableUnitConverter',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v18M16 3v18M3 8h18M3 16h18"/></svg>`
  },
  {
    id: 'pomo-timer',
    title: 'Pomodoro Timer',
    description: 'Focus/Break timers with desktop notifications.',
    badge: 'NEW',
    category: 'Focus',
    settingId: 'enablePomo',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
  },
  {
    id: 'focus-view',
    title: 'Focus View',
    description: 'Strip distractions and read in a clean, minimal interface.',
    badge: 'NEW',
    category: 'Tools',
    settingId: 'enableFocusView',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`
  },
  {
    id: 'extract-media',
    title: 'Extract Media Assets',
    description: 'Download images and videos directly from the page.',
    badge: 'NEW',
    category: 'Tools',
    settingId: 'enableMediaExtractor',
    actionId: 'extract_media',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
  },
  {
    id: 'volume-control',
    title: 'Tab Volume Control',
    description: 'Set volume of the current tab via the Command Palette.',
    badge: 'NEW',
    category: 'Media',
    settingId: 'enableVolumeControl',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
  }
];

// ─────────────────────────────────────────────
//  Render feature cards (Grid)
// ─────────────────────────────────────────────
function renderFeatures(settings, filter = '') {
  const container = document.getElementById('feature-list');
  container.innerHTML = '';

  const filtered = FEATURES.filter(f => 
    f.title.toLowerCase().includes(filter.toLowerCase()) || 
    f.description.toLowerCase().includes(filter.toLowerCase())
  );

  filtered.forEach((feature) => {
    const isEnabled = settings[feature.id] ?? feature.default;

    // Card
    const card = document.createElement('div');
    card.className = 'feature-card' + (isEnabled ? ' is-on' : '');
    
    // Header Row (Icon + Toggle)
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';

    const iconBox = document.createElement('div');
    iconBox.className = 'card-icon';
    iconBox.innerHTML = feature.icon;

    const toggleWrap = document.createElement('div');
    toggleWrap.className = 'toggle-wrap' + (isEnabled ? ' is-on' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `toggle-${feature.id}`;
    checkbox.checked = isEnabled;

    const track = document.createElement('div');
    track.className = 'toggle-track';
    const thumb = document.createElement('div');
    thumb.className = 'toggle-thumb';

    track.appendChild(thumb);
    toggleWrap.appendChild(checkbox);
    toggleWrap.appendChild(track);

    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.alignItems = 'center';

    let badgeText = feature.badge;
    if (feature.id === 'enableAutoArchive') {
      badgeText = settings.archiveThresholdRaw || '12h';
    } else if (feature.id === 'enableAutoHibernate') {
      badgeText = settings.hibernateThresholdRaw || '1h';
    }

    if (badgeText) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = badgeText;
      rightGroup.appendChild(badge);
    }

    rightGroup.appendChild(toggleWrap);
    cardHeader.appendChild(iconBox);
    cardHeader.appendChild(rightGroup);

    // Title & Desc
    const title = document.createElement('div');
    title.className = 'feature-title';
    title.textContent = feature.title;

    const desc = document.createElement('div');
    desc.className = 'feature-desc';
    let text = feature.description;
    if (feature.id === 'enableAutoArchive' && settings.archiveThresholdRaw) {
        text = `Auto-closes idle tabs after ${settings.archiveThresholdRaw}.`;
    }
    desc.textContent = text;

    card.appendChild(cardHeader);
    card.appendChild(title);
    card.appendChild(desc);

    // Toggle interaction
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      const newState = checkbox.checked;
      if (newState) {
        card.classList.add('is-on');
        toggleWrap.classList.add('is-on');
      } else {
        card.classList.remove('is-on');
        toggleWrap.classList.remove('is-on');
      }
      saveSettings();
    });

    // Clicking card also toggles it
    card.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      checkbox.click();
    });

    container.appendChild(card);
  });
}

function renderTools(settings, filter = '') {
  const container = document.getElementById('tools-list');
  if (!container) return;
  container.innerHTML = '';

  const paletteOff = settings.enablePalette === false;

  if (paletteOff) {
    container.innerHTML = '<div class="palette-disabled-message">Enable Command Palette to use tools</div>';
  }

  const filtered = TOOLS.filter(t => 
    t.title.toLowerCase().includes(filter.toLowerCase()) || 
    t.description.toLowerCase().includes(filter.toLowerCase())
  );

  filtered.forEach((tool) => {
    const isEnabled = tool.settingId ? (settings[tool.settingId] ?? true) : false;

    const card = document.createElement('div');
    let cardClass = 'feature-card';
    if (tool.settingId && isEnabled) cardClass += ' is-on';
    if (paletteOff) cardClass += ' palette-disabled';
    card.className = cardClass;
    
    // Header Row (Icon + Badge/Toggle)
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';

    const iconBox = document.createElement('div');
    iconBox.className = 'card-icon';
    iconBox.innerHTML = tool.icon;

    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.alignItems = 'center';

    if (tool.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = tool.badge;
      rightGroup.appendChild(badge);
    }

    // Add toggle if it has a settingId
    let checkbox = null;
    let toggleWrap = null;
    if (tool.settingId) {
      toggleWrap = document.createElement('div');
      toggleWrap.className = 'toggle-wrap' + (isEnabled ? ' is-on' : '');

      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `toggle-${tool.settingId}`;
      checkbox.checked = isEnabled;
      if (paletteOff) checkbox.disabled = true;

      const track = document.createElement('div');
      track.className = 'toggle-track';
      const thumb = document.createElement('div');
      thumb.className = 'toggle-thumb';

      track.appendChild(thumb);
      toggleWrap.appendChild(checkbox);
      toggleWrap.appendChild(track);
      rightGroup.appendChild(toggleWrap);

      if (!paletteOff) {
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          const newState = checkbox.checked;
          if (newState) {
            card.classList.add('is-on');
            toggleWrap.classList.add('is-on');
          } else {
            card.classList.remove('is-on');
            toggleWrap.classList.remove('is-on');
          }
          saveSettings();
        });
      }
    }

    cardHeader.appendChild(iconBox);
    cardHeader.appendChild(rightGroup);

    // Title & Desc
    const title = document.createElement('div');
    title.className = 'feature-title';
    title.textContent = tool.title;

    const desc = document.createElement('div');
    desc.className = 'feature-desc';
    desc.textContent = tool.description;

    card.appendChild(cardHeader);
    card.appendChild(title);
    card.appendChild(desc);

    // Click interaction
    card.addEventListener('click', (e) => {
      if (paletteOff) return;

      // Let the toggle's own change event handle direct toggle clicks
      if (e.target.type === 'checkbox' || (e.target.closest && e.target.closest('.toggle-wrap'))) return;

      if (checkbox) {
        if (checkbox.checked && tool.actionId) {
          // Tool is ON and has an action — fire the action
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle-palette', forceAction: tool.actionId }).catch(() => {});
            }
          });
          window.close();
        } else {
          // Tool is OFF — just enable it, don't fire the action
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change'));
        }
      } else if (tool.actionId) {
        chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: tool.actionId });
        window.close();
      }
    });

    container.appendChild(card);
  });
}

// ─────────────────────────────────────────────
//  Search Logic (Unified & Toggleable)
// ─────────────────────────────────────────────
const searchTrigger = document.getElementById('search-trigger');
const searchRow = document.getElementById('search-row');
const globalSearchInput = document.getElementById('global-search');

searchTrigger.addEventListener('click', () => {
  const isActive = searchRow.classList.toggle('active');
  searchTrigger.classList.toggle('active', isActive);
  
  if (isActive) {
    globalSearchInput.focus();
  } else {
    // Clear search when closing
    globalSearchInput.value = '';
    triggerSearch('');
  }
});

globalSearchInput.addEventListener('input', (e) => {
  triggerSearch(e.target.value);
});

function triggerSearch(query) {
  chrome.storage.local.get({ settings: getDefaults() }, (data) => {
    // Always render both or detect active tab? 
    // Let's render both to keep it simple, or only active if performance is an issue.
    renderFeatures(data.settings, query);
    renderTools(data.settings, query);
  });
}

// ─────────────────────────────────────────────
//  Load & Save
// ─────────────────────────────────────────────
// NOTE: Keep in sync with DEFAULT_SETTINGS in constants.js
function getDefaults() {
  const defaults = FEATURES.reduce((acc, f) => {
    acc[f.id] = f.default;
    return acc;
  }, {});
  
  defaults.archiveThresholdRaw = '12h';
  defaults.hibernateThresholdRaw = '1h';
  defaults.enableMediaExtractor = true;
  defaults.enableVolumeControl = true;
  defaults.autoPiP = false;
  defaults.enableEyedropper = true;
  defaults.enableScreenshot = true;
  defaults.enableUnitConverter = true;
  defaults.enablePomo = true;
  defaults.enableFocusView = true;
  defaults.baseRemSize = 16;
  defaults.ntpBgDesign = 0;
  defaults.timeFormat = '24h';
  defaults.showClock = true;
  defaults.searchEngine = 'google';
  defaults.useDefaultNtp = false;
  defaults.peekExcludedDomains = ['google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com', 'perplexity.ai', 'x.com', 'twitter.com', 'reddit.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'twitch.tv', 'vimeo.com', 'news.ycombinator.com', 'amazon.com', 'ebay.com'];
  
  return defaults;
}

function saveSettings() {
  chrome.storage.local.get(['settings'], (data) => {
    const settings = data.settings || getDefaults();
    FEATURES.forEach((feature) => {
      const el = document.getElementById(`toggle-${feature.id}`);
      if (el) settings[feature.id] = el.checked;
    });
    TOOLS.forEach((tool) => {
      if (tool.settingId) {
        const el = document.getElementById(`toggle-${tool.settingId}`);
        if (el) settings[tool.settingId] = el.checked;
      }
    });
    chrome.storage.local.set({ settings });
    chrome.runtime.sendMessage({ action: 'update-settings', settings }).catch(() => {});
  });
}

// Init
const manifest = chrome.runtime.getManifest();
const versionDisplay = document.getElementById('version-display');
if (versionDisplay) versionDisplay.textContent = `v${manifest.version}`;

chrome.storage.local.get({ settings: getDefaults(), tipDismissed: false }, (data) => {
  const merged = { ...getDefaults(), ...data.settings };
  renderFeatures(merged);
  renderTools(merged);

  // Hide tip footer if already dismissed
  if (data.tipDismissed) {
    const tipFooter = document.getElementById('tip-footer');
    if (tipFooter) tipFooter.style.display = 'none';
  }
});

// Vault restore footer
chrome.storage.local.get(['vault'], (data) => {
  if (data.vault && data.vault.length > 0) {
    document.getElementById('vault-container').style.display = 'flex';
    const vaultText = document.getElementById('vault-text');
    if (vaultText) vaultText.textContent = `${data.vault.length} protected tabs saved`;

    document.getElementById('restore-vault-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'restore-vault' }, () => {
        document.getElementById('vault-container').style.display = 'none';
      });
    });
    document.getElementById('clear-vault-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'clear-vault' }, () => {
        document.getElementById('vault-container').style.display = 'none';
      });
    });
  }
});

// Tip footer buttons
const tipCloseBtn = document.getElementById('tip-close-btn');
if (tipCloseBtn) {
  tipCloseBtn.addEventListener('click', () => {
    document.getElementById('tip-footer').style.display = 'none';
    chrome.storage.local.set({ tipDismissed: true });
  });
}
const tipFixBtn = document.getElementById('tip-fix-btn');
if (tipFixBtn) {
  tipFixBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/onStartup' });
  });
}

// ─────────────────────────────────────────────
//  Tab Switching Logic
// ─────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all buttons and contents
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Add active class to clicked button
    btn.classList.add('active');

    // Show target content
    const targetId = btn.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');
    
    // Maintain search if search is active
    if (searchRow.classList.contains('active')) {
      triggerSearch(globalSearchInput.value);
    }
  });
});

// ─────────────────────────────────────────────
//  Sets Logic
// ─────────────────────────────────────────────
function loadAndRenderSets() {
  chrome.runtime.sendMessage({ action: 'get-sets' }, (response) => {
    if (response?.sets) {
        renderSetList(response.sets);
    }
  });
}

function renderSetList(sets) {
  const container = document.getElementById('set-list-container');
  container.innerHTML = '';
  
  const setKeys = Object.keys(sets);
  if (setKeys.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 20px; color:#aaa; font-size: 11px;">No sets saved yet.</div>';
    return;
  }

  setKeys.forEach(name => {
    const setObj = sets[name];
    const tabsCount = setObj.tabs ? setObj.tabs.length : 0;
    const typeLabel = setObj.type === 'group' ? 'GROUP' : 'WORKSPACE';
    
    const item = document.createElement('div');
    item.className = 'set-item';
    
    const title = document.createElement('div');
    title.className = 'set-name';
    title.textContent = name;
    
    const badge = document.createElement('span');
    badge.className = 'set-badge';
    badge.textContent = typeLabel;
    title.appendChild(badge);
    
    // Add subtitle for tabs count
    const subtitle = document.createElement('div');
    subtitle.style.fontSize = '9px';
    subtitle.style.color = '#999';
    subtitle.style.fontWeight = 'normal';
    subtitle.textContent = `${tabsCount} tab${tabsCount === 1 ? '' : 's'}`;
    title.appendChild(subtitle);
    
    const actions = document.createElement('div');
    actions.className = 'set-actions';
    
    const summonBtn = document.createElement('button');
    summonBtn.className = 'btn-icon';
    summonBtn.title = 'Summon into current window';
    summonBtn.innerHTML = '↓'; 
    summonBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: 'summon-set', name }, () => {
        window.close();
      });
    };

    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'btn-icon';
    replaceBtn.title = 'Replace current workspace';
    replaceBtn.innerHTML = '⇄';
    replaceBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: 'replace-set', name }, () => {
        window.close();
      });
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.title = 'Delete set';
    deleteBtn.innerHTML = '×';
    deleteBtn.onclick = () => {
      if (confirm(`Delete set "${name}"?`)) {
        chrome.runtime.sendMessage({ action: 'delete-set', name }, (res) => {
          if (res?.success) renderSetList(res.sets);
        });
      }
    };
    
    if (setObj.type === 'workspace') {
        actions.appendChild(replaceBtn);
        actions.appendChild(summonBtn);
    } else {
        actions.appendChild(summonBtn);
        actions.appendChild(replaceBtn);
    }
    
    actions.appendChild(deleteBtn);
    
    item.appendChild(title);
    item.appendChild(actions);
    
    container.appendChild(item);
  });
}

// Set up Set Save button
document.getElementById('save-set-btn').addEventListener('click', () => {
  const input = document.getElementById('new-set-name');
  const name = input.value.trim();
  if (!name) return;
  
  chrome.runtime.sendMessage({ action: 'save-set', setType: 'workspace', name: name }, (response) => {
    if (response && response.success) {
      input.value = '';
      renderSetList(response.sets);
    }
  });
});

// ─────────────────────────────────────────────
//  Export / Import Logic
// ─────────────────────────────────────────────
document.getElementById('export-sets-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'get-sets' }, (response) => {
    if (!response || !response.sets) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(response.sets, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "tabs_plus_plus_sets.json");
    dlAnchorElem.click();
  });
});

const importInput = document.getElementById('import-file');
document.getElementById('import-sets-btn').addEventListener('click', () => {
  importInput.click();
});

importInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      chrome.runtime.sendMessage({ action: 'import-sets', sets: parsed }, (response) => {
        if (response && response.success) {
          renderSetList(response.sets);
        }
      });
    } catch (err) {
      alert('Invalid JSON file. Please select a valid Tabs++ backup file.');
    }
    importInput.value = '';
  };
  reader.readAsText(file);
});

// Initial load
loadAndRenderSets();
