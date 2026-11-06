/* Runs before app.js in the embed shell. The real notebook path lives in the address (/embed/github/...) while the
   viewer routes on the hash, so this copies one to the other before the first route() call. */
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="nbv-embed"]');
  if (!meta) return;
  var route = meta.getAttribute('content') || '';
  if (!route) return;
  document.documentElement.dataset.embed = '1';
  window.NBV_EMBED = true;
  if (document.body) document.body.classList.remove('is-home');
  if (!location.hash) history.replaceState(null, '', location.pathname + location.search + route);
})();
