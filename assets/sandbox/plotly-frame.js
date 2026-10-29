/* Runs inside the sandboxed chart frame (an opaque origin with scripts allowed and nothing else).
   It draws the one figure the page sends it and reports back; it never sees cookies, storage or the page. */
(function () {
  'use strict';
  var parentWin = window.parent;
  var post = function (m) { parentWin.postMessage(m, '*'); };
  var started = false;

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin || started) return;
    var m = e.data;
    if (!m || m.type !== 'render') return;
    started = true;
    try {
      var layout = m.layout && typeof m.layout === 'object' ? m.layout : {};
      delete layout.width;
      layout.autosize = true;
      layout.height = Number(m.height) || 450;
      var config = { responsive: true, displaylogo: false, showLink: false, sendData: false, editable: false };
      var wanted = m.config && typeof m.config === 'object' ? m.config : {};
      ['scrollZoom', 'staticPlot', 'displayModeBar'].forEach(function (k) {
        if (typeof wanted[k] === 'boolean') config[k] = wanted[k];
      });
      Plotly.newPlot(document.getElementById('chart'), m.data, layout, config).then(
        function () { post({ type: 'rendered' }); },
        function (err) { post({ type: 'error', message: String(err && err.message || err).slice(0, 200) }); }
      );
    } catch (err) {
      post({ type: 'error', message: String(err && err.message || err).slice(0, 200) });
    }
  });

  post({ type: 'ready' });
})();
