// ─────────────────────────────────────────────
//  Feature definitions — add new features here
// ─────────────────────────────────────────────
const FEATURES = [
  {
    id: 'protectPinned',
    title: 'Protect Pinned Tabs',
    description: 'Automatically recreates pinned tabs if accidentally closed.',
    default: true,
    badge: null,
  },
  {
    id: 'protectGrouped',
    title: 'Protect Grouped Tabs',
    description: 'Keeps grouped tabs alive — they reopen at their original URL.',
    default: true,
    badge: null,
  },
  {
    id: 'enablePalette',
    title: 'Command Palette',
    description: 'Press Ctrl+Shift+K (Cmd+Shift+K Mac) to search tabs, history, and bookmarks instantly.',
    default: true,
    badge: 'Beta',
  },
  {
    id: 'enableAutoGroup',
    title: 'Smart Workspace',
    description: 'Automatically sorts tabs into Dev, Design, AI, Media, News, or Social groups based on the domain.',
    default: false,
    badge: 'Beta',
  },
  {
    id: 'enableAutoArchive',
    title: 'Ruthless Clean',
    description: 'Automatically closes unprotected tabs (not grouped, not pinned) that have not been viewed in 12 hours.',
    default: false,
    badge: 'Arc UI',
  },
  {
    id: 'focusNTPOnClose',
    title: 'Focus Guard',
    description: 'When you close the active tab, focus always lands on the New Tab Page instead of a neighbor.',
    default: false,
    badge: 'New',
  }
];

// ─────────────────────────────────────────────
//  Render feature cards
// ─────────────────────────────────────────────
function renderFeatures(settings) {
  const container = document.getElementById('feature-list');
  container.innerHTML = '';

  FEATURES.forEach((feature) => {
    const isEnabled = settings[feature.id] ?? feature.default;

    // Card
    const card = document.createElement('div');
    card.className = 'feature-card';

    // Info section
    const info = document.createElement('div');
    info.className = 'feature-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'feature-title-row';

    const title = document.createElement('span');
    title.className = 'feature-title';
    title.textContent = feature.title;
    titleRow.appendChild(title);

    if (feature.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = feature.badge;
      titleRow.appendChild(badge);
    }

    const desc = document.createElement('p');
    desc.className = 'feature-desc';
    desc.textContent = feature.description;

    info.appendChild(titleRow);
    info.appendChild(desc);

    if (feature.id === 'enablePalette') {
      const shortcutLink = document.createElement('a');
      shortcutLink.href = '#';
      shortcutLink.textContent = 'Change Shortcut ⚙️';
      shortcutLink.style.display = 'inline-block';
      shortcutLink.style.marginTop = '4px';
      shortcutLink.style.fontSize = '10px';
      shortcutLink.style.color = '#0a84ff';
      shortcutLink.style.textDecoration = 'none';
      shortcutLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      });
      info.appendChild(shortcutLink);
    }

    // Toggle
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

    // Toggle interaction
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        toggleWrap.classList.add('is-on');
      } else {
        toggleWrap.classList.remove('is-on');
      }
      saveSettings();
    });

    card.appendChild(info);
    card.appendChild(toggleWrap);
    container.appendChild(card);
  });
}

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
chrome.storage.local.get({ settings: getDefaults() }, (data) => {
  const merged = { ...getDefaults(), ...data.settings };
  renderFeatures(merged);
});

// Check for session vault
chrome.storage.local.get(['vault'], (data) => {
  if (data.vault && data.vault.length > 0) {
    document.getElementById('vault-container').style.display = 'block';
    
    const vaultText = document.getElementById('vault-text');
    if (vaultText) {
        vaultText.textContent = `Found ${data.vault.length} protected tab${data.vault.length > 1 ? 's' : ''} from your last session.`;
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
    if (!response || !response.sets) return;
    renderSetList(response.sets);
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
      chrome.runtime.sendMessage({ action: 'summon-set', name: name }, () => {
        window.close(); // Close popup after summon
      });
    };

    const launchBtn = document.createElement('button');
    launchBtn.className = 'btn-icon';
    launchBtn.title = 'Launch in new window';
    launchBtn.innerHTML = '↗';
    launchBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: 'launch-set', name: name }, () => {
        window.close(); // Close popup after launch
      });
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.title = 'Delete set';
    deleteBtn.innerHTML = '×';
    deleteBtn.onclick = () => {
      if(confirm(`Delete set "${name}"?`)) {
        chrome.runtime.sendMessage({ action: 'delete-set', name: name }, (res) => {
          if(res && res.success) renderSetList(res.sets);
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
        } else {
          alert('Failed to import sets. Invalid file format.');
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
