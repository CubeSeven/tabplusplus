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
    description: 'Press Alt+Shift+K to search tabs, history, and bookmarks instantly.',
    default: true,
    badge: 'Beta',
  },
  {
    id: 'enableAutoGroup',
    title: 'Smart Workspace',
    description: 'Automatically sorts tabs into Dev, Design, AI, Media, News, or Social groups based on the domain.',
    default: false,
    badge: 'Beta',
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
