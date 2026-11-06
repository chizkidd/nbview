// Tests for functions/embed: which addresses are embeddable, and the headers and shell the frame receives.
// No browser and no network: the static shell is read from the repo and served through a fake ASSETS binding.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => { if (!cond) throw new Error(detail === undefined ? 'assertion failed' : typeof detail === 'string' ? detail : JSON.stringify(detail)); };

let api;

async function load() {
  api = await import(pathToFileURL(path.join(ROOT, 'functions', 'embed', '[[path]].js')).href);
}

const env = () => ({ ASSETS: { fetch: async () => new Response(SHELL) } });
const ask = (p, e = env()) => api.onRequest({ request: new Request('https://nbview.org' + p), env: e });

test('only notebook files are embeddable', () => {
  assert(api.routeFrom('/embed/github/o/r/blob/main/nb.ipynb') === '#/github/o/r/blob/main/nb.ipynb');
  assert(api.routeFrom('/embed/github/o/r') === null, 'repo listing');
  assert(api.routeFrom('/embed/github/o/r/tree/main') === null, 'folder');
  assert(api.routeFrom('/embed/github/o/r/blob/main/README.md') === null, 'non-notebook');
  assert(api.routeFrom('/embed/gist/u/abc123def') === '#/gist/abc123def', 'gist');
  assert(api.routeFrom('/embed/url/https%3A%2F%2Fx.dev%2Fa.ipynb') === '#/url/https%3A%2F%2Fx.dev%2Fa.ipynb', 'url');
  assert(api.routeFrom('/embed/nope/x') === null, 'unknown kind');
  assert(api.routeFrom('/embed/') === null, 'empty');
});

test('titles come from the file name', () => {
  assert(api.titleFrom('/embed/github/o/r/blob/main/My_Note.ipynb') === 'My Note');
  assert(api.titleFrom('/embed/gist/u/abc123def') === 'abc123def');
});

test('the frame may be framed by anyone, and nothing else is loosened', async () => {
  const res = await ask('/embed/github/o/r/blob/main/nb.ipynb');
  const csp = res.headers.get('content-security-policy') || '';
  assert(res.status === 200, res.status);
  assert(/frame-ancestors \*/.test(csp), csp);
  assert(!res.headers.get('x-frame-options'), 'X-Frame-Options would block the frame');
  assert(/default-src 'none'/.test(csp) && /script-src 'self'/.test(csp) && /form-action 'none'/.test(csp), csp);
  assert(/object-src 'none'/.test(csp), csp);
  assert(res.headers.get('x-robots-tag') === 'noindex');
});

test('the shell is the real page, pointed at the notebook', async () => {
  const html = await (await ask('/embed/github/o/r/blob/main/nb.ipynb')).text();
  assert(html.includes('<base href="/">'), 'relative assets would 404 under /embed/');
  assert(html.includes('name="nbv-embed" content="#/github/o/r/blob/main/nb.ipynb"'), 'route meta');
  assert(html.includes('/assets/js/embed-boot.js'), 'boot script');
  assert(html.indexOf('embed-boot.js') < html.indexOf('assets/js/app.js'), 'boot must run before app.js');
  assert(/<body>/.test(html) && !/class="is-home"/.test(html), 'home body class');
  assert(/<title>nb \| nbview<\/title>/.test(html), 'title');
});

test('an unknown path is a 404, not a redirect into the viewer', async () => {
  const res = await ask('/embed/nope/x');
  assert(res.status === 404, res.status);
  assert(await res.text(), 'no body');
});

test('without an ASSETS binding it still returns a plain link', async () => {
  const res = await ask('/embed/github/o/r/blob/main/nb.ipynb', {});
  const html = await res.text();
  assert(res.status === 200 && /nbview\.org\/github\/o\/r/.test(html), html);
});

test('the rest of the site keeps its own framing policy', () => {
  const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  assert(/frame-ancestors 'self'/.test(headers), 'site-wide policy changed');
  assert(/X-Frame-Options: SAMEORIGIN/.test(headers), 'site-wide X-Frame-Options changed');
});

(async () => {
  await load();
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS  ' + t.name); }
    catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + e.message); }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
