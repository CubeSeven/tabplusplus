// Maps a feature/settings toggle to the optional permission(s) it requires.
// Single source of truth — popup.js imports this to drive the just-in-time
// chrome.permissions.request() call when the user enables that toggle.
//
// We intentionally do NOT revoke permissions when a toggle is turned off.
// Rationale: the feature's code paths are gated on the setting, so a disabled
// feature never calls the API. Revocation via chrome.permissions.remove() is
// silently-failing and unverifiable, which would be dead-ish code; the user
// can always revoke manually from chrome://extensions if they care.
export const FEATURE_PERMISSIONS = {
    enablePomo: ['notifications'],
    enableMediaExtractor: ['downloads'],
    enableHistory: ['history'],
    enableBookmarks: ['bookmarks'],
    enableRecentlyClosed: ['sessions'],
    enablePanicClose: ['browsingData'],
};
