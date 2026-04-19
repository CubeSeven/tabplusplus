// ─────────────────────────────────────────────
//  Feature definitions — add new features here
// ─────────────────────────────────────────────
const FEATURES = [
  {
    id: 'protectPinned',
    title: 'Pinned Protection',
    description: 'Auto-recreates pinned tabs if closed.',
    default: true,
    badge: null,
    category: 'Guard',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
  },
  {
    id: 'protectGrouped',
    title: 'Group Guard',
    description: 'Keeps grouped tabs alive and persistent.',
    default: true,
    badge: null,
    category: 'Guard',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
  },
  {
    id: 'enablePalette',
    title: 'Command Palette',
    description: 'Search tabs & history instantly.',
    default: true,
    badge: 'Beta',
    category: 'Tools',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M6 8h.01"></path><path d="M10 8h.01"></path><path d="M14 8h.01"></path><path d="M18 8h.01"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path><path d="M7 16h10"></path></svg>`
  },
  {
    id: 'enableAutoGroup',
    title: 'Smart Groups',
    description: 'Auto-sorts tabs by domain category.',
    default: false,
    badge: 'Beta',
    category: 'Tools',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`
  },
  {
    id: 'enableAutoArchive',
    title: 'Ruthless Clean',
    description: 'Auto-closes idle tabs after 12h.',
    default: false,
    badge: 'Arc',
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
  },
  {
    id: 'focusNTPOnClose',
    title: 'Focus Guard',
    description: 'Always land on NTP when closing tabs.',
    default: false,
    badge: 'New',
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`
  },
  {
    id: 'autoCollapseGroups',
    title: 'Auto-Collapse',
    description: 'Collapse groups when inactive to save space.',
    default: false,
    badge: 'New',
    category: 'Logic',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h16"/><path d="M4 10h16"/><path d="M12 6v12"/><path d="M12 6l-3 3"/><path d="M12 6l3 3"/><path d="M12 18l-3-3"/><path d="M12 18l3-3"/></svg>`
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

    if (feature.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = feature.badge;
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
    desc.textContent = feature.description;

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

// Search interaction
document.getElementById('feature-search').addEventListener('input', (e) => {
  const query = e.target.value;
  chrome.storage.local.get({ settings: getDefaults() }, (data) => {
    renderFeatures(data.settings, query);
  });
});

// ─────────────────────────────────────────────
//  Load & Save
// ─────────────────────────────────────────────
function getDefaults() {
  return FEATURES.reduce((acc, f) => {
    acc[f.id] = f.default;
    return acc;
  }, {});
}

function saveSettings() {
  const settings = {};
  FEATURES.forEach((feature) => {
    const el = document.getElementById(`toggle-${feature.id}`);
    if (el) settings[feature.id] = el.checked;
  });
  chrome.storage.local.set({ settings });
}

// Init
chrome.storage.local.get({ settings: getDefaults(), tipDismissed: false }, (data) => {
  const merged = { ...getDefaults(), ...data.settings };
  renderFeatures(merged);
  
  // Hide tip if already dismissed
  if (data.tipDismissed) {
    document.getElementById('startup-alert').style.display = 'none';
  }
});

// Tip dismissal listener
document.getElementById('close-startup-tip').addEventListener('click', () => {
    document.getElementById('startup-alert').style.display = 'none';
    chrome.storage.local.set({ tipDismissed: true });
});

// Check for session vault
chrome.storage.local.get(['vault'], (data) => {
  if (data.vault && data.vault.length > 0) {
    document.getElementById('vault-container').style.display = 'flex';
    
    const vaultText = document.getElementById('vault-text');
    if (vaultText) {
        vaultText.textContent = `${data.vault.length} protected tabs saved`;
    }
    
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

// Startup Helper Button
document.getElementById('fix-startup-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/onStartup' });
});

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

    const launchBtn = document.createElement('button');
    launchBtn.className = 'btn-icon';
    launchBtn.title = 'Launch in new window';
    launchBtn.innerHTML = '↗';
    launchBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: 'launch-set', name }, () => {
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
        actions.appendChild(launchBtn);
        actions.appendChild(summonBtn);
    } else {
        actions.appendChild(summonBtn);
        actions.appendChild(launchBtn);
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
