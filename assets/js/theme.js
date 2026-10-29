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
