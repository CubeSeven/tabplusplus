export const NTP_URL = chrome.runtime.getURL('ntp.html');

export const DEFAULT_SETTINGS = {
    protectPinned: true,
    protectGrouped: true,
    enablePalette: true,
    enableAutoGroup: false,
    focusNTPOnClose: false,
    autoCollapseGroups: false,
    enableAutoArchive: false,
    autoPiP: false,
    enableEyedropper: true,
    enableScreenshot: true,
    enableUnitConverter: true,
    enablePomo: false,
    enableFocusView: true,
    baseRemSize: 16,
    ntpBgDesign: 0,
    archiveThresholdRaw: '12h',
    hibernateThresholdRaw: '1h',
    enableAutoHibernate: false,
    enableMediaExtractor: false,
    enableVolumeControl: true,
    timeFormat: '24h',
    showClock: true,
    autoPeekCrossDomain: false,
    searchEngine: 'google',
    useDefaultNtp: false,
    peekExcludedDomains: ['google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com', 'perplexity.ai', 'x.com', 'twitter.com', 'reddit.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'twitch.tv', 'vimeo.com', 'news.ycombinator.com', 'amazon.com', 'ebay.com'],
    // Optional-permission-gated features (off by default; toggled on in popup,
    // which triggers a just-in-time chrome.permissions.request at that moment).
    enableHistory: false,
    enableBookmarks: false,
    enableRecentlyClosed: false,
    enablePanicClose: false
};

export const GROUPING_RULES = [
    { title: 'Dev', color: 'blue', domains: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'aws.amazon.com', 'console.cloud.google.com', 'vercel.com', 'netlify.com', 'docker.com', 'cloudflare.com', 'jira.com', 'atlassian.net', 'linear.app', 'developer.mozilla.org', 'npmjs.com', 'codepen.io', 'replit.com', 'codesandbox.io', 'postman.com', 'sentry.io', 'datadoghq.com', 'cursor.sh', 'cursor.com', 'warp.dev', 'bun.sh', 'railway.app', 'supabase.com', 'huggingface.co', 'leetcode.com', 'geeksforgeeks.org', 'pypi.org', 'hub.docker.com', 'crates.io', 'search.maven.org', 'codeberg.org', 'sourcehut.org', 'freecodecamp.org', 'khanacademy.org', 'w3schools.com', 'developer.android.com', 'developer.apple.com', 'learn.microsoft.com', 'developers.google.com', 'developer.chrome.com', 'web.dev', 'nodejs.org', 'python.org', 'go.dev', 'rust-lang.org', 'php.net', 'ruby-lang.org', 'react.dev', 'vuejs.org', 'angular.io', 'svelte.dev', 'nextjs.org', 'nuxt.com', 'astro.build', 'solidjs.com', 'vitejs.dev', 'getbootstrap.com', 'tailwindcss.com', 'kubernetes.io', 'heroku.com', 'render.com', 'fly.io', 'digitalocean.com', 'stripe.com', 'grafana.com', 'newrelic.com', 'packagist.org', 'rubygems.org', 'pkg.go.dev'] },
    { title: 'Design', color: 'purple', domains: ['figma.com', 'canva.com', 'dribbble.com', 'behance.net', 'miro.com', 'framer.com', 'spline.design', 'adobe.com', 'awwwards.com', 'lottiefiles.com', 'unsplash.com', 'pexels.com', 'colorhunt.co', 'sketch.com', 'invisionapp.com', 'principleformac.com', 'zeplin.io', 'affinity.serif.com', 'coreldraw.com', 'muz.li', 'land-book.com', 'siteinspire.com', 'fontshare.com', 'fonts.google.com', 'coolors.co', 'iconify.design', 'flaticon.com', 'readymag.com', 'typedream.com', 'poly.cam', 'sketchfab.com', 'penpot.app', 'photopea.com', 'rive.app', 'freepik.com', 'pixabay.com', 'vecteezy.com', 'iconfinder.com', 'heroicons.com', 'lucide.dev', 'tabler-icons.com', 'fontawesome.com', 'boxicons.com', 'remixicon.com', 'fonts.adobe.com', 'themeforest.net', 'elements.envato.com', 'creative-tim.com'] },
    { title: 'AI', color: 'green', domains: ['chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'grok.com', 'deepseek.com', 'poe.com', 'midjourney.com', 'leonardo.ai', 'runwayml.com', 'pika.art', 'suno.com', 'udio.com', 'elevenlabs.io', 'zapier.com', 'make.com', 'gamma.app', 'notebooklm.google.com', 'consensus.app', 'phind.com', 'anthropic.com', 'cohere.com', 'mistral.ai', 'you.com', 'copy.ai', 'jasper.ai', 'kaggle.com', 'replicate.com', 'together.ai', 'v0.dev', 'bolt.new', 'character.ai', 'meta.ai', 'ideogram.ai', 'copilot.microsoft.com', 'manus.ai'] },
    { title: 'Media', color: 'red', domains: ['youtube.com', 'netflix.com', 'spotify.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'vimeo.com', 'soundcloud.com', 'music.apple.com', 'plex.tv', 'crunchyroll.com', 'paramountplus.com', 'peacocktv.com', 'mubi.com', 'nebula.tv', 'curiositystream.com', 'steampowered.com', 'epicgames.com', 'ign.com', 'gamespot.com', 'roblox.com', 'letterboxd.com', 'pocketcasts.com', 'mixcloud.com', 'bandcamp.com', 'tidal.com', 'audible.com', 'pandora.com', 'max.com', 'tv.apple.com', 'tubitv.com', 'dailymotion.com', 'kick.com', 'deezer.com', 'last.fm', 'discogs.com', 'goodreads.com', 'archive.org', 'odysee.com', 'rumble.com', 'itch.io', 'gog.com', 'battle.net', 'chess.com', 'lichess.org', 'mangadex.org'] },
    { title: 'News', color: 'yellow', domains: ['nytimes.com', 'bbc.com', 'news.google.com', 'theverge.com', 'techcrunch.com', 'wsj.com', 'news.ycombinator.com', 'bloomberg.com', 'cnn.com', 'reuters.com', 'theguardian.com', 'hbr.org', 'wired.com', 'arstechnica.com', 'apnews.com', 'aljazeera.com', 'fortune.com', 'forbes.com', 'qz.com', 'mashable.com', 'engadget.com', 'gizmodo.com', 'medium.com', 'substack.com', 'ted.com', 'wikipedia.org', 'marketwatch.com', 'investopedia.com', 'finance.yahoo.com', 'seekingalpha.com', 'economist.com', 'npr.org', 'washingtonpost.com', 'time.com', 'politico.com', 'axios.com', 'nbcnews.com', 'ft.com', 'theatlantic.com', 'newyorker.com', 'nature.com', 'scientificamerican.com', 'technologyreview.com', 'venturebeat.com', 'techradar.com', 'tomshardware.com', 'producthunt.com', 'dev.to', 'vox.com', 'propublica.org', 'arxiv.org', 'space.com'] },
    { title: 'Social', color: 'cyan', domains: ['x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'discord.com', 'web.whatsapp.com', 'messenger.com', 'tumblr.com', 'threads.net', 'bsky.app', 'polywork.com', 'slack.com', 'mastodon.social', 'fark.com', 'quora.com', 'nextdoor.com', 'wechat.com', 'telegram.org', 'vk.com', 'line.me', 'lemon8-app.com', 'signal.org', 'snapchat.com', 'weibo.com', 'flickr.com', 'deviantart.com', 'artstation.com', '500px.com', 'chat.google.com', 'teams.microsoft.com', 'zoom.us', 'mastodon.online', 'lemmy.world'] }
];

export const NONE_GROUP = -1;

export const BANGS = {
    '!g':     { url: 'https://www.google.com/search?q=',                  label: 'Google' },
    '!ddg':   { url: 'https://duckduckgo.com/?q=',                         label: 'DuckDuckGo' },
    '!yt':    { url: 'https://www.youtube.com/results?search_query=',      label: 'YouTube' },
    '!w':     { url: 'https://en.wikipedia.org/wiki/Special:Search?search=', label: 'Wikipedia' },
    '!gh':    { url: 'https://github.com/search?q=',                       label: 'GitHub' },
    '!r':     { url: 'https://www.reddit.com/search/?q=',                  label: 'Reddit' },
    '!x':     { url: 'https://x.com/search?q=',                            label: 'X (Twitter)' },
    '!maps':  { url: 'https://www.google.com/maps/search/',                label: 'Google Maps' },
    '!mdn':   { url: 'https://developer.mozilla.org/en-US/search?q=',      label: 'MDN' },
    '!npm':   { url: 'https://www.npmjs.com/search?q=',                    label: 'npm' },
    '!img':   { url: 'https://www.google.com/search?tbm=isch&q=',         label: 'Google Images' },
    '!tw':    { url: 'https://x.com/search?q=',                            label: 'X (Twitter)' },
    '!sp':    { url: 'https://open.spotify.com/search/',                   label: 'Spotify' },
    '!a':     { url: 'https://www.amazon.com/s?k=',                        label: 'Amazon' },
    '!so':    { url: 'https://stackoverflow.com/search?q=',                label: 'Stack Overflow' },
    '!fig':   { url: 'https://www.figma.com/search?q=',                    label: 'Figma Community' },
    '!can':   { url: 'https://www.canva.com/search?q=',                    label: 'Canva' },
    '!pin':   { url: 'https://www.pinterest.com/search/pins/?q=',          label: 'Pinterest' },
    '!px':    { url: 'https://www.perplexity.ai/search?q=',               label: 'Perplexity' },
    '!gpt':   { url: 'https://chatgpt.com/?q=',                            label: 'ChatGPT' },
};

export const SEARCH_ENGINES = {
    google:     { label: 'Google',     url: 'https://www.google.com/search?q=',              homepage: 'https://www.google.com',             suggest: 'https://suggestqueries.google.com/complete/search?client=chrome&q=' },
    duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=',                    homepage: 'https://duckduckgo.com',             suggest: 'https://duckduckgo.com/ac/?q=' },
    bing:       { label: 'Bing',       url: 'https://www.bing.com/search?q=',                homepage: 'https://www.bing.com',               suggest: null },
    brave:      { label: 'Brave',      url: 'https://search.brave.com/search?q=',            homepage: 'https://search.brave.com',           suggest: null },
    perplexity: { label: 'Perplexity', url: 'https://www.perplexity.ai/search?q=',           homepage: 'https://www.perplexity.ai',          suggest: null },
};

export const GROUP_COLORS = {
    blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04', green: '#34a853',
    pink: '#ff6d9f', purple: '#a142f4', cyan: '#24c1e0', orange: '#fa7b17', grey: '#9e9e9e'
};

export const SECTION_ORDER = ['action', 'bang', 'navigate', 'search', 'tab', 'closed', 'bookmark', 'history'];

export const SECTION_LABELS = { action: 'Actions', tab: 'Open Tabs', closed: 'Recently Closed', bookmark: 'Bookmarks', history: 'History' };

export const PALETTE_ICONS = {
    zap: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    globe: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    star: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    link: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    file: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`
};

export const TYPE_FALLBACK = {
    action: '', tab: '', history: '', bookmark: '', bang: '',
    search: '', navigate: '', closed: '', default: ''
};

// Populate TYPE_FALLBACK with the actual SVG strings
for (const key of Object.keys(TYPE_FALLBACK)) {
    if (key === 'default') TYPE_FALLBACK[key] = PALETTE_ICONS.file;
    else if (key === 'action' || key === 'bang') TYPE_FALLBACK[key] = PALETTE_ICONS.zap;
    else if (key === 'tab') TYPE_FALLBACK[key] = PALETTE_ICONS.globe;
    else if (key === 'history' || key === 'closed') TYPE_FALLBACK[key] = PALETTE_ICONS.clock;
    else if (key === 'bookmark') TYPE_FALLBACK[key] = PALETTE_ICONS.star;
    else if (key === 'search') TYPE_FALLBACK[key] = PALETTE_ICONS.search;
    else if (key === 'navigate') TYPE_FALLBACK[key] = PALETTE_ICONS.link;
}
