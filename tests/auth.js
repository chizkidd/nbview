// Tests for functions/auth: status, the redirect and its state cookie, the code exchange, and revocation.
// GitHub itself is stubbed, so this runs offline. Notebook content is not involved anywhere in this flow.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => { if (!cond) throw new Error(detail === undefined ? 'assertion failed' : typeof detail === 'string' ? detail : JSON.stringify(detail)); };

let api;
const ENV = { GITHUB_CLIENT_ID: 'cid_test', GITHUB_CLIENT_SECRET: 'secret_test' };
const req = (p, init) => new Request('https://nbview.org' + p, init);
const status = async (env = ENV) => (await api.onRequest({ request: req('/auth/status'), env })).json();

test('sign-in is off unless both credentials are set', async () => {
  assert((await status({})).enabled === false);
  assert((await status({ GITHUB_CLIENT_ID: 'x' })).enabled === false, 'id without secret');
  assert((await status({ GITHUB_CLIENT_SECRET: 'x' })).enabled === false, 'secret without id');
  assert((await status()).enabled === true);
});

test('without credentials the login route refuses instead of redirecting', async () => {
  const res = await api.onRequest({ request: req('/auth/login'), env: {} });
  assert(res.status === 503, res.status);
  assert((await res.json()).error === 'not_configured');
});

test('login asks GitHub for the repo scope and pins the callback', async () => {
  const res = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const loc = new URL(res.headers.get('location'));
  assert(res.status === 302, res.status);
  assert(loc.origin === 'https://github.com' && loc.pathname === '/login/oauth/authorize', loc.href);
  assert(loc.searchParams.get('client_id') === 'cid_test');
  assert(loc.searchParams.get('scope') === 'repo', loc.searchParams.get('scope'));
  assert(loc.searchParams.get('redirect_uri') === 'https://nbview.org/auth/callback');
  assert(loc.searchParams.get('allow_signup') === 'false');
  assert(/^[0-9a-f]{32}$/.test(loc.searchParams.get('state') || ''), 'state');
});

test('the state is also set as a short-lived, HttpOnly cookie', async () => {
  const res = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const state = new URL(res.headers.get('location')).searchParams.get('state');
  const cookie = res.headers.get('set-cookie') || '';
  assert(cookie.includes('nbv_oauth=' + state), cookie);
  assert(/HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && /Max-Age=600/.test(cookie), cookie);
  assert(/Path=\/auth/.test(cookie), cookie);
});

test('a callback without the matching state is refused and its cookie cleared', async () => {
  const res = await api.onRequest({
    request: req('/auth/callback?code=abc&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { headers: { cookie: 'nbv_oauth=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } }),
    env: ENV,
  });
  const html = await res.text();
  assert(/incomplete or expired/.test(html), html.slice(0, 200));
  assert(!/nbv-oauth-result" content="[^"]*token/.test(html), 'token in a refused page');
  assert(/Max-Age=0/.test(res.headers.get('set-cookie') || ''), 'cookie not cleared');
});

test('a cancelled sign-in is explained, not a crash', async () => {
  const res = await api.onRequest({ request: req('/auth/callback?error=access_denied'), env: ENV });
  assert(/cancelled/i.test(await res.text()));
});

test('the code is exchanged server-side and the token never appears in a URL', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'ghu_secret', scope: 'repo' }), { headers: { 'content-type': 'application/json' } });
  const login = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const res = await api.onRequest({
    request: req(`/auth/callback?code=abc123&state=${state}`, { headers: { cookie: 'nbv_oauth=' + state } }),
    env: ENV,
  });
  const html = await res.text();
  assert(res.status === 200, res.status);
  assert(/ghu_secret/.test(html), 'token not handed over');
  assert(!res.headers.get('location'), 'token must not be in a Location header');
  assert(/script-src 'self'/.test(res.headers.get('content-security-policy') || ''), 'callback CSP');
  assert(/auth-callback\.js/.test(html), 'callback script');
  assert(/Max-Age=0/.test(res.headers.get('set-cookie') || ''), 'state cookie not cleared');
});

test('the exchange sends the secret to GitHub and nowhere else', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ access_token: 'ghu_x' }), { headers: { 'content-type': 'application/json' } });
  };
  const login = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  await api.onRequest({ request: req(`/auth/callback?code=c&state=${state}`, { headers: { cookie: 'nbv_oauth=' + state } }), env: ENV });
  assert(calls.length === 1 && calls[0].url === 'https://github.com/login/oauth/access_token', calls.map(c => c.url));
  const body = JSON.parse(calls[0].init.body);
  assert(body.client_id === 'cid_test' && body.client_secret === 'secret_test' && body.code === 'c', body);
  assert(body.redirect_uri === 'https://nbview.org/auth/callback', body.redirect_uri);
});

