document.documentElement.style.visibility = 'hidden';

(function () {
    var p = new URLSearchParams(location.search);
    if (p.get('action') === 'palette') {
        document.documentElement.style.visibility = '';
        return;
    }
    if (p.get('focused') !== 'true') {
        location.replace('ntp.html?focused=true');
        return;
    }
    var safety = setTimeout(function () {
        document.documentElement.style.visibility = '';
    }, 400);
    chrome.storage.local.get({ settings: {} }, function (d) {
        clearTimeout(safety);
        if (d.settings && d.settings.useDefaultNtp) {
            var h = { google: 'https://www.google.com', duckduckgo: 'https://duckduckgo.com', bing: 'https://www.bing.com', brave: 'https://search.brave.com', perplexity: 'https://www.perplexity.ai' };
            location.replace(h[d.settings.searchEngine] || 'https://www.google.com');
            return;
        }
        document.documentElement.style.visibility = '';
    });
})();
