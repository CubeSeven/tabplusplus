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
//  Profiles Logic
// ─────────────────────────────────────────────
function loadAndRenderProfiles() {
  chrome.runtime.sendMessage({ action: 'get-profiles' }, (response) => {
    if (!response || !response.profiles) return;
    renderProfileList(response.profiles);
  });
}

function renderProfileList(profiles) {
  const container = document.getElementById('profile-list-container');
  container.innerHTML = '';
  
  const profileKeys = Object.keys(profiles);
  if (profileKeys.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 20px; color:#aaa; font-size: 11px;">No profiles saved yet.</div>';
    return;
  }

  profileKeys.forEach(name => {
    const tabsCount = profiles[name].length;
    
    const item = document.createElement('div');
    item.className = 'profile-item';
    
    const title = document.createElement('div');
    title.className = 'profile-name';
    title.textContent = name;
    
    // Add subtitle for tabs count
    const subtitle = document.createElement('div');
    subtitle.style.fontSize = '9px';
    subtitle.style.color = '#999';
    subtitle.style.fontWeight = 'normal';
    subtitle.textContent = `${tabsCount} protected tab${tabsCount === 1 ? '' : 's'}`;
    title.appendChild(subtitle);
    
    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    
    const launchBtn = document.createElement('button');
    launchBtn.className = 'btn btn-light';
    launchBtn.textContent = 'Launch';
    launchBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: 'launch-profile', name: name }, () => {
        window.close(); // Close popup after launch
      });
    };
    
    const updateBtn = document.createElement('button');
    updateBtn.className = 'btn-icon';
    updateBtn.title = 'Overwrite with current window';
    updateBtn.innerHTML = '↻'; // Replace icon
    updateBtn.onclick = () => {
      if(confirm(`Overwrite profile "${name}" with your current window's pinned and grouped tabs?`)) {
        chrome.runtime.sendMessage({ action: 'save-profile', name: name }, (res) => {
          if(res && res.success) renderProfileList(res.profiles);
        });
      }
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.title = 'Delete profile';
    deleteBtn.innerHTML = '×'; // Replace icon
    deleteBtn.onclick = () => {
      if(confirm(`Delete profile "${name}"?`)) {
        chrome.runtime.sendMessage({ action: 'delete-profile', name: name }, (res) => {
          if(res && res.success) renderProfileList(res.profiles);
        });
      }
    };
    
    actions.appendChild(launchBtn);
    actions.appendChild(updateBtn);
    actions.appendChild(deleteBtn);
    
    item.appendChild(title);
    item.appendChild(actions);
    
    container.appendChild(item);
  });
}

// Set up Profile Save button
document.getElementById('save-profile-btn').addEventListener('click', () => {
  const input = document.getElementById('new-profile-name');
  const name = input.value.trim();
  if (!name) return;
  
  chrome.runtime.sendMessage({ action: 'save-profile', name: name }, (response) => {
    if (response && response.success) {
      input.value = '';
      renderProfileList(response.profiles);
    }
  });
});

// ─────────────────────────────────────────────
//  Export / Import Logic
// ─────────────────────────────────────────────
document.getElementById('export-profiles-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'get-profiles' }, (response) => {
    if (!response || !response.profiles) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(response.profiles, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "tabs_plus_plus_profiles.json");
    dlAnchorElem.click();
  });
});

const importInput = document.getElementById('import-file');
document.getElementById('import-profiles-btn').addEventListener('click', () => {
  importInput.click();
});

importInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      chrome.runtime.sendMessage({ action: 'import-profiles', profiles: parsed }, (response) => {
        if (response && response.success) {
          renderProfileList(response.profiles);
        } else {
          alert('Failed to import profiles. Invalid file format.');
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
loadAndRenderProfiles();
