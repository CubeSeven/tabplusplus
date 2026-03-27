const pinnedCheckbox = document.getElementById('protectPinned');
const groupedCheckbox = document.getElementById('protectGrouped');

// Load Current Settings
chrome.storage.local.get({ settings: { protectPinned: true, protectGrouped: true } }, (data) => {
    pinnedCheckbox.checked = data.settings.protectPinned;
    groupedCheckbox.checked = data.settings.protectGrouped;
});

// Save Settings on Change
function saveSettings() {
    const settings = {
        protectPinned: pinnedCheckbox.checked,
        protectGrouped: groupedCheckbox.checked
    };
    
    chrome.storage.local.set({ settings });
}

pinnedCheckbox.addEventListener('change', saveSettings);
groupedCheckbox.addEventListener('change', saveSettings);
