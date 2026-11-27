/* Runs before app.js in the embed shell. The real notebook path lives in the address (/embed/github/...) while the
   viewer routes on the hash, so this copies one to the other before the first route() call, applies optional display
   flags (cells range, hide code/outputs, theme) and notifies a host page of frame height changes via postMessage. */
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="nbv-embed"]');
  if (!meta) return;
  var route = meta.getAttribute('content') || '';
  if (!route) return;
  document.documentElement.dataset.embed = '1';
  window.NBV_EMBED = true;
  var optsMeta = document.querySelector('meta[name="nbv-embed-opts"]');
  var opts = {};
  if (optsMeta) {
    try { opts = JSON.parse(optsMeta.getAttribute('content') || '{}') || {}; } catch { opts = {}; }
  }
  window.NBV_EMBED_OPTS = opts;
  if (opts.theme === 'light' || opts.theme === 'dark') {
    document.documentElement.dataset.theme = opts.theme;
  }
  if (document.body) document.body.classList.remove('is-home');
  if (!location.hash) {
    try { history.replaceState(null, '', location.pathname + location.search + route); } catch { /* ignore */ }
  }

  if (window.parent && window.parent !== window) {
    var last = 0;
    var send = function () {
      var h = Math.ceil(document.documentElement.scrollHeight || (document.body ? document.body.scrollHeight : 0));
      if (h > 0 && h !== last) {
        last = h;
        try { window.parent.postMessage({ type: 'nbview:height', height: h }, '*'); } catch { /* ignore */ }
      }
    };
    var attach = function () {
      send();
      if (typeof ResizeObserver === 'function' && document.body) {
        new ResizeObserver(send).observe(document.body);
      }
    };
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
    window.addEventListener('load', send);
  }
})();
