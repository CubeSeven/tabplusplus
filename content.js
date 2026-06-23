(function() {
if (window.__tabsppInjected) return;
window.__tabsppInjected = true;
let palette = null;

let shadow = null;
let input = null;
let resultsContainer = null;
let isVisible = false;
let selectedIndex = -1;
let currentResults = [];
let lastSearchedQuery = "";
let isPaletteEnabled = false;
let pendingCommand = null;
let domOrderedResults = [];
let blurOverlay = null;
let focusTimeouts = [];
let isActionMode = false;
let suppressActionModeToggle = false;
let actionModeIndicator = null;
let cachedResultItems = [];
let hidePaletteTimeout = null;
let hasStaggered = false;

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

// Media Extractor State
let isMediaMode = false;
let extractedMedia = [];
let selectedMediaIds = new Set();
let domOrderedMedia = [];
let cachedMediaItems = [];

// Prompt Vault State
let isPromptsMode = false;
let domOrderedPrompts = [];
let cachedAllPrompts = [];
let cachedPromptItems = [];
let pendingPromptText = '';
let cachedSelectionAtOpen = '';

// Pomodoro Timer State
let pomoHost = null;
let pomoInterval = null;

// Sync state once on load — after that pomo is push-only via 'update-pomo-timer' messages.
function syncPomoState() {
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: 'get-pomo-status' }, (response) => {
            if (response && response.pomoTimer) updatePomoUI(response.pomoTimer);
        });
    }
}
syncPomoState();


// Initialize settings and listen for changes
let settings = { enablePalette: false, autoPiP: true, enableEyedropper: true, autoPeekCrossDomain: false, peekExcludedDomains: [] };
chrome.storage.local.get({ settings: settings }, (data) => {
    if (data.settings) {
        settings = { ...settings, ...data.settings };
        isPaletteEnabled = settings.enablePalette;
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
        settings = { ...settings, ...changes.settings.newValue };
        isPaletteEnabled = settings.enablePalette;
        if (palette && shadow) {
            const container = shadow.querySelector('.container');
            if (container) {
                if (settings.enableLiquidGlass) {
                    container.classList.add('liquid-glass');
                } else {
                    container.classList.remove('liquid-glass');
                }
            }
        }
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
        --highlight: rgba(255,255,255,0.4);
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
            --highlight: rgba(0,0,0,0.3);
            --result-bg-hover: rgba(0, 0, 0, 0.04);
            --subtext: #86868b;
            --separator: rgba(0, 0, 0, 0.06);
        }
        mark { background: transparent; color: #ffffff; font-weight: 700; }
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
        border-radius: 28px;
        box-shadow:
            0 0 0 1px rgba(255,255,255,0.06),
            0 4px 16px rgba(0,0,0,0.25),
            0 32px 72px rgba(0,0,0,0.5),
            0 64px 128px rgba(0,0,0,0.3),
            inset 0 1px 0 var(--border-top),
            inset 0 -1px 0 rgba(0,0,0,0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transform: translateY(-40px) scale(0.96);
        transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: transform, opacity, backdrop-filter;
        backface-visibility: hidden;
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

    .action-indicator {
        display: none;
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        opacity: 0.7;
        align-items: center;
        justify-content: center;
    }

    .action-indicator.visible {
        display: flex;
    }

    .action-indicator svg {
        width: 30px;
        height: 30px;
        display: block;
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
        border-radius: 14px;
        cursor: pointer;
        color: var(--text-color);
        margin-bottom: 1px;
        overflow: hidden;
        position: relative;
        transition: background 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .result-item.selected {
        background: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(200,200,215,0.28) 0%, rgba(200,200,215,0.08) 100%);
        box-shadow: 0 0 32px rgba(200,200,215,0.08);
    }

    .result-item.selected .title {
        opacity: 1;
    }

    .result-item.selected .subtext,
    .result-item.selected .badge {
        opacity: 0.55;
    }

    .result-item:hover {
        background: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(200,200,215,0.16) 0%, rgba(200,200,215,0.05) 100%);
        box-shadow: 0 0 16px rgba(200,200,215,0.05);
        transform: translateY(-1px);
    }

    @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .results.staggered .result-item {
        animation: fadeInUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .results.staggered .result-item:nth-child(1) { animation-delay: 0.02s; }
    .results.staggered .result-item:nth-child(2) { animation-delay: 0.04s; }
    .results.staggered .result-item:nth-child(3) { animation-delay: 0.06s; }
    .results.staggered .result-item:nth-child(4) { animation-delay: 0.08s; }
    .results.staggered .result-item:nth-child(5) { animation-delay: 0.10s; }
    .results.staggered .result-item:nth-child(6) { animation-delay: 0.12s; }
    .results.staggered .result-item:nth-child(7) { animation-delay: 0.14s; }
    .results.staggered .result-item:nth-child(8) { animation-delay: 0.16s; }
    .results.staggered .result-item:nth-child(9) { animation-delay: 0.18s; }
    .results.staggered .result-item:nth-child(10) { animation-delay: 0.20s; }
    .results.staggered .result-item:nth-child(11) { animation-delay: 0.22s; }
    .results.staggered .result-item:nth-child(12) { animation-delay: 0.24s; }
    .results.staggered .result-item:nth-child(13) { animation-delay: 0.26s; }
    .results.staggered .result-item:nth-child(14) { animation-delay: 0.28s; }
    .results.staggered .result-item:nth-child(15) { animation-delay: 0.30s; }

    .icon {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        overflow: hidden;
        background: rgba(128, 128, 128, 0.1);
        color: var(--subtext);
        font-size: 18px;
    }
    
    .icon img,
    .icon svg {
        width: 20px;
        height: 20px;
        object-fit: contain;
    }

    .icon svg {
        stroke-width: 2;
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
        opacity: 0.65;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
    }
    
    .badge {
        font-size: 10px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(128, 128, 128, 0.1);
        color: var(--subtext);
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.8px;
    }

    mark {
        background: transparent;
        color: #ffffff;
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

    .pending-hint {
        padding: 20px 28px 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .pending-hint-format {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(128, 128, 128, 0.07);
        border: 1px solid var(--separator);
    }
    .pending-hint-format-icon {
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: rgba(128, 128, 128, 0.1);
        color: var(--subtext);
    }
    .pending-hint-format-text {
        font-size: 13px;
        color: var(--text-color);
        opacity: 0.85;
        line-height: 1.6;
    }
    .pending-hint-format-text strong {
        color: var(--text-color);
        font-weight: 700;
        opacity: 1;
    }
    .pending-hint-format-text code {
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 12px;
        background: rgba(128,128,128,0.18);
        padding: 2px 7px;
        border-radius: 5px;
        color: var(--text-color);
        border: 1px solid var(--separator);
    }
    .pending-hint-keys {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 12px;
        color: var(--subtext);
    }
    .pending-hint-keys kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 3px 10px;
        border-radius: 6px;
        background: rgba(128, 128, 128, 0.14);
        border: 1px solid rgba(255,255,255,0.18);
        box-shadow: 0 1px 0 rgba(0,0,0,0.2);
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        color: var(--text-color);
        letter-spacing: 0.4px;
    }
    .pending-hint-keys .sep {
        opacity: 0.5;
    }

    /* Media Grid Styles */
    .results.media-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 18px;
        padding: 24px;
    }
    
    .media-item {
        position: relative;
        border-radius: 12px;
        overflow: hidden;
        aspect-ratio: 1;
        background: rgba(128,128,128,0.1);
        cursor: pointer;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease;
    }
    
    .media-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }
    
    .media-item.selected {
        box-shadow: 
            0 0 0 2px var(--highlight),
            inset 0 0 0 1px rgba(255, 255, 255, 0.2);
    }
    
    .media-item.focused {
        transform: translateY(-4px) scale(1.03);
        z-index: 10;
        box-shadow: 
            0 16px 40px rgba(0, 0, 0, 0.4),
            0 0 0 2px var(--highlight),
            0 0 20px rgba(255, 59, 48, 0.3);
    }
    
    .media-item.focused.selected {
        box-shadow: 
            0 16px 40px rgba(0, 0, 0, 0.4),
            0 0 0 3px var(--highlight),
            0 0 30px rgba(255, 59, 48, 0.5);
    }
    
    .media-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    
    .media-badge {
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(8px);
        color: #fff;
        font-size: 10px;
        font-family: "SF Mono", "Fira Code", monospace;
        padding: 4px 8px;
        border-radius: 6px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
    }
    
    .media-item:hover .media-badge,
    .media-item.focused .media-badge {
        opacity: 1;
    }

    .media-check {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 20px;
        height: 20px;
        background: var(--highlight);
        color: #fff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.8);
        transition: all 0.2s;
    }
    
    .media-item.selected .media-check {
        opacity: 1;
        transform: scale(1);
    }
    
    .media-check svg {
        width: 12px;
        height: 12px;
        stroke-width: 3;
    }

    /* Prompt Vault Grid Styles */
    .results.prompts-grid {
        display: grid !important;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        padding: 16px;
    }

    .prompt-item {
        position: relative;
        border-radius: 12px;
        background: rgba(128, 128, 128, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 12px 14px;
        cursor: pointer;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease, background 0.2s ease;
        overflow: hidden;
        min-height: 92px;
    }

    .prompt-item:hover {
        transform: translateY(-2px);
        background: rgba(128, 128, 128, 0.14);
    }

    .prompt-item.focused {
        transform: translateY(-4px) scale(1.02);
        z-index: 10;
        box-shadow:
            0 16px 40px rgba(0, 0, 0, 0.4),
            0 0 0 2px var(--highlight),
            0 0 20px rgba(255, 59, 48, 0.3);
    }

    .prompt-name {
        font-weight: 750;
        font-size: 12.5px;
        color: var(--text-color);
        margin-bottom: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: -0.01em;
    }

    .prompt-preview {
        font-size: 11px;
        color: var(--subtext);
        line-height: 1.4;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        word-break: break-word;
    }

    /* ── Liquid Glass ───────────────────────── */
    .container.liquid-glass {
        --text-color: #ffffff;
        --subtext: rgba(255,255,255,0.92);
        --highlight: rgba(255,255,255,0.4);
        --separator: rgba(255,255,255,0.06);
        --border-color: rgba(255,255,255,0.08);
        border-radius: 28px;
        background:
            linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.005) 50%),
            rgba(8,10,20,0.32);
        backdrop-filter:
            blur(32px)
            saturate(110%)
            brightness(0.90);
        -webkit-backdrop-filter:
            blur(32px)
            saturate(110%)
            brightness(0.90);
        box-shadow:
            0 24px 64px rgba(0,0,0,0.35);
    }

    .container.liquid-glass::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background:
            radial-gradient(ellipse 100% 18% at 50% 0%, rgba(255,255,255,0.55) 0%, transparent 55%),
            radial-gradient(ellipse 90% 12% at 50% 100%, rgba(255,255,255,0.18) 0%, transparent 60%),
            radial-gradient(ellipse 12% 90% at 0% 50%, rgba(255,255,255,0.15) 0%, transparent 60%),
            radial-gradient(ellipse 12% 90% at 100% 50%, rgba(255,255,255,0.15) 0%, transparent 60%);
        mix-blend-mode: overlay;
        pointer-events: none;
        z-index: 2;
    }

    .container.liquid-glass::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow:
            inset 0 0 18px 2px rgba(255,255,255,0.18),
            inset 0 0 6px 1px rgba(255,255,255,0.35);
        pointer-events: none;
        z-index: 2;
    }

    .container.liquid-glass .input-wrapper {
        border-bottom: none;
        box-shadow: none;
        padding: 24px 28px;
    }

    .container.liquid-glass input,
    .container.liquid-glass .title,
    .container.liquid-glass .badge {
        text-shadow: none;
    }

    .container.liquid-glass .result-item {
        border-radius: 14px;
        margin-bottom: 4px;
        padding: 12px 16px;
    }

    .container.liquid-glass .result-item.selected {
        background: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.06) 100%);
        box-shadow: 0 0 32px rgba(255,255,255,0.07);
    }

    .container.liquid-glass .icon {
        border-radius: 50%;
        background: rgba(255,255,255,0.05);
    }

    .container.liquid-glass .badge {
        border-radius: 999px;
    }

    .container.liquid-glass .result-item:hover {
        background: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.03) 100%);
        box-shadow: 0 0 16px rgba(255,255,255,0.04);
        border-radius: 14px;
    }

    .container.liquid-glass .empty-state {
        border-radius: 16px;
    }

    @media (prefers-color-scheme: light) {
        .container.liquid-glass {
            --text-color: #1d1d20;
            --subtext: rgba(0,0,0,0.48);
            --highlight: rgba(0,0,0,0.3);
            --separator: rgba(0,0,0,0.05);
            --border-color: rgba(0,0,0,0.06);
            background: rgba(228,230,245,0.52);
            backdrop-filter:
                blur(40px)
                saturate(100%)
                brightness(0.88);
            -webkit-backdrop-filter:
                blur(40px)
                saturate(100%)
                brightness(0.88);
            box-shadow: 0 24px 64px rgba(0,0,0,0.15);
        }
        .container.liquid-glass::before {
            background:
                radial-gradient(ellipse 100% 18% at 50% 0%, rgba(255,255,255,0.70) 0%, transparent 55%),
                radial-gradient(ellipse 90% 12% at 50% 100%, rgba(255,255,255,0.22) 0%, transparent 60%),
                radial-gradient(ellipse 12% 90% at 0% 50%, rgba(255,255,255,0.18) 0%, transparent 60%),
                radial-gradient(ellipse 12% 90% at 100% 50%, rgba(255,255,255,0.18) 0%, transparent 60%);
        }
        .container.liquid-glass::after {
            box-shadow:
                inset 0 0 18px 2px rgba(255,255,255,0.22),
                inset 0 0 6px 1px rgba(255,255,255,0.40);
        }
        .container.liquid-glass .result-item:hover {
            background: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.01) 100%);
            border-radius: 14px;
        }
        .container.liquid-glass .result-item.selected {
            background: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.02) 100%);
            box-shadow: 0 0 24px rgba(0,0,0,0.03);
        }
        .container.liquid-glass .icon {
            border-radius: 50%;
            background: rgba(0,0,0,0.03);
        }
        .container.liquid-glass .badge {
            border-radius: 999px;
        }
    }
