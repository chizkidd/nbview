/* Sign in with GitHub, so private repositories do not need a hand-made token.
 *
 * Only the OAuth code-for-token exchange happens on this server, and only with GitHub. The token is handed to the
 * browser and kept there; notebook content is still fetched and rendered by the page, never here. Nothing about a
 * notebook passes through this code.
 *
 * Routes:
 *   /auth/status    { enabled } - whether this deployment has GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET set
 *   /auth/login     redirect to GitHub
 *   /auth/callback  exchange the code, then hand the token to the page
 *   /auth/logout    revoke the token with GitHub
 */

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
const COOKIE = 'nbv_oauth';
// A classic OAuth app has no read-only repo scope. `repo` is the narrowest scope that covers private repositories,
// which is why the dialog also keeps the fine-grained token path for anyone who wants least privilege.
const SCOPE = 'repo';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

function stateCookie(request) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') || '');
  return m ? m[1] : '';
}

function newState() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}

const clearCookie = `${COOKIE}=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// The page that closes the popup. The token travels in a meta tag rather than the URL, so it never lands in a
// history entry or a referrer.
function callbackPage({ result, site }) {
  const payload = esc(JSON.stringify(result));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${result.token ? 'Signed in' : 'Sign-in failed'} | nbview</title>
<meta name="robots" content="noindex">
<meta name="nbv-oauth-result" content="${payload}">
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}p{margin:0 0 .75rem}a{color:#0b5cad}</style>
</head><body>
<p id="oauth-status">${result.token ? 'Signed in. Finishing…' : esc(result.error || 'Sign-in failed.')}</p>
${result.token ? '' : `<p><a href="${esc(site)}/#/">Back to nbview</a></p>`}
<script src="/assets/js/auth-callback.js"></script>
</body></html>
`;
}

const safeNext = (s) => (/^\/(?:#\/)?[A-Za-z0-9#/?=&._~%:-]*$/.test(s || '') ? s : '/');

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/auth\/?/, '').split('/').filter(Boolean)[0] || '';
  const id = env.GITHUB_CLIENT_ID;
  const secret = env.GITHUB_CLIENT_SECRET;
  const enabled = Boolean(id && secret);

  if (path === 'status') return json({ enabled });

  if (!enabled) {
    return json({ error: 'not_configured', message: 'GitHub sign-in is not set up on this deployment. Add a GitHub OAuth app and set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.' }, 503);
  }

  if (path === 'login') {
    if (request.method !== 'GET') return json({ error: 'method' }, 405);
    const state = newState();
    const target = new URL(AUTHORIZE);
    target.searchParams.set('client_id', id);
    target.searchParams.set('redirect_uri', url.origin + '/auth/callback');
    target.searchParams.set('scope', SCOPE);
    target.searchParams.set('state', state);
    target.searchParams.set('allow_signup', 'false');
    return new Response(null, {
      status: 302,
      headers: {
        location: target.toString(),
        'set-cookie': `${COOKIE}=${state}; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
        'cache-control': 'no-store',
      },
    });
  }

  if (path === 'callback') {
    const site = url.origin;
    const html = body => new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': clearCookie,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      },
    });

    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const denied = url.searchParams.get('error');
    if (denied) return html(callbackPage({ result: { error: 'Sign-in was cancelled.' }, site }));
    if (!code || !state || state !== stateCookie(request) || state.length < 16) {
      return html(callbackPage({ result: { error: 'That sign-in link is incomplete or expired. Try again.' }, site }));
    }

    let data;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: id, client_secret: secret, code, redirect_uri: site + '/auth/callback' }),
      });
      data = await res.json();
    } catch {
      return html(callbackPage({ result: { error: "Couldn't reach GitHub to finish signing in." }, site }));
    }
    if (!data || !data.access_token) {
      return html(callbackPage({ result: { error: (data && data.error_description) || 'GitHub did not return a token.' }, site }));
    }
    return html(callbackPage({ result: { token: String(data.access_token), scope: String(data.scope || '') }, site }));
  }

  if (path === 'logout') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    let token = '';
    try { token = String((await request.json()).access_token || ''); } catch { /* nothing to revoke */ }
    if (token) {
      try {
        await fetch(`${API}/applications/${encodeURIComponent(id)}/token`, {
          method: 'DELETE',
          headers: {
            authorization: 'Basic ' + btoa(`${id}:${secret}`),
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ access_token: token }),
        });
      } catch { /* the browser forgets it either way */ }
    }
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  return json({ error: 'not_found' }, 404);
}

export { callbackPage, safeNext };
