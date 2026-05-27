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
    enablePomo: true,
    enableFocusView: true,
    baseRemSize: 16,
    ntpBgDesign: 0,
    archiveThresholdRaw: '12h',
    hibernateThresholdRaw: '1h',
    enableAutoHibernate: false,
    enableMediaExtractor: true,
    enableVolumeControl: true,
    timeFormat: '24h',
    showClock: true,
    autoPeekCrossDomain: false
};

export const GROUPING_RULES = [
    { title: 'Dev', color: 'blue', domains: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'aws.amazon.com', 'console.cloud.google.com', 'vercel.com', 'netlify.com', 'docker.com', 'cloudflare.com', 'jira.com', 'atlassian.net', 'linear.app', 'developer.mozilla.org', 'npmjs.com', 'codepen.io', 'replit.com', 'codesandbox.io', 'postman.com', 'sentry.io', 'datadoghq.com', 'cursor.sh', 'cursor.com', 'warp.dev', 'bun.sh', 'railway.app', 'supabase.com', 'huggingface.co', 'leetcode.com', 'geeksforgeeks.org', 'pypi.org', 'hub.docker.com', 'crates.io', 'search.maven.org'] },
    { title: 'Design', color: 'purple', domains: ['figma.com', 'canva.com', 'dribbble.com', 'behance.net', 'miro.com', 'framer.com', 'spline.design', 'adobe.com', 'awwwards.com', 'lottiefiles.com', 'unsplash.com', 'pexels.com', 'colorhunt.co', 'sketch.com', 'invisionapp.com', 'principleformac.com', 'zeplin.io', 'affinity.serif.com', 'coreldraw.com', 'muz.li', 'land-book.com', 'siteinspire.com', 'fontshare.com', 'fonts.google.com', 'coolors.co', 'iconify.design', 'flaticon.com', 'readymag.com', 'typedream.com', 'poly.cam', 'sketchfab.com'] },
    { title: 'AI', color: 'green', domains: ['chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'grok.com', 'deepseek.com', 'poe.com', 'midjourney.com', 'leonardo.ai', 'runwayml.com', 'pika.art', 'suno.com', 'udio.com', 'elevenlabs.io', 'zapier.com', 'make.com', 'gamma.app', 'notebooklm.google.com', 'consensus.app', 'phind.com'] },
    { title: 'Media', color: 'red', domains: ['youtube.com', 'netflix.com', 'spotify.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'vimeo.com', 'soundcloud.com', 'music.apple.com', 'plex.tv', 'crunchyroll.com', 'paramountplus.com', 'peacocktv.com', 'mubi.com', 'nebula.tv', 'curiositystream.com', 'steampowered.com', 'epicgames.com', 'ign.com', 'gamespot.com', 'roblox.com', 'letterboxd.com', 'pocketcasts.com', 'mixcloud.com', 'bandcamp.com', 'tidal.com', 'audible.com'] },
    { title: 'News', color: 'yellow', domains: ['nytimes.com', 'bbc.com', 'news.google.com', 'theverge.com', 'techcrunch.com', 'wsj.com', 'news.ycombinator.com', 'bloomberg.com', 'cnn.com', 'reuters.com', 'theguardian.com', 'hbr.org', 'wired.com', 'arstechnica.com', 'apnews.com', 'aljazeera.com', 'fortune.com', 'forbes.com', 'qz.com', 'mashable.com', 'engadget.com', 'gizmodo.com', 'medium.com', 'substack.com', 'ted.com', 'wikipedia.org', 'marketwatch.com', 'investopedia.com', 'finance.yahoo.com', 'seekingalpha.com'] },
    { title: 'Social', color: 'cyan', domains: ['x.com', 'twitter.com', 'facebook.com', 'reddit.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'discord.com', 'web.whatsapp.com', 'messenger.com', 'tumblr.com', 'threads.net', 'bsky.app', 'polywork.com', 'slack.com', 'mastodon.social', 'fark.com', 'quora.com', 'nextdoor.com', 'wechat.com', 'telegram.org', 'vk.com', 'line.me', 'lemon8-app.com'] }
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