`;

const READER_STYLES = `
    :host {
        --reader-bg: #16161a;
        --reader-text: #ffffff;
        --reader-sub: #8e8e93;
        --reader-border: rgba(255, 255, 255, 0.1);
        --reader-accent: #ff3b30;
        --font-serif: "Iowan Old Style", "Apple Garamond", "Baskerville", "Times New Roman", "Droid Serif", Times, "Source Serif Pro", serif;
        --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    @media (prefers-color-scheme: light) {
        :host {
            --reader-bg: #ffffff;
            --reader-text: #1c1c1e;
            --reader-sub: #86868b;
            --reader-border: rgba(0, 0, 0, 0.08);
        }
    }

    .reader-overlay {
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: 2147483647;
        background: var(--reader-bg);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        opacity: 0;
        transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: var(--font-sans);
        color: var(--reader-text);
        scrollbar-width: thin;
    }

    .reader-overlay.visible { opacity: 1; }

    .reader-container {
        width: 100%;
        max-width: 740px;
        padding: 80px 40px;
        line-height: 1.65;
    }

    .reader-header h1 { 
        font-size: 44px; 
        line-height: 1.15; 
        margin-bottom: 16px; 
        font-weight: 800; 
        letter-spacing: -0.03em; 
    }
    
    .reader-meta { 
        font-size: 14px; 
        color: var(--reader-sub); 
        margin-bottom: 60px; 
        display: flex; 
        align-items: center;
        gap: 12px; 
        font-weight: 500;
    }
    
    .reader-body {
        font-family: var(--font-serif);
        font-size: 21px;
    }

    .reader-body p { margin-bottom: 32px; }
    .reader-body h2 { font-family: var(--font-sans); font-size: 30px; margin: 60px 0 24px; font-weight: 700; letter-spacing: -0.01em; }
    .reader-body h3 { font-family: var(--font-sans); font-size: 24px; margin: 40px 0 20px; font-weight: 700; }
    .reader-body img { max-width: 100%; height: auto; border-radius: 16px; margin: 40px 0; }
    .reader-body pre { 
        background: rgba(128,128,128,0.08); 
        padding: 24px; 
        border-radius: 12px; 
        overflow-x: auto; 
        font-family: "SF Mono", "Fira Code", monospace; 
        font-size: 15px; 
        margin-bottom: 32px; 
        border: 1px solid var(--reader-border);
    }
    .reader-body blockquote { 
        border-left: 3px solid var(--reader-accent); 
        padding-left: 28px; 
        font-style: italic; 
        color: var(--reader-sub); 
        margin: 40px 0; 
        font-size: 1.1em;
    }
    .reader-body a { color: var(--reader-accent); text-decoration: none; }
    .reader-body a:hover { text-decoration: underline; }

    .reader-close {
        position: fixed; top: 30px; right: 30px;
        width: 42px; height: 42px; border-radius: 50%;
        background: rgba(128,128,128,0.08);
        border: 1px solid var(--reader-border);
        color: var(--reader-text);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all 0.2s;
        backdrop-filter: blur(10px);
    }
    .reader-close:hover { background: rgba(128,128,128,0.15); transform: scale(1.08); }
    .reader-close svg { width: 20px; height: 20px; }
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
        background: transparent;
        transition: background 0.3s cubic-bezier(0.16, 1, 0.3, 1);
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

    actionModeIndicator = document.createElement('div');
    actionModeIndicator.className = 'action-indicator';
    actionModeIndicator.innerHTML = LOGO_ICON;
    inputWrapper.appendChild(actionModeIndicator);
    inputWrapper.appendChild(input);

    resultsContainer = document.createElement('div');
    resultsContainer.className = 'results staggered';

    resultsContainer.addEventListener('click', (e) => {
        const resultItem = e.target.closest('.result-item');
        if (resultItem) {
            const idx = parseInt(resultItem.getAttribute('data-idx'));
            if (idx >= 0 && idx < domOrderedResults.length) {
                activateResult(domOrderedResults[idx]);
            }
            return;
        }

        const mediaItem = e.target.closest('.media-item');
        if (mediaItem) {
            const midx = parseInt(mediaItem.getAttribute('data-midx'));
            if (midx >= 0 && midx < domOrderedMedia.length) {
                const item = domOrderedMedia[midx];
                if (selectedMediaIds.has(item.url)) {
                    selectedMediaIds.delete(item.url);
                    mediaItem.classList.remove('selected');
                } else {
                    selectedMediaIds.add(item.url);
                    mediaItem.classList.add('selected');
                }
                updateSelection(midx);
            }
            return;
        }

        const promptItem = e.target.closest('.prompt-item');
        if (promptItem) {
            const pidx = parseInt(promptItem.getAttribute('data-pidx'));
            if (pidx >= 0 && pidx < domOrderedPrompts.length) {
                const prompt = domOrderedPrompts[pidx];
                updateSelection(pidx);
                navigator.clipboard.writeText(prompt.text).catch(() => {});
                showPromptsFeedback(`Copied: ${prompt.name}`, '#4ade80');
                focusTimeouts.push(setTimeout(() => { hidePalette(); }, 400));
            }
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

    container.appendChild(inputWrapper);
    container.appendChild(resultsContainer);


    shadow.appendChild(style);
    shadow.appendChild(container);

    document.documentElement.appendChild(palette);

    // Event Listeners
    input.addEventListener('input', handleActionModeInput);
    input.addEventListener('input', debounce(handleSearch, 150));
    input.addEventListener('keydown', handleKeydown);

    // Refocus guard: some sites (e.g. Google) steal focus back after we open.
    // If the input loses focus while the palette is visible, grab it back.
    input.addEventListener('focusout', (e) => {
        if (isVisible) {
            // Snatch back if focus went to the host page or "null" (omnibox)
            if (!e.relatedTarget || !palette.contains(e.relatedTarget)) {
                focusTimeouts.push(setTimeout(() => {
                    if (isVisible && input) input.focus();
                }, 10));
            }
        }
    });

    // Prevent result clicks from blurring the input — mousedown preventDefault
    // means focus stays on the input, but click still fires normally.
    resultsContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    container.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    container.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    }, { passive: true });

    palette.addEventListener('mousedown', (e) => {
        if (e.target === palette) {
            hidePalette();
            e.preventDefault();
        }
    });

    palette.addEventListener('touchstart', (e) => {
        if (e.target === palette) {
            hidePalette();
            e.preventDefault();
        }
    }, { passive: false });

    // Prevent key events inside the palette from triggering host page shortcuts
    // (e.g. typing "w" on DuckDuckGo, "/" on YouTube/GitHub)
    ['keydown', 'keyup', 'keypress'].forEach(eventType => {
        palette.addEventListener(eventType, (e) => {
            e.stopPropagation();
        });
    });
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
    palette.style.background = 'rgba(0,0,0,0.12)';
    isVisible = true;
    isActionMode = false;
    if (actionModeIndicator) actionModeIndicator.classList.remove('visible');

    try {
        const sel = window.getSelection();
        cachedSelectionAtOpen = sel ? (sel.toString() || '').trim() : '';
    } catch (e) { cachedSelectionAtOpen = ''; }

    // Force reflow for animation
    palette.offsetHeight;
    if (!shadow) return;
    const container = shadow.querySelector('.container');
    if (!container) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try { container.classList.add('visible'); } catch (e) {}
        });
    });

    if (settings.enableLiquidGlass) {
        try { container.classList.add('liquid-glass'); } catch (e) {}
    } else {
        try { container.classList.remove('liquid-glass'); } catch (e) {}
    }

    input.value = '';
    currentResults = [];
    renderResults([]);

    // Multi-stage aggressive focus: some sites (Google, Twitter, Reddit) fight
    // hard to reclaim focus. We hit it at 0ms, 80ms, 200ms, and 500ms to win.
    input.focus();
    focusTimeouts.push(setTimeout(() => { if (isVisible) input.focus(); }, 80));
    focusTimeouts.push(setTimeout(() => { if (isVisible) input.focus(); }, 200));
    focusTimeouts.push(setTimeout(() => { if (isVisible) input.focus(); }, 500));

    handleSearch(); // Fetch initial tabs list
}

