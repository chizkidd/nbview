// Restores the saved theme before first paint, so dark mode doesn't flash light. Also starts fetching notebook libraries early (below).
try {
  var t = localStorage.getItem('nbv.theme');
  if (t) document.documentElement.dataset.theme = JSON.parse(t);
} catch (e) { /* storage unavailable */ }

// Highlighting and math load only when a notebook opens. When the address already points at one (a shared link),
// start fetching them now, in parallel with the page's own scripts, instead of after app.js has run.
try {
  if (/^#\/(github|gist|url|urls)\//.test(location.hash)) {
    [['script', 'assets/vendor/highlight.min.js'], ['script', 'assets/vendor/katex/katex.min.js'],
      ['script', 'assets/vendor/katex/auto-render.min.js'], ['style', 'assets/vendor/katex/katex.min.css']].forEach(function (f) {
      var l = document.createElement('link');
      l.rel = 'preload';
      l.as = f[0];
      l.href = f[1];
      document.head.appendChild(l);
    });
  }
} catch (e) { /* preloading is only a speed-up */ }

// The offline shell (sw.js). Not registered inside embeds or sign-in pages, where a cached response would be wrong,
// and not in a frame; the worker is site-wide, so one registration from the top page is enough.
try {
  if ('serviceWorker' in navigator && window.top === window.self && !/^\/(?:embed|auth)(?:\/|$)/.test(location.pathname)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* offline support is optional */ });
    });
  }
} catch (e) { /* an old browser, or no worker support */ }