test('a GitHub error is shown on the callback page', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }), { headers: { 'content-type': 'application/json' } });
  const login = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const html = await (await api.onRequest({ request: req(`/auth/callback?code=c&state=${state}`, { headers: { cookie: 'nbv_oauth=' + state } }), env: ENV })).text();
  assert(/incorrect or expired/.test(html), html.slice(0, 300));
  assert(!/token/.test((html.match(/nbv-oauth-result" content="([^"]*)"/) || ['', ''])[1]), 'error page carried a token');
});

test('logout revokes with GitHub and reports no content', async () => {
  let seen = null;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response(null, { status: 204 }); };
  const res = await api.onRequest({ request: req('/auth/logout', { method: 'POST', body: JSON.stringify({ access_token: 'ghu_x' }) }), env: ENV });
  assert(res.status === 204 && seen && seen.init.method === 'DELETE', seen && seen.init.method);
  assert(/\/applications\/cid_test\/token$/.test(seen.url), seen.url);
  assert(JSON.parse(seen.init.body).access_token === 'ghu_x');
  assert(String(seen.init.headers.authorization).startsWith('Basic '), 'client credentials');
});

test('the page keeps working when GitHub is unreachable', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const login = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const html = await (await api.onRequest({ request: req(`/auth/callback?code=c&state=${state}`, { headers: { cookie: 'nbv_oauth=' + state } }), env: ENV })).text();
  assert(/Couldn(?:&#39;|')t reach GitHub/i.test(html), html.slice(0, 400));
});

test('the client only stores a token that looks like one', () => {
  const app = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'app.js'), 'utf8');
  assert(/data\.type !== 'nbv-token'/.test(app), 'message handler');
  assert(/if \(!TOKEN_OK\.test\(t\)\) return;/.test(app), 'token shape check');
  assert(/e\.origin !== location\.origin/.test(app), 'origin check');
  assert(/revokeToken\(\)/.test(app), 'revocation on clear');
});

test('a second sign-in attempt does not cancel the first', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'ghu_two' }), { headers: { 'content-type': 'application/json' } });
  const first = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const a = new URL(first.headers.get('location')).searchParams.get('state');
  const second = await api.onRequest({ request: req('/auth/login', { headers: { cookie: first.headers.get('set-cookie').split(';')[0] } }), env: ENV });
  const b = new URL(second.headers.get('location')).searchParams.get('state');
  const both = second.headers.get('set-cookie').split(';')[0];
  assert(a !== b, 'two attempts share a state');
  assert(both.includes(a) && both.includes(b), both);
  const html = await (await api.onRequest({ request: req(`/auth/callback?code=c&state=${a}`, { headers: { cookie: both } }), env: ENV })).text();
  assert(/ghu_two/.test(html), 'the earlier attempt was cancelled by the later one');
});

test('only the five most recent attempts stay valid', async () => {
  let cookie = '';
  const states = [];
  for (let i = 0; i < 7; i++) {
    const res = await api.onRequest({ request: req('/auth/login', { headers: cookie ? { cookie } : {} }), env: ENV });
    states.push(new URL(res.headers.get('location')).searchParams.get('state'));
    cookie = res.headers.get('set-cookie').split(';')[0];
  }
  const kept = cookie.replace(/^nbv_oauth=/, '').split('.');
  assert(kept.length === 5, kept.length);
  assert(kept.includes(states[6]) && !kept.includes(states[0]), kept);
});

test('a code GitHub will not exchange offers a retry instead of a dead end', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { headers: { 'content-type': 'application/json' } });
  const login = await api.onRequest({ request: req('/auth/login'), env: ENV });
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const html = await (await api.onRequest({ request: req(`/auth/callback?code=c&state=${state}`, { headers: { cookie: 'nbv_oauth=' + state } }), env: ENV })).text();
  assert(/bad_verification_code/.test(html), html.slice(0, 300));
  assert(/href="\/auth\/login"/.test(html), 'no retry link');
  assert(/nbv-oauth-result" content="[^"]*bad_verification_code/.test(html), 'the reason is not handed to the page that opened the tab');
});

(async () => {
  api = await import(pathToFileURL(path.join(ROOT, 'functions', 'auth', '[[path]].js')).href);
  const realFetch = globalThis.fetch;
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS  ' + t.name); }
    catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + e.message); }
    finally { globalThis.fetch = realFetch; }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