function hidePalette() {
    if (!isVisible || !palette) return;
    isVisible = false;
    isActionMode = false;
    if (actionModeIndicator) actionModeIndicator.classList.remove('visible');
    for (const t of focusTimeouts) clearTimeout(t);
    focusTimeouts = [];
    palette.style.background = 'transparent';
    const container = shadow.querySelector('.container');
    if (container) container.classList.remove('visible');
    if (hidePaletteTimeout) clearTimeout(hidePaletteTimeout);
    hidePaletteTimeout = setTimeout(() => {
        if (!isVisible) {
            palette.style.display = 'none';
            // Aggressive Garbage Collection to free RAM
            if (input) {
                input.value = '';
                input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
            }
            if (resultsContainer) {
                resultsContainer.innerHTML = '';
                resultsContainer.className = 'results staggered';
            }
            currentResults = [];
            cachedResultItems = [];
            pendingCommand = null;
            isMediaMode = false;
            extractedMedia = [];
            selectedMediaIds.clear();
            isPromptsMode = false;
            domOrderedPrompts = [];
            cachedAllPrompts = [];
            cachedPromptItems = [];
            pendingPromptText = '';
            cachedSelectionAtOpen = '';
            hasStaggered = false;
        }
    }, 150); // wait for animation
}

function togglePalette() {
    if (isVisible) hidePalette();
    else showPalette();
}

function showVolumeToast(level) {
    const existing = document.getElementById('tabs-plus-vol-toast');
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = 'tabs-plus-vol-toast';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        .toast {
            position: fixed; bottom: 32px; right: 32px; z-index: 2147483647;
            background: rgba(22, 22, 26, 0.85);
            backdrop-filter: blur(20px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 14px;
            padding: 12px 20px;
            display: flex; align-items: center; gap: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px; color: #fff; font-weight: 500;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            animation: slideIn 0.2s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes slideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .bar-bg { width: 100px; height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
        .bar-fill { height: 100%; background: #ff3b30; border-radius: 2px; transition: width 0.2s ease; }
    `;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>🔊 ${level}%</span><div class="bar-bg"><div class="bar-fill" style="width:${level}%"></div></div>`;
    shadow.appendChild(style);
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 1800);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== 'object' || typeof request.action !== 'string') return;
    if (request.action === 'toggle-palette') {
        if (request.forceAction && typeof request.forceAction === 'string') {
            // Open palette and immediately activate the action
            if (!isVisible) togglePalette();
            focusTimeouts.push(setTimeout(() => { if (isVisible) activateResult({ type: 'action', id: request.forceAction }); }, 50));
        } else {
            togglePalette();
        }
    }
    if (request.action === 'update-palette-query') {
        if (!isVisible) showPalette();
        if (input && typeof request.query === 'string') {
            handleSearch();
            // Move cursor to end
            setTimeout(() => {
                input.selectionStart = input.selectionEnd = input.value.length;
            }, 10);
        }
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'apply-parent-blur') {
        toggleParentBlur(true);
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'remove-parent-blur') {
        toggleParentBlur(false);
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'copy-to-clipboard') {
        if (typeof request.text !== 'string') { sendResponse({ success: false }); return true; }
        navigator.clipboard.writeText(request.text).then(() => {
            sendResponse({ success: true });
        }).catch(() => {
            // Fallback for pages that block clipboard API
            try {
                const el = document.createElement('textarea');
                el.value = request.text;
                el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                sendResponse({ success: true });
            } catch (e) { sendResponse({ success: false }); }
        });
        return true;
    }
    if (request.action === "get-video-time") {
        sendResponse({ timestamp: getVideoTimestamp() });
        return true;
    }
    if (request.action === "pause-media") {
        document.querySelectorAll("video, audio").forEach(el => {
            try { el.pause(); } catch (e) {}
        });
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'set-volume') {
        const media = document.querySelectorAll('video, audio');
        if (media.length === 0) { sendResponse({ success: false, reason: 'no-media' }); return true; }

        let currentVol = media[0].volume * 100;
        let targetLevel;
        if (typeof request.level === 'number' && Number.isFinite(request.level)) {
            targetLevel = Math.min(100, Math.max(0, request.level));
        } else if (typeof request.delta === 'number' && Number.isFinite(request.delta)) {
            targetLevel = Math.min(100, Math.max(0, Math.round(currentVol) + request.delta));
        } else {
            sendResponse({ success: false }); return true;
        }

        media.forEach(el => { try { el.volume = targetLevel / 100; el.muted = false; } catch (e) {} });

        // Show feedback in the palette input if open, else on-page toast
        if (isVisible && input) {
            const prev = input.value;
            const prevColor = input.style.color;
            input.value = `🔊 Volume: ${targetLevel}%`;
            input.style.color = '#4ade80';
            setTimeout(() => { input.value = prev; input.style.color = prevColor; }, 900);
        } else {
            showVolumeToast(targetLevel);
        }

        sendResponse({ success: true, level: targetLevel });
        return true;
    }
    if (request.action === 'toggle-pip') {
        togglePictureInPicture();
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'open-eyedropper-ui') {
        // Fallback or old command support
        return true;
    }
    if (request.action === 'start-custom-eyedropper') {
        startCustomEyedropper(request.dataUrl);
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'start-screenshot-capture') {
        startScreenshotCapture();
        sendResponse({ success: true });
        return true;
    }
    if (request.action === 'update-pomo-timer') {
        updatePomoUI(request.pomoTimer);
        return true;
    }
    if (request.action === 'toggle-reader-view') {
        toggleReaderView();
        sendResponse({ success: true });
        return true;
    }
});

