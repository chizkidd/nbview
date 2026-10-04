// Restores the saved theme before first paint, so dark mode doesn't flash light.
try {
  var t = localStorage.getItem('nbv.theme');
  if (t) document.documentElement.dataset.theme = JSON.parse(t);
} catch (e) { /* storage unavailable */ }
