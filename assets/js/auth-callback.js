/* The page GitHub sends the browser back to, after the Function has exchanged the code for a token.
   The token is read from a meta tag (never the URL), handed to the window that opened this one, and this tab closes.
   With no opener (a blocked popup, or the link opened directly) the token is saved here instead: same origin. */
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="nbv-oauth-result"]');
  var status = document.getElementById('oauth-status');
  var result = {};
  try { result = JSON.parse((meta && meta.getAttribute('content')) || '{}'); } catch (e) { /* no result */ }

  if (!result || !result.token) {
    var why = String((result && result.error) || 'Sign-in failed.');
    if (status) status.textContent = why;
    // Say why on the page that opened this tab, so the reason is not left behind in a window that closes.
    try {
      if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'nbv-signin-error', error: why }, location.origin);
    } catch (e) { /* opener went away */ }
    return;
  }

  var opened = false;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'nbv-token', token: result.token }, location.origin);
      opened = true;
    }
  } catch (e) { /* opener went away */ }

  if (opened) {
    if (status) status.textContent = 'Signed in. You can close this window.';
    setTimeout(function () { window.close(); }, 500);
    return;
  }

  try {
    localStorage.setItem('nbv.token', JSON.stringify(result.token));
    localStorage.setItem('nbv.oauth', 'true');
  } catch (e) { /* storage unavailable */ }
  if (status) status.textContent = 'Signed in. Returning to nbview…';
  location.replace('/#/');
})();