function updatePomoUI(pomo) {
    if (!pomo || !pomo.isActive) {
        if (pomoHost) {
            pomoHost.remove();
            pomoHost = null;
        }
        if (pomoInterval) {
            clearInterval(pomoInterval);
            pomoInterval = null;
        }
        return;
    }

    if (!pomoHost) createPomoUI();
    
    if (pomoInterval) clearInterval(pomoInterval);
    
    const update = () => {
        const remaining = Math.max(0, pomo.endTime - Date.now());
        if (remaining <= 0) {
            clearInterval(pomoInterval);
            // Don't remove immediately, let the background handle completion
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        const shadow = pomoHost.shadowRoot;
        const timeEl = shadow.querySelector('.time');
        const labelEl = shadow.querySelector('.label');
        if (timeEl) timeEl.textContent = timeStr;
        if (labelEl) labelEl.textContent = pomo.type === 'work' ? 'Focus' : 'Break';
        
        const card = shadow.querySelector('.card');
        if (card) {
            if (pomo.type === 'work') card.classList.add('work');
            else card.classList.remove('work');
        }
    };
    
    update();
    pomoInterval = setInterval(update, 1000);
}

function createPomoUI() {
    if (document.getElementById('tabs-plus-plus-pomo-timer')) return;
    pomoHost = document.createElement('div');
    pomoHost.id = 'tabs-plus-plus-pomo-timer';
    const shadow = pomoHost.attachShadow({ mode: 'open' });
    
    const style = document.createElement('style');
    style.textContent = `
        .card {
            position: fixed; bottom: 30px; right: 30px; z-index: 2147483647;
            background: rgba(22, 22, 26, 0.85);
            backdrop-filter: blur(24px) saturate(200%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 99px;
            box-shadow: 0 16px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08);
            display: flex; align-items: center; gap: 10px;
            padding: 6px 14px;
            font-family: system-ui, -apple-system, sans-serif;
            color: #fff;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: pointer;
            user-select: none;
        }
        .card.work { border-color: rgba(255, 59, 48, 0.3); }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #ff3b30; box-shadow: 0 0 8px #ff3b30; }
        .card:not(.work) .dot { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
        .time { font-size: 14px; font-weight: 700; font-family: monospace; letter-spacing: 0.5px; min-width: 42px; }
        .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; opacity: 0.7; }
        .card:hover { transform: scale(1.05); background: rgba(22, 22, 26, 0.95); }
    `;
    
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <div class="dot"></div>
        <div class="label">Focus</div>
        <div class="time">00:00</div>
    `;
    
    card.addEventListener('click', () => {
        if (confirm('Stop Pomodoro timer?')) {
            chrome.runtime.sendMessage({ action: 'stop-pomo-timer' }).catch(() => {});
        }
    });
    
    shadow.appendChild(style);
    shadow.appendChild(card);
    document.documentElement.appendChild(pomoHost);
}

function toggleParentBlur(active) {

    if (active) {
        if (!blurOverlay) {
            blurOverlay = document.createElement('div');
            blurOverlay.id = 'tabs-plus-plus-blur-overlay';
            blurOverlay.style.cssText = `
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                z-index: 2147483645;
                background: rgba(0,0,0,0.05);
                backdrop-filter: blur(10px) saturate(140%);
                -webkit-backdrop-filter: blur(10px) saturate(140%);
                opacity: 0;
                transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: none;
            `;
            document.documentElement.appendChild(blurOverlay);
        }
        blurOverlay.style.display = 'block';
        blurOverlay.offsetHeight; // force reflow
        blurOverlay.style.opacity = '1';
    } else {
        if (blurOverlay) {
            blurOverlay.style.opacity = '0';
            setTimeout(() => {
                if (blurOverlay && blurOverlay.style.opacity === '0') {
                    blurOverlay.style.display = 'none';
                }
            }, 500);
        }
    }
}

function getSearchQuery() {
    const raw = input.value.trim();
    return isActionMode ? '>' + raw : raw;
}

async function handleSearch() {
    if (pendingCommand) return;

    const query = getSearchQuery();

    if (!chrome.runtime?.id) {
        hidePalette();
        return;
    }

    if (isMediaMode) {
        const filter = parseMediaFilter(query);
        const filtered = filterMediaResults(extractedMedia, filter);
        renderMediaResults(filtered);
        return;
    }

    if (isPromptsMode) {
        const filtered = filterPromptsByQuery(cachedAllPrompts, query);
        renderPromptsResults(filtered);
        return;
    }

    const sentQuery = query;
    try {
        chrome.runtime.sendMessage({ action: 'search-items', query }, response => {
            if (chrome.runtime.lastError) {
                hidePalette();
                return;
            }
            if (getSearchQuery() !== sentQuery) return;
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
const ICONS = {
    zap: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    globe: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    star: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    link: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    file: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`
};

const LOGO_ICON = `<svg width="30" height="30" viewBox="0 0 193 193" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M148.277 43.0867C115.56 42.91 82.8308 43.0685 50.1095 43.0074C46.8919 43.1643 44.0688 46.055 44.0143 49.2859C43.9962 58.4749 43.9929 67.6656 44.0143 76.8546C44.1811 79.1642 45.6801 81.1486 47.6282 82.3109C66.3414 96.8621 81.089 118.035 83.6645 142.049C84.2506 144.316 83.2369 147.252 85.043 149.074C85.6902 149.545 86.4017 150.103 87.2569 149.984C102.941 149.997 118.624 149.997 134.308 149.984C136.37 150.06 137.901 147.805 137.453 145.865C136.785 137.62 133.819 129.706 129.694 122.583C125.126 114.979 119.333 108.149 112.833 102.13C105.391 95.0626 97.0468 88.865 87.7505 84.4505C76.5672 79.2352 64.2662 76.5228 51.9288 76.3923C50.0848 76.6895 48.3513 74.8636 48.4702 73.0591C48.4437 65.5739 48.4734 58.0886 48.4553 50.605C48.6006 48.8599 50.1211 47.3279 51.9272 47.4748C60.3238 47.4038 68.6477 49.7547 75.9728 53.811C84.0013 58.2949 90.0833 65.3328 97.0881 71.1507C102.615 76.6103 108.935 81.421 116.252 84.1929C120.985 86.0238 125.989 87.0738 131.038 87.5195C136.638 87.6698 142.246 87.5509 147.849 87.5856C149.591 87.5988 151.012 85.9627 150.974 84.2854C150.987 71.6278 150.989 58.9702 150.973 46.3142C151.06 44.7574 149.823 43.2749 148.277 43.0867Z" fill="#b0b0b8"/></svg>`;

const TYPE_FALLBACK = {
    action: ICONS.zap, tab: ICONS.globe, history: ICONS.clock, bookmark: ICONS.star, bang: ICONS.zap,
    search: ICONS.search, navigate: ICONS.link, closed: ICONS.clock, default: ICONS.file
};

function getFaviconHtml(result) {
    const fallback = TYPE_FALLBACK[result.type] || TYPE_FALLBACK.default;
    if (result.favIconUrl && result.favIconUrl.startsWith('http')) {
        return `<img src="${result.favIconUrl}" data-type="${result.type}" />`;
    }
    if (result.url) {
        try {
            const domain = new URL(result.url).hostname;
            return `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" data-type="${result.type}" />`;
        } catch {}
    }
    return fallback;
}

function highlight(text, queryRegex) {
    if (!text) return '';
    const safe = escapeHTML(text);
    if (!queryRegex) return safe;
    return safe.replace(queryRegex, '<mark>$1</mark>');
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
                <div class="empty-icon">${ICONS.search}</div>
                <div class="empty-title">${query ? `No results for "${escapeHTML(query)}"` : 'Nothing to show'}</div>
                <div class="empty-hint">Try a bang like !yt, !gh, !px, or !gpt</div>
            </div>`;
        return;
    }

    resultsContainer.classList.add('has-items');
    const query = input ? input.value.trim() : '';
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
            ? `<div class="group-dot" style="background:${GROUP_COLORS[result.groupColor]}"></div>`
            : '';
        const iconHtml = `<div class="icon-wrap"><div class="icon">${faviconContent}</div>${groupDot}</div>`;

        let subtext = result.url || '';
        if (result.type === 'bang') subtext = result.label || result.bang;
        else if (result.type === 'search') subtext = 'Google Search';
        else if (result.type === 'navigate') subtext = 'Open URL';
        else if (result.type === 'closed') subtext = result.url || '';

        const badge = result.type === 'navigate' ? 'link'
            : result.type === 'bang' ? result.bang
            : result.type === 'closed' ? 'closed'
            : result.type;

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
            const label = SECTION_LABELS[type];
            if (label) {
                html += `<div class="section-header">${label}</div>`;
            }
            items.forEach(result => { html += buildItem(result); });
        }
    });

    if (hasStaggered) {
        resultsContainer.classList.remove('staggered');
    }
    resultsContainer.innerHTML = html;
    if (!hasStaggered && results.length > 0) {
        hasStaggered = true;
    }
    cachedResultItems = Array.from(resultsContainer.querySelectorAll('.result-item'));
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
    if (isMediaMode) {
        if (selectedIndex >= 0 && selectedIndex < cachedMediaItems.length) {
            cachedMediaItems[selectedIndex].classList.remove('focused');
        }
        selectedIndex = index;
        if (selectedIndex >= 0 && selectedIndex < cachedMediaItems.length) {
            cachedMediaItems[selectedIndex].classList.add('focused');
            const el = cachedMediaItems[selectedIndex];
            const rect = el.getBoundingClientRect();
            const containerRect = resultsContainer.getBoundingClientRect();
            if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    } else if (isPromptsMode) {
        if (selectedIndex >= 0 && selectedIndex < cachedPromptItems.length) {
            cachedPromptItems[selectedIndex].classList.remove('focused');
        }
        selectedIndex = index;
        if (selectedIndex >= 0 && selectedIndex < cachedPromptItems.length) {
            cachedPromptItems[selectedIndex].classList.add('focused');
            const el = cachedPromptItems[selectedIndex];
            const rect = el.getBoundingClientRect();
            const containerRect = resultsContainer.getBoundingClientRect();
            if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    } else {
        if (selectedIndex >= 0 && selectedIndex < cachedResultItems.length) {
            cachedResultItems[selectedIndex].classList.remove('selected');
        }
        selectedIndex = index;
        if (selectedIndex >= 0 && selectedIndex < cachedResultItems.length) {
            cachedResultItems[selectedIndex].classList.add('selected');
            const el = cachedResultItems[selectedIndex];
            const rect = el.getBoundingClientRect();
            const containerRect = resultsContainer.getBoundingClientRect();
            if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }
}

/* =========================================================================
   MEDIA EXTRACTOR LOGIC
   ========================================================================= */

function extractMediaFromPage() {
    extractedMedia = [];
    const seenUrls = new Set();
    const minSize = 64;

    const addMedia = (url, width, height, alt = '', typeOverride = null) => {
        if (!url || url.startsWith('data:')) return;
        try {
            const absoluteUrl = new URL(url, window.location.href).href;
            if (seenUrls.has(absoluteUrl)) return;
            seenUrls.add(absoluteUrl);

            const extMatch = absoluteUrl.match(/\.([a-zA-Z0-9]+)(?:[\?#]|$)/);
            let ext = typeOverride || (extMatch ? extMatch[1].toLowerCase() : 'unknown');
            if (ext === 'jpeg') ext = 'jpg';

            extractedMedia.push({
                url: absoluteUrl,
                width: width || 0,
                height: height || 0,
                type: ext,
                alt: alt.toLowerCase(),
                area: (width || 0) * (height || 0)
            });
        } catch (e) {}
    };

    // Images
    document.querySelectorAll('img').forEach(img => {
        if (img.naturalWidth >= minSize && img.naturalHeight >= minSize) {
            addMedia(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight, img.alt);
        }
    });

    // Videos / Sources
    document.querySelectorAll('video, source').forEach(el => {
        const width = el.videoWidth || el.clientWidth || 0;
        const height = el.videoHeight || el.clientHeight || 0;
        let type = 'video';
        if (el.type) type = el.type.split('/')[1];
        addMedia(el.currentSrc || el.src, width, height, '', type);
    });

    // Background Images (Heuristic: search common elements to avoid excessive style computation)
    document.querySelectorAll('div, section, header, figure, a, span').forEach(el => {
        if (el.clientWidth < minSize || el.clientHeight < minSize) return;
        try {
            const bg = window.getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && bg.startsWith('url(')) {
                const urlMatch = bg.match(/^url\(["']?([^"'\)]+)["']?\)$/);
                if (urlMatch && urlMatch[1]) {
                    addMedia(urlMatch[1], el.clientWidth, el.clientHeight, '', 'bg');
                }
            }
        } catch (e) {}
    });

    extractedMedia.sort((a, b) => b.area - a.area);
}

function parseMediaFilter(query) {
    const filter = {
        width: null, widthOp: null,
        height: null, heightOp: null,
        types: new Set(),
        orientation: null,
        keywords: []
    };

    if (!query) return filter;

    const parts = query.toLowerCase().split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        // Dimensions
        const dimMatch1 = part.match(/^(w|width|h|height)\s*([><=]+)?\s*(\d+)(px)?$/);
        const dimMatch2 = part.match(/^([><=]+)?\s*(\d+)(px)?(w|h|width|height)$/);
        const dimMatch3 = part.match(/^([><=]+)\s*(\d+)(px)?$/); // e.g. ">1000" (defaults to width)
        
        if (dimMatch1) {
            const dimType = dimMatch1[1].startsWith('w') ? 'w' : 'h';
            const op = dimMatch1[2] || '>=';
            const val = parseInt(dimMatch1[3], 10);
            if (dimType === 'w') { filter.width = val; filter.widthOp = op; } else { filter.height = val; filter.heightOp = op; }
            continue;
        } else if (dimMatch2) {
            const op = dimMatch2[1] || '>=';
            const val = parseInt(dimMatch2[2], 10);
            const dimType = dimMatch2[4].startsWith('w') ? 'w' : 'h';
            if (dimType === 'w') { filter.width = val; filter.widthOp = op; } else { filter.height = val; filter.heightOp = op; }
            continue;
        } else if (dimMatch3) {
            const op = dimMatch3[1];
            const val = parseInt(dimMatch3[2], 10);
            filter.width = val;
            filter.widthOp = op;
            continue;
        }

        // Exact match e.g. "w > 1000" where they are separated by spaces
        if ((part === 'w' || part === 'h' || part === 'width' || part === 'height') && i < parts.length - 1) {
            const nextPart = parts[i + 1];
            let op = '>=', valStr = nextPart, skip = 1;
            
            if (['>', '<', '>=', '<=', '='].includes(nextPart)) {
                op = nextPart;
                if (i < parts.length - 2) {
                    valStr = parts[i + 2];
                    skip = 2;
                } else {
                    continue; // Incomplete
                }
            } else if (nextPart.match(/^([><=]+)(\d+)(px)?$/)) {
                const match = nextPart.match(/^([><=]+)(\d+)(px)?$/);
                op = match[1];
                valStr = match[2];
            }
            
            const valMatch = valStr.match(/^(\d+)(px)?$/);
            if (valMatch) {
                const dimType = part.startsWith('w') ? 'w' : 'h';
                if (dimType === 'w') { filter.width = parseInt(valMatch[1], 10); filter.widthOp = op; }
                else { filter.height = parseInt(valMatch[1], 10); filter.heightOp = op; }
                i += skip;
                continue;
            }
        }

        // Types
        if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'mp4', 'webm', 'bg'].includes(part)) {
            filter.types.add(part === 'jpeg' ? 'jpg' : part);
            continue;
        }

        // Orientation
        if (['landscape', 'portrait', 'square'].includes(part)) {
            filter.orientation = part;
            continue;
        }

        // Keywords
        if (part) filter.keywords.push(part);
    }

    return filter;
}

function filterMediaResults(results, filter) {
    return results.filter(item => {
        if (filter.types.size > 0 && !filter.types.has(item.type)) return false;

        if (filter.orientation) {
            const ratio = item.width / (item.height || 1);
            if (filter.orientation === 'landscape' && ratio <= 1.1) return false;
            if (filter.orientation === 'portrait' && ratio >= 0.9) return false;
            if (filter.orientation === 'square' && (ratio < 0.9 || ratio > 1.1)) return false;
        }

        const checkDim = (actual, op, target) => {
            if (op === '>') return actual > target;
            if (op === '<') return actual < target;
            if (op === '>=') return actual >= target;
            if (op === '<=') return actual <= target;
            if (op === '=') return actual === target;
            return true;
        };

        if (filter.width !== null && !checkDim(item.width, filter.widthOp, filter.width)) return false;
        if (filter.height !== null && !checkDim(item.height, filter.heightOp, filter.height)) return false;

        if (filter.keywords.length > 0) {
            const searchable = `${item.url} ${item.alt}`.toLowerCase();
            if (!filter.keywords.every(kw => searchable.includes(kw))) return false;
        }

        return true;
    });
}

function filterPromptsByQuery(prompts, query) {
    if (!query) return prompts;
    const lower = query.toLowerCase();
    const parts = lower.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return prompts;
    return prompts.filter(p => {
        const hay = `${p.name} ${p.text}`.toLowerCase();
        return parts.every(part => hay.includes(part));
    });
}

function renderMediaResults(results) {
    resultsContainer.innerHTML = '';
    resultsContainer.scrollTop = 0;
    domOrderedMedia = results;
    selectedIndex = results.length > 0 ? 0 : -1;

    resultsContainer.className = 'results media-grid has-items';

    if (results.length === 0) {
        resultsContainer.className = 'results has-items'; // Revert grid for empty state
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${ICONS.search}</div>
                <div class="empty-title">No media found</div>
                <div class="empty-hint">Try adjusting your filters</div>
            </div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    results.forEach((item, index) => {
        const el = document.createElement('div');
        el.className = 'media-item';
        if (index === 0) el.classList.add('focused');
        if (selectedMediaIds.has(item.url)) el.classList.add('selected');

        const dims = (item.width && item.height) ? `${item.width}x${item.height}` : 'Unknown';
        const type = item.type.toUpperCase();

        el.innerHTML = `
            <img class="media-img" src="${escapeHTML(item.url)}" loading="lazy" />
            <div class="media-badge">${dims} · ${type}</div>
            <div class="media-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
        `;

        el.setAttribute('data-midx', index);

        fragment.appendChild(el);
    });

    resultsContainer.appendChild(fragment);
    cachedMediaItems = Array.from(resultsContainer.querySelectorAll('.media-item'));
}

function renderPromptsResults(results) {
    resultsContainer.innerHTML = '';
    resultsContainer.scrollTop = 0;
    domOrderedPrompts = results;
    selectedIndex = results.length > 0 ? 0 : -1;

    resultsContainer.className = 'results prompts-grid has-items';

    if (results.length === 0) {
        resultsContainer.className = 'results has-items';
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${ICONS.search}</div>
                <div class="empty-title">No saved prompts</div>
                <div class="empty-hint">Use &gt;save prompt to capture selected text</div>
            </div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    results.forEach((prompt, index) => {
        const el = document.createElement('div');
        el.className = 'prompt-item';
        if (index === 0) el.classList.add('focused');

        const preview = (prompt.text || '').replace(/\s+/g, ' ').trim();

        el.innerHTML = `
            <div class="prompt-name">${escapeHTML(prompt.name)}</div>
            <div class="prompt-preview">${escapeHTML(preview)}</div>
        `;

        el.setAttribute('data-pidx', index);

        fragment.appendChild(el);
    });

    resultsContainer.appendChild(fragment);
    cachedPromptItems = Array.from(resultsContainer.querySelectorAll('.prompt-item'));
}

function showPromptsFeedback(message, color, restoreValue) {
    if (!input) return;
    input.value = message;
    input.style.color = color;
    focusTimeouts.push(setTimeout(() => {
        if (!input) return;
        input.style.color = '';
        input.value = restoreValue !== undefined ? restoreValue : '';
    }, 400));
}

function handleKeydown(e) {
    if (!isVisible) return;

    if (isMediaMode) {
        if (e.key === 'Escape') {
            isMediaMode = false;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
            resultsContainer.className = 'results';
            selectedMediaIds.clear();
            handleSearch();
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const items = cachedMediaItems;
        if (!items || items.length === 0) return;

        // Calculate columns for grid navigation
        let columns = 1;
        if (items.length > 1) {
            const firstTop = items[0].offsetTop;
            for (let i = 1; i < items.length; i++) {
                if (items[i].offsetTop > firstTop) {
                    columns = i;
                    break;
                }
            }
            if (columns === 1 && items.length > 1 && items[1].offsetTop === firstTop) columns = items.length; // all on one row
        }

        if (e.key === 'ArrowRight') {
            let newIndex = selectedIndex + 1;
            if (newIndex >= domOrderedMedia.length) newIndex = 0;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            let newIndex = selectedIndex - 1;
            if (newIndex < 0) newIndex = domOrderedMedia.length - 1;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            let newIndex = selectedIndex + columns;
            if (newIndex >= domOrderedMedia.length) newIndex = domOrderedMedia.length - 1;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            let newIndex = selectedIndex - columns;
            if (newIndex < 0) newIndex = 0;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === ' ') {
            if (selectedIndex >= 0 && selectedIndex < domOrderedMedia.length) {
                const item = domOrderedMedia[selectedIndex];
                const el = items[selectedIndex];
                if (selectedMediaIds.has(item.url)) {
                    selectedMediaIds.delete(item.url);
                    el.classList.remove('selected');
                } else {
                    selectedMediaIds.add(item.url);
                    el.classList.add('selected');
                }
            }
            e.preventDefault();
        } else if (e.key === 'Enter') {
            let urlsToDownload = [];

            if (selectedMediaIds.size > 0) {
                // If anything is explicitly selected, Enter downloads those.
                urlsToDownload = Array.from(selectedMediaIds);
            } else if (e.ctrlKey || e.metaKey) {
                // Ctrl+Enter with no selection = download all currently visible/filtered
                urlsToDownload = domOrderedMedia.map(m => m.url);
            } else {
                // Just Enter with no selection = download the single focused item
                if (selectedIndex >= 0 && selectedIndex < domOrderedMedia.length) {
                    urlsToDownload = [domOrderedMedia[selectedIndex].url];
                }
            }

            if (urlsToDownload.length > 0) {
                chrome.runtime.sendMessage({ action: 'download-media', urls: urlsToDownload }).catch(() => {});
                hidePalette();
            }
            e.preventDefault();
        }
        return;
    }

    if (isPromptsMode) {
        if (e.key === 'Escape') {
            isPromptsMode = false;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
            resultsContainer.className = 'results';
            domOrderedPrompts = [];
            cachedAllPrompts = [];
            cachedPromptItems = [];
            handleSearch();
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            if (selectedIndex >= 0 && selectedIndex < domOrderedPrompts.length) {
                const target = domOrderedPrompts[selectedIndex];
                const savedQuery = input.value;
                const deletedIdx = selectedIndex;
                chrome.runtime.sendMessage({ action: 'delete-prompt', id: target.id }, (response) => {
                    if (chrome.runtime.lastError || !response?.success) {
                        showPromptsFeedback('Delete failed', '#ff3b30', savedQuery);
                        return;
                    }
                    const remaining = response.prompts || [];
                    cachedAllPrompts = remaining;
                    showPromptsFeedback(`Deleted: ${target.name}`, '#ff3b30', savedQuery);
                    if (remaining.length === 0) {
                        isPromptsMode = false;
                        input.value = "";
                        input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
                        handleSearch();
                    } else {
                        const filtered = filterPromptsByQuery(remaining, savedQuery);
                        renderPromptsResults(filtered);
                        const newIdx = Math.min(deletedIdx, domOrderedPrompts.length - 1);
                        if (newIdx >= 0) updateSelection(newIdx);
                    }
                });
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const items = cachedPromptItems;
        if (!items || items.length === 0) return;

        if (e.key === 'ArrowRight') {
            let newIndex = selectedIndex + 1;
            if (newIndex >= domOrderedPrompts.length) newIndex = 0;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            let newIndex = selectedIndex - 1;
            if (newIndex < 0) newIndex = domOrderedPrompts.length - 1;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            let newIndex = selectedIndex + 2;
            if (newIndex >= domOrderedPrompts.length) newIndex = domOrderedPrompts.length - 1;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            let newIndex = selectedIndex - 2;
            if (newIndex < 0) newIndex = 0;
            updateSelection(newIndex);
            e.preventDefault();
        } else if (e.key === 'Enter' || e.key === ' ') {
            if (selectedIndex >= 0 && selectedIndex < domOrderedPrompts.length) {
                const prompt = domOrderedPrompts[selectedIndex];
                navigator.clipboard.writeText(prompt.text).catch(() => {});
                showPromptsFeedback(`Copied: ${prompt.name}`, '#4ade80');
                focusTimeouts.push(setTimeout(() => { hidePalette(); }, 400));
            }
            e.preventDefault();
        }
        return;
    }

    // Tab trap: Focus MUST stay in the palette input
    if (e.key === 'Tab') {
        e.preventDefault();
        if (input) input.focus();
        return;
    }

    if (e.key === 'Escape') {
        if (pendingCommand) {
            pendingCommand = null;
            input.value = "";
            input.placeholder = "Search tabs, history, bookmarks... or try !yt, !gh, !mdn";
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
        if (pendingCommand === 'save_prompt_data') {
            if (e.key === 'Enter') {
                const name = input.value.trim();
                if (name && pendingPromptText) {
                    const captured = pendingPromptText;
                    chrome.runtime.sendMessage({ action: 'save-prompt', name, text: captured }, (response) => {
                        if (chrome.runtime.lastError || !response?.success) {
                            showPromptsFeedback('Save failed', '#ff3b30');
                            return;
                        }
                        showPromptsFeedback(`Saved: ${name}`, '#4ade80');
                        focusTimeouts.push(setTimeout(() => { hidePalette(); }, 400));
                    });
                }
                pendingCommand = null;
                pendingPromptText = '';
                e.preventDefault();
            }
            return;
        }
        if (e.key === 'Enter') {
            const name = input.value.trim();
            chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: pendingCommand, args: name }).catch(() => {});
            pendingCommand = null;
            hidePalette();
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
        const currentQuery = getSearchQuery();
        if (!isActionMode && currentQuery && currentQuery !== lastSearchedQuery) {
            chrome.runtime.sendMessage({ action: 'open-query', query: currentQuery }).catch(() => {});
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


function renderPendingHint(commandId) {
    const TIME_COMMANDS = ['set_clean_time', 'set_hibernate_time'];
    const NAME_COMMANDS = ['save_workspace', 'save_window_all', 'save_group', 'stash_group'];
    const URL_COMMANDS  = ['set_baseline_url'];

    let iconSvg, lines;

    if (TIME_COMMANDS.includes(commandId)) {
        iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
        lines = [
            `Use <strong>m</strong> for minutes, <strong>h</strong> for hours`,
            `Examples: <code>30m</code> &nbsp;·&nbsp; <code>2h</code> &nbsp;·&nbsp; <code>12h</code>`
        ];
    } else if (NAME_COMMANDS.includes(commandId)) {
        iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        lines = [
            `Type a <strong>name</strong> for this set`,
            `Examples: <code>Work</code> &nbsp;·&nbsp; <code>Research</code> &nbsp;·&nbsp; <code>Morning Tabs</code>`
        ];
    } else if (URL_COMMANDS.includes(commandId)) {
        iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
        lines = [
            `Paste or type a <strong>URL</strong> for this tab`,
            `Examples: <code>https://example.com</code>`
        ];
    } else if (commandId === 'save_prompt_data') {
        iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
        lines = [
            `Type a <strong>name</strong> for this prompt`,
            `Examples: <code>Follow-up email</code> &nbsp;·&nbsp; <code>Code review ask</code>`
        ];
    } else if (commandId === 'save_prompt_empty') {
        iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        lines = [
            `Select text on the page first, then try again`,
            `Tip: highlight any snippet and run <code>&gt;save prompt</code>`
        ];
    } else {
        return; // no hint for unknown commands
    }

    resultsContainer.classList.add('has-items');
    resultsContainer.innerHTML = `
        <div class="pending-hint">
            <div class="pending-hint-format">
                <div class="pending-hint-format-icon">${iconSvg}</div>
                <div class="pending-hint-format-text">${lines.join('<br>')}</div>
            </div>
            <div class="pending-hint-keys">
                <kbd>Enter</kbd><span class="sep">to confirm</span>
                <span class="sep">&nbsp;·&nbsp;</span>
                <kbd>Esc</kbd><span class="sep">to cancel</span>
            </div>
        </div>
    `;
}

function activateResult(result) {
    if (result.type === 'action') {
        if (result.id === 'extract_media') {
            isMediaMode = true;
            selectedMediaIds.clear();
            input.value = '';
            input.placeholder = 'Filter media (e.g. "png w > 1000")...';
            extractMediaFromPage();
            renderMediaResults(extractedMedia);
            return;
        }

        if (result.id === 'show_prompts') {
            isPromptsMode = true;
            cachedAllPrompts = [];
            input.value = '';
            input.placeholder = 'Loading prompts...';
            renderPromptsResults([]);
            chrome.runtime.sendMessage({ action: 'get-prompts' }, (response) => {
                if (chrome.runtime.lastError || !response?.prompts) {
                    renderPromptsResults([]);
                    input.placeholder = 'Filter prompts (name or text)...';
                    return;
                }
                cachedAllPrompts = response.prompts;
                input.placeholder = 'Filter prompts (name or text)...';
                renderPromptsResults(cachedAllPrompts);
            });
            return;
        }

        if (result.id === 'save_prompt') {
            let selection = '';
            try { selection = window.getSelection() ? window.getSelection().toString() : ''; }
            catch (e) { selection = ''; }
            selection = (selection || '').trim();
            if (!selection) selection = cachedSelectionAtOpen || '';
            resultsContainer.className = 'results has-items';
            resultsContainer.innerHTML = '';
            if (!selection) {
                renderPendingHint('save_prompt_empty');
                return;
            }
            pendingCommand = 'save_prompt_data';
            pendingPromptText = selection;
            input.value = '';
            input.placeholder = 'Name for this prompt...';
            renderPendingHint('save_prompt_data');
            return;
        }

        if (result.id === 'save_workspace' || result.id === 'save_group' || result.id === 'stash_group' || result.id === 'set_baseline_url' || result.id === 'save_window_all' || result.id === 'set_clean_time' || result.id === 'set_hibernate_time') {
            pendingCommand = result.id;
            input.value = '';
            const promptMap = {
                'save_workspace': 'Set name...',
                'save_window_all': 'Set name...',
                'save_group': 'Set name...',
                'stash_group': 'Set name...',
                'set_baseline_url': 'Paste URL...',
                'set_clean_time': 'Enter close time...',
                'set_hibernate_time': 'Enter sleep time...'
            };
            input.placeholder = promptMap[result.id] || 'Type value...';
            resultsContainer.innerHTML = '';
            resultsContainer.className = 'results';
            renderPendingHint(result.id);
            return;
        }

        if (result.id.startsWith('copy_clipboard|')) {
            const text = result.id.split('|')[1];
            navigator.clipboard.writeText(text).catch(() => {});
            input.value = `Copied: ${text}`;
            input.style.color = '#4ade80';
            focusTimeouts.push(setTimeout(() => { hidePalette(); }, 400));
            return;
        }

        chrome.runtime.sendMessage({ action: 'execute-browser-action', commandId: result.id }).catch(() => {});
    } else if (result.type === 'tab') {
        chrome.runtime.sendMessage({ action: 'switch-to-tab', tabId: result.id, windowId: result.windowId }).catch(() => {});
    } else {
        // Includes 'search', 'navigate', 'history', 'bookmark', 'bang', 'closed'
        chrome.runtime.sendMessage({ action: 'open-url', url: result.url }).catch(() => {});
    }
    hidePalette();
}

// Intercept clicks for Transient Peek Windows
function isPeekBlockedHost() {
    const list = settings.peekExcludedDomains;
    if (!list || !list.length) return false;
    try {
        const hostname = window.location.hostname;
        for (const excluded of list) {
            if (hostname === excluded || hostname.endsWith('.' + excluded)) return true;
        }
    } catch (e) {}
    return false;
}

document.addEventListener('click', (e) => {
    // Ignore middle clicks or command/ctrl/alt clicks
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;

    const link = e.target.closest('a');
    if (!link || !link.href || !link.href.startsWith('http')) return;

    let isCrossDomain = false;
    try {
        isCrossDomain = new URL(link.href).hostname !== window.location.hostname;
    } catch(err) {}

    if (e.shiftKey || (settings.autoPeekCrossDomain && isCrossDomain && !isPeekBlockedHost())) {
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
        .peek-controls {
            position: fixed;
            top: 24px;
            right: 24px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            z-index: 2147483647;
        }

        .control-btn {
            width: 44px;
            height: 44px;
            background: rgba(28, 28, 30, 0.5);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #ffffff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            padding: 0;
            outline: none;
        }

        .control-btn:hover {
            background: rgba(45, 45, 48, 0.7);
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
            border-color: rgba(255, 255, 255, 0.2);
        }

        @media (prefers-color-scheme: light) {
            .control-btn {
                background: rgba(255, 255, 255, 0.7);
                color: #000000;
                border-color: rgba(0, 0, 0, 0.08);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            }
        }

        .control-btn:hover {
            transform: scale(1.1);
            background: rgba(28, 28, 30, 0.85);
            border-color: rgba(255, 255, 255, 0.25);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
        }
        
        @media (prefers-color-scheme: light) {
             .control-btn:hover {
                 background: rgba(255, 255, 255, 0.9);
                 border-color: rgba(0, 0, 0, 0.15);
             }
        }

        .control-btn:active {
            transform: scale(0.95);
        }

        .icon {
            font-size: 20px;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .close-btn .icon { font-size: 18px; }
    `;

    const container = document.createElement('div');
    container.className = 'peek-controls';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'control-btn close-btn';
    closeBtn.title = 'Close Peek (Esc)';
    closeBtn.innerHTML = `<span class="icon">✕</span>`;
    closeBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: 'close-peek' }).catch(() => {});
    };

    const promoteBtn = document.createElement('button');
    promoteBtn.className = 'control-btn promote-btn';
    promoteBtn.title = 'Promote to Workspace';
    promoteBtn.innerHTML = `<span class="icon">↗</span>`;
    promoteBtn.onclick = () => {
        host.remove();
        chrome.runtime.sendMessage({ action: 'promote-peek' }).catch(() => {});
    };

    container.appendChild(closeBtn);
    container.appendChild(promoteBtn);

    shadow.appendChild(style);
    shadow.appendChild(container);
    document.documentElement.appendChild(host);

    // Global ESC listener for the Peek window
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.close();
    });
}

// Cleanup: When user returns to a parent tab after a Peek, ensure blur is removed
// even if the remove-parent-blur message was missed (e.g. network/reload race).
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && blurOverlay && blurOverlay.style.opacity === '1') {
        // Verify we still have a Peek open; if not, remove the blur
        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ action: 'check-peek-status' }, (response) => {
                if (chrome.runtime.lastError || !response?.isPeek) {
                    toggleParentBlur(false);
                }
            });
        } else {
            // Extension context lost — force remove blur immediately
            toggleParentBlur(false);
        }
    }
});

// ─────────────────────────────────────────────
//  Picture-in-Picture Tool
// ─────────────────────────────────────────────
async function togglePictureInPicture() {
    if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
    }
    
    // Find all videos that have loaded metadata (have width)
    const videos = Array.from(document.querySelectorAll('video'))
        .filter(v => v.readyState > 0 && v.videoWidth > 0);
        
    if (videos.length === 0) {
        alert("Tabs++: No active video found on this page.");
        return;
    }
    
    // Try to find playing video, or largest video
    let targetVideo = videos.find(v => !v.paused);
    
    if (!targetVideo) {
        // Find largest by area
        targetVideo = videos.reduce((largest, current) => {
            const lRect = largest.getBoundingClientRect();
            const cRect = current.getBoundingClientRect();
            return (cRect.width * cRect.height > lRect.width * lRect.height) ? current : largest;
        });
    }
    
    try {
        await targetVideo.requestPictureInPicture();
    } catch (e) {
        console.error("Tabs++ PiP Error:", e);
        alert("Tabs++: Could not activate Picture-in-Picture. The video might not support it or requires interaction first.");
    }
}

function getVideoTimestamp() {
    const v = document.querySelector('video');
    if (!v || isNaN(v.currentTime)) return null;
    
    const seconds = Math.floor(v.currentTime);
    const host = window.location.hostname;
    
    if (host.includes('youtube.com')) return `${seconds}s`;
    if (host.includes('twitch.tv')) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}h${m}m${s}s`;
    }
    if (host.includes('vimeo.com')) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m${s}s`;
    }
    return `${seconds}s`;
}

// ─────────────────────────────────────────────
//  Auto Picture-in-Picture Logic
// ─────────────────────────────────────────────
// Automatically apply the autopictureinpicture attribute to any playing video.
// This allows the browser to seamlessly pop the video out when switching tabs.
document.addEventListener('play', (e) => {
    if (settings.autoPiP && e.target && e.target.tagName === 'VIDEO') {
        if (!e.target.hasAttribute('autopictureinpicture')) {
            e.target.setAttribute('autopictureinpicture', '');
        }
    }
}, true);

/* =========================================================================
   EYEDROPPER TOOL (CUSTOM CANVAS MULTI-PLATFORM)
   ========================================================================= */
function startCustomEyedropper(dataUrl) {
    if (document.getElementById('tabs-plus-plus-custom-eyedropper')) return;

    const host = document.createElement('div');
    host.id = 'tabs-plus-plus-custom-eyedropper';
    host.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        cursor: none;
        background: transparent;
    `;

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        .overlay {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
        }
        .magnifier {
            position: absolute;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            border: 2px solid rgba(255, 255, 255, 0.9);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.2);
            pointer-events: none;
            overflow: hidden;
            transform: translate(-50%, -50%);
            display: none;
            background-color: #000;
            image-rendering: pixelated;
            image-rendering: crisp-edges;
        }
        .crosshair {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 8px;
            height: 8px;
            transform: translate(-50%, -50%);
            border: 1px solid rgba(255, 255, 255, 0.9);
            box-shadow: 0 0 2px rgba(0,0,0,0.8), inset 0 0 2px rgba(0,0,0,0.8);
            pointer-events: none;
            border-radius: 50%;
        }
        
        .toast {
            position: fixed;
            bottom: 30px;
            left: 0; right: 0;
            margin: 0 auto;
            width: max-content;
            transform: translateY(20px);
            background: rgba(22, 22, 26, 0.85);
            backdrop-filter: blur(24px) saturate(200%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #fff;
            padding: 12px 20px;
            border-radius: 99px;
            font-size: 14px;
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 500;
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: auto;
            box-shadow: 0 16px 32px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .swatch-color {
            width: 18px; height: 18px; border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
            cursor: pointer;
            transition: transform 0.2s;
        }
        .swatch-color:hover {
            transform: scale(1.2);
        }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const magnifier = document.createElement('div');
    magnifier.className = 'magnifier';
    
    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';
    magnifier.appendChild(crosshair);

    const toast = document.createElement('div');
    toast.className = 'toast';

    shadow.appendChild(style);
    shadow.appendChild(overlay);
    shadow.appendChild(magnifier);
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);

    const zoom = 2.5;
    const size = 100;
    const halfSize = size / 2;

    let eyedropperTimerId = null;
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        const ratioX = img.width / window.innerWidth;
        const ratioY = img.height / window.innerHeight;

        magnifier.style.backgroundImage = `url(${dataUrl})`;
        magnifier.style.backgroundRepeat = 'no-repeat';
        magnifier.style.backgroundSize = `${window.innerWidth * zoom}px ${window.innerHeight * zoom}px`;
        
        // Do not display the magnifier immediately. 
        // We cannot read mouse coordinates without an event, so we wait for the first mousemove.
        
        let hasMoved = false;
        const updateMagnifier = (e) => {
            if (!hasMoved) {
                magnifier.style.display = 'block';
                hasMoved = true;
            }
            magnifier.style.left = `${e.clientX}px`;
            magnifier.style.top = `${e.clientY}px`;
            const bgX = -(e.clientX * zoom - halfSize);
            const bgY = -(e.clientY * zoom - halfSize);
            magnifier.style.backgroundPosition = `${bgX}px ${bgY}px`;
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                window.removeEventListener('keydown', handleEscape);
                host.remove();
            }
        };

        window.addEventListener('keydown', handleEscape);
        overlay.addEventListener('mousemove', updateMagnifier);

        overlay.addEventListener('click', (e) => {
            window.removeEventListener('keydown', handleEscape);
            
            const x = Math.round(e.clientX * ratioX);
            const y = Math.round(e.clientY * ratioY);
            
            let hex = '#000000';
            try {
                // Read a slightly larger area to ensure we hit the pixel securely if rounding is off
                const pixel = ctx.getImageData(x, y, 1, 1).data;
                const r = pixel[0], g = pixel[1], b = pixel[2];
                const toHex = (c) => c.toString(16).padStart(2, '0').toUpperCase();
                hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            } catch (err) {
                console.error("Tabs++ Eyedropper Error:", err);
            }

            // Copy to clipboard
            navigator.clipboard.writeText(hex).catch(() => {
                const el = document.createElement('textarea');
                el.value = hex;
                el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
            });

            // Update UI
            magnifier.style.display = 'none';
            overlay.style.pointerEvents = 'none';
            host.style.cursor = 'default';
            
            // Save History & Render Toast
            chrome.storage.local.get(['colorHistory'], (data) => {
                let history = data.colorHistory || [];
                history = history.filter(c => c !== hex);
                history.unshift(hex);
                if (history.length > 5) history = history.slice(0, 5);
                chrome.storage.local.set({ colorHistory: history }).catch(() => {});

                toast.innerHTML = '';
                
                const createClickableSwatch = (color) => {
                    const s = document.createElement('div');
                    s.className = 'swatch-color';
                    s.style.background = color;
                    s.title = `Copy ${color}`;
                    s.addEventListener('click', () => {
                        navigator.clipboard.writeText(color).catch(() => {
                            const el = document.createElement('textarea');
                            el.value = color;
                            el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
                            document.body.appendChild(el);
                            el.select();
                            document.execCommand('copy');
                            document.body.removeChild(el);
                        });
                        // Provide visual feedback for the copy action
                        s.style.transform = 'scale(1.4)';
                        setTimeout(() => s.style.transform = '', 150);
                    });
                    return s;
                };

                toast.appendChild(createClickableSwatch(hex));
                
                if (history.length > 1) {
                    const divider = document.createElement('div');
                    divider.style.cssText = 'width: 1px; height: 18px; background: rgba(255,255,255,0.2); margin: 0 4px;';
                    toast.appendChild(divider);
                    
                    history.slice(1).forEach(c => {
                        toast.appendChild(createClickableSwatch(c));
                    });
                }
                
                toast.classList.add('show');

                const startToastTimer = () => {
                    if (eyedropperTimerId) clearTimeout(eyedropperTimerId);
                    eyedropperTimerId = setTimeout(() => {
                        toast.classList.remove('show');
                        setTimeout(() => host.remove(), 300);
                    }, 5000);
                };

                startToastTimer();

                toast.addEventListener('mouseenter', () => {
                    if (eyedropperTimerId) clearTimeout(eyedropperTimerId);
                });

                toast.addEventListener('mouseleave', () => {
                    startToastTimer();
                });
            });
        });
    };
}

let _ssProgressHost = null;

async function startScreenshotCapture() {
    if (_ssProgressHost) return; // Already running

    // 1. Show progress bar inside a pill
    _ssProgressHost = document.createElement('div');
    _ssProgressHost.id = 'tabs-plus-plus-progress-host';
    _ssProgressHost.style.cssText = `
        position: fixed; bottom: 30px; left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        width: 140px; height: 36px;
        background: rgba(22,22,26,0.85);
        backdrop-filter: blur(24px) saturate(200%);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 99px;
        box-shadow: 0 16px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08);
        pointer-events: none;
        opacity: 0; transition: opacity 0.3s;
        display: flex; align-items: center; justify-content: center;
        padding: 0 16px; box-sizing: border-box;
    `;
    
    const track = document.createElement('div');
    track.style.cssText = `
        width: 100%; height: 4px;
        background: rgba(255,255,255,0.15);
        border-radius: 99px;
        overflow: hidden;
    `;

    const progressFill = document.createElement('div');
    progressFill.id = 'tabs-plus-plus-progress-fill';
    progressFill.style.cssText = `
        width: 0%; height: 100%;
        background: #fff;
        border-radius: 99px;
        transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    
    track.appendChild(progressFill);
    _ssProgressHost.appendChild(track);
    document.documentElement.appendChild(_ssProgressHost);
    requestAnimationFrame(() => { if (_ssProgressHost) _ssProgressHost.style.opacity = '1'; });

    const savedScrollY = window.scrollY;

    // 2. Hide fixed/sticky elements
    const hiddenEls = [];
    document.querySelectorAll('*').forEach(el => {
        if (el.id === 'tabs-plus-plus-progress-host' || el.id === 'tabs-plus-plus-screenshot-preview') return;
        try {
            const pos = window.getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') {
                hiddenEls.push({ el, original: el.style.cssText });
                el.style.setProperty('display', 'none', 'important');
            }
        } catch (e) {
            // Ignore elements that throw on getComputedStyle (e.g., cross-origin iframes)
        }
    });

    const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const pageWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // 3. Set up canvas
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = pageWidth * dpr;
    canvas.height = pageHeight * dpr;
    const ctx = canvas.getContext('2d');

    const numSteps = Math.ceil(pageHeight / viewportHeight);

    try {
        // 4. Scroll loop — content drives, background just captures
        for (let i = 0; i < numSteps; i++) {
            const targetY = Math.min(i * viewportHeight, Math.max(0, pageHeight - viewportHeight));
            window.scrollTo({ top: targetY, behavior: 'instant' });

            // Wait for paint
            await new Promise(r => setTimeout(r, 200));

            // Hide progress pill during capture so it doesn't appear in the screenshot
            if (_ssProgressHost) _ssProgressHost.style.display = 'none';
            await new Promise(r => requestAnimationFrame(r));
            const response = await chrome.runtime.sendMessage({ action: 'capture-viewport' });
            if (_ssProgressHost) _ssProgressHost.style.display = 'flex';
            if (!response?.dataUrl) continue;

            // Draw slice onto canvas
            await new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, targetY * dpr, img.width, img.height);
                    resolve();
                };
                img.onerror = resolve;
                img.src = response.dataUrl;
            });
            
            // Update progress
            if (_ssProgressHost) {
                const percent = Math.round(((i + 1) / numSteps) * 100);
                const fill = _ssProgressHost.querySelector('#tabs-plus-plus-progress-fill');
                if (fill) fill.style.width = `${percent}%`;
            }
        }
    } catch (e) {
        console.error('[Tabs++] Screenshot error:', e);
    }

    // 5. Restore page
    hiddenEls.forEach(({ el, original }) => { 
        if (original) el.style.cssText = original; 
        else el.style.cssText = ''; 
    });
    window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    if (_ssProgressHost) {
        _ssProgressHost.style.opacity = '0';
        setTimeout(() => { _ssProgressHost?.remove(); _ssProgressHost = null; }, 300);
    } else {
        _ssProgressHost = null;
    }

    // 6. Export and show preview
    canvas.toBlob(blob => {
        if (blob) showScreenshotPreview(blob, pageWidth, pageHeight);
    }, 'image/png');
}

function showScreenshotPreview(blob, pageWidth, pageHeight) {
    const objectUrl = URL.createObjectURL(blob);
    const host = document.createElement('div');
    host.id = 'tabs-plus-plus-screenshot-preview';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        .card {
            position: fixed; bottom: 30px; left: 50%; z-index: 2147483647;
            background: rgba(22, 22, 26, 0.85);
            backdrop-filter: blur(24px) saturate(200%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 99px;
            box-shadow: 0 16px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08);
            display: flex; align-items: center; gap: 12px;
            padding: 8px 8px 8px 16px;
            opacity: 0; transform: translateX(-50%) translateY(20px);
            transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            font-family: system-ui, -apple-system, sans-serif;
        }
        .card.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        .text-col { display: flex; align-items: center; justify-content: center; padding-left: 4px; }
        .dims { color: #fff; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; font-family: monospace; }
        .actions { display: flex; gap: 6px; margin-left: 8px; }
        .btn {
            padding: 8px; border-radius: 50%; border: none;
            cursor: pointer; transition: all 0.15s; 
            display: flex; align-items: center; justify-content: center;
        }
        .btn-dl { background: rgba(255,255,255,0.15); color: #fff; }
        .btn-dl:hover { background: rgba(255,255,255,0.25); transform: scale(1.1); }
        .btn-copy { background: rgba(99,179,237,0.15); color: #63b3ed; }
        .btn-copy:hover { background: rgba(99,179,237,0.25); transform: scale(1.1); }
        .btn.copied { background: rgba(74,222,128,0.2); color: #4ade80; }
    `;

    const card = document.createElement('div');
    card.className = 'card';

    const textCol = document.createElement('div');
    textCol.className = 'text-col';

    const dims = document.createElement('div');
    dims.className = 'dims';
    dims.textContent = `${pageWidth} × ${pageHeight}px`;
    
    textCol.appendChild(dims);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn btn-dl';
    dlBtn.title = 'Download PNG';
    dlBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-copy';
    copyBtn.title = 'Copy Image';
    copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    actions.appendChild(dlBtn);
    actions.appendChild(copyBtn);

    card.appendChild(textCol);
    card.appendChild(actions);
    shadow.appendChild(style);
    shadow.appendChild(card);
    document.documentElement.appendChild(host);

    requestAnimationFrame(() => card.classList.add('visible'));

    let timer;
    const dismiss = () => {
        card.classList.remove('visible');
        document.removeEventListener('keydown', handleEsc);
        setTimeout(() => { host.remove(); URL.revokeObjectURL(objectUrl); }, 350);
    };
    
    const handleEsc = (e) => {
        if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', handleEsc);

    const startTimer = () => { timer = setTimeout(dismiss, 10000); };
    const clearTimer = () => clearTimeout(timer);

    card.addEventListener('mouseenter', clearTimer);
    card.addEventListener('mouseleave', startTimer);
    startTimer();

    dlBtn.addEventListener('click', () => {
        const hostname = (location.hostname || 'page').replace(/^www\./, '');
        const date = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `${hostname}-${date}.png`;
        a.click();
    });

    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            copyBtn.classList.add('copied');
            setTimeout(() => { 
                copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`; 
                copyBtn.classList.remove('copied'); 
            }, 2000);
        } catch (e) {
            copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            setTimeout(() => { 
                copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`; 
            }, 2000);
        }
    });
}

/* =========================================================================
   READER MODE (FOCUS VIEW)
   ========================================================================= */
let readerHost = null;
let _readerEscHandler = null;

function toggleReaderView() {
    if (readerHost) {
        // Clean up Esc listener if it wasn't already removed
        if (_readerEscHandler) {
            document.removeEventListener('keydown', _readerEscHandler);
            _readerEscHandler = null;
        }
        const shadow = readerHost.shadowRoot;
        const overlay = shadow.querySelector('.reader-overlay');
        overlay.classList.remove('visible');
        setTimeout(() => {
            readerHost?.remove();
            readerHost = null;
            document.body.style.overflow = '';
        }, 400);
        return;
    }

    const article = extractArticleContent();
    if (!article) {
        alert("Couldn't find enough content to focus on this page.");
        return;
    }

    readerHost = document.createElement('div');
    readerHost.id = 'tabs-plus-plus-reader-host';
    const shadow = readerHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = READER_STYLES;

    const overlay = document.createElement('div');
    overlay.className = 'reader-overlay';
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'reader-close';
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.addEventListener('click', toggleReaderView);

    const container = document.createElement('div');
    container.className = 'reader-container';

    // Safe text nodes for title — no innerHTML with raw content
    const header = document.createElement('div');
    header.className = 'reader-header';
    const h1 = document.createElement('h1');
    h1.textContent = article.title;
    header.appendChild(h1);

    // Safe meta — use textContent on individual spans
    const meta = document.createElement('div');
    meta.className = 'reader-meta';
    const siteSpan = document.createElement('span');
    siteSpan.textContent = article.siteName || location.hostname;
    meta.appendChild(siteSpan);
    if (article.byline) {
        const dot1 = document.createElement('span'); dot1.textContent = '•'; meta.appendChild(dot1);
        const bylineSpan = document.createElement('span'); bylineSpan.textContent = article.byline; meta.appendChild(bylineSpan);
    }
    const dot2 = document.createElement('span'); dot2.textContent = '•'; meta.appendChild(dot2);
    const timeSpan = document.createElement('span'); timeSpan.textContent = `${article.readingTime} min read`; meta.appendChild(timeSpan);

    const body = document.createElement('div');
    body.className = 'reader-body';
    body.innerHTML = article.content;

    // Final cleanup pass — belt AND suspenders:
    // strip any media that survived the extraction phase,
    // then strip inline styles/classes/data-attrs from all remaining nodes.
    body.querySelectorAll('img, svg, picture, figure, figcaption, video, audio, canvas, iframe, embed, object, [role="img"], [role="presentation"]').forEach(el => el.remove());
    body.querySelectorAll('*').forEach(el => {
        // Remove all inline style and class overrides so our reader CSS wins
        el.removeAttribute('style');
        el.removeAttribute('class');
        el.removeAttribute('id');
        // Remove data-* attrs that often carry layout/visibility hints
        [...el.attributes].filter(a => a.name.startsWith('data-')).forEach(a => el.removeAttribute(a.name));
    });

    // Remove completely empty block elements (leftover wrappers with no text)
    body.querySelectorAll('div, span, section, aside, header, footer').forEach(el => {
        if (!el.textContent.trim()) el.remove();
    });

    container.appendChild(header);
    container.appendChild(meta);
    container.appendChild(body);
    overlay.appendChild(closeBtn);
    overlay.appendChild(container);
    
    shadow.appendChild(style);
    shadow.appendChild(overlay);
    document.documentElement.appendChild(readerHost);

    document.body.style.overflow = 'hidden';

    // Trigger animation
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });

    // Handle Esc — store ref so close button can also clean it up
    _readerEscHandler = (e) => {
        if (e.key === 'Escape' && readerHost) {
            toggleReaderView();
        }
    };
    document.addEventListener('keydown', _readerEscHandler);
}

function extractArticleContent() {
    // 1. Get Title — prefer og:title, then h1, then document.title
    const ogTitle = document.querySelector('[property="og:title"]')?.content;
    let title = ogTitle || document.querySelector('h1')?.innerText?.trim() || document.title;

    // 2. Find Content — priority order: <article> > [role=main] > <main> > scored fallback
    // Prefer the most specific semantic element first to avoid wrapping the whole page
    const SELECTORS = [
        'article',
        '[role="article"]',
        '[role="main"]',
        '.post-content, .article-content, .entry-content, .post-body',
        'main',
    ];

    let bestElem = null;
    for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el && el.innerText.length > 200) {
            bestElem = el;
            break;
        }
    }

    // 3. Scored fallback — look for the div/section with the best content density
    // Penalise very large containers (likely wrappers) and known junk containers
    if (!bestElem) {
        const bodyTextLen = document.body.innerText.length;
        let maxScore = 0;
        document.querySelectorAll('div, section').forEach(el => {
            const idClass = (el.id + ' ' + el.className).toLowerCase();
            // Skip known junk
            if (/nav|sidebar|side-bar|footer|header|menu|advertisement|comment|social|share/.test(idClass)) return;

            const pCount = el.querySelectorAll('p').length;
            const textLen = el.innerText.length;
            if (textLen < 200) return;

            // Density: how much of the body's text does this element account for?
            // Heavily penalise elements that are >80% of the body (likely wrappers).
            const density = textLen / bodyTextLen;
            const densityPenalty = density > 0.8 ? 0.3 : 1;

            const score = (pCount * 100 + textLen) * densityPenalty;

            if (score > maxScore) {
                maxScore = score;
                bestElem = el;
            }
        });

        if (bestElem && !bestElem.matches('article, main, [role="article"], [role="main"]')) {
            const parent = bestElem.parentElement;
            if (parent) {
                const parentLen = parent.innerText.length;
                if (parentLen > bestElem.innerText.length * 1.3 && parentLen < bodyTextLen * 1.5) {
                    bestElem = parent;
                }
            }
        }
    }

    if (!bestElem || bestElem.innerText.length < 200) return null;

    // 4. Clone and clean
    const clone = bestElem.cloneNode(true);

    // Remove junk/structural elements
    clone.querySelectorAll('script, style, iframe, nav, footer, aside, form, button, input, select, textarea, [aria-hidden="true"]').forEach(el => el.remove());

    // Remove common ad/junk class patterns (word-boundary match to avoid false positives like "commentary")
    const junkRe = /\b(sidebar|comment|comments|related|promo|newsletter|social|share|shares|widget|banner|cookie)\b/i;
    clone.querySelectorAll('*').forEach(el => {
        if (junkRe.test(el.className)) el.remove();
    });

    // ── KEY FIX: strip ALL media / decorative elements ──
    // Reader mode = text only. Images, SVGs, figures, videos, canvases all go.
    // Preserve figcaption text as plain paragraphs since it often contains article narrative.
    clone.querySelectorAll('figure').forEach(fig => {
        const caption = fig.querySelector('figcaption');
        if (caption && caption.textContent.trim()) {
            const p = document.createElement('p');
            p.textContent = caption.textContent.trim();
            fig.parentNode.insertBefore(p, fig);
        }
        fig.remove();
    });
    clone.querySelectorAll('img, svg, picture, video, audio, canvas, embed, object, [role="img"], [role="presentation"]').forEach(el => el.remove());

    clone.querySelectorAll('*').forEach(el => {
        const tag = el.tagName;
        if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI'].includes(tag)) return;
        const text = el.textContent.trim();
        if (text.length < 40) { el.remove(); return; }
        const links = el.querySelectorAll('a');
        let linkText = 0;
        links.forEach(a => linkText += a.textContent.trim().length);
        if (linkText > 0 && linkText / text.length > 0.5) el.remove();
    });

    // 5. Meta info
    const byline = document.querySelector('[itemprop="author"] [itemprop="name"], [rel="author"], .author-name, .byline')?.innerText?.trim() || "";
    const siteName = document.querySelector('[property="og:site_name"]')?.content || "";
    const wordCount = bestElem.innerText.split(/\s+/).length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 200));

    return {
        title,
        content: clone.innerHTML,
        byline,
        siteName,
        readingTime
    };
}
})();
