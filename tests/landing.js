// Tests for the rendered pages, the two guides and the privacy note: they are documents inside the app's shell, and
// every address they print resolves.
// No browser and no network: the pages, the Functions, _redirects and the app's router are all read from the repo.
//
// This exists because two wrong addresses shipped once. `/compare/github/...` was printed without its "#" (which
// does not 404, it quietly returns the app shell and the home page), and the embed path was printed without its
// `github` segment, which does 404. Both looked fine to a smoke test and to a diff.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://nbview.org';
// The pages are built from the app shell, so they are served the shell the way the deployment serves it.
const SHELL = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const env = { ASSETS: { fetch: async () => new Response(SHELL) } };
const PAGES = [
  { name: 'compare', file: ['functions', 'compare-jupyter-notebooks.js'], path: '/compare-jupyter-notebooks' },
  { name: 'view', file: ['functions', 'view-ipynb-from-github.js'], path: '/view-ipynb-from-github' },
];

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => {
  if (!cond) throw new Error(detail === undefined ? 'assertion failed' : typeof detail === 'string' ? detail : JSON.stringify(detail));
};
const rejects = async (promise, re) => {
  let error;
  try { await promise; } catch (e) { error = e; }
  assert(error, 'expected a rejection, but it resolved');
  assert(re.test(error.message), `expected /${re.source}/, got: ${error.message}`);
};

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const load = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);

/* ---------- what the deployment can answer, read from the repo ---------- */

// functions/<name>.js answers /<name>; functions/<dir>/[[path]].js answers /<dir> itself and everything under it.
function functionRoutes() {
  const exact = new Set(), prefix = [];
  for (const entry of fs.readdirSync(path.join(ROOT, 'functions'), { withFileTypes: true })) {
    if (entry.name === '_lib' || entry.name.startsWith('.')) continue;
    if (entry.isFile() && entry.name.endsWith('.js')) exact.add('/' + entry.name.slice(0, -3));
    if (entry.isDirectory() && fs.existsSync(path.join(ROOT, 'functions', entry.name, '[[path]].js'))) prefix.push('/' + entry.name + '/');
  }
  return { exact, prefix };
}

// _redirects lines: "from to [status]", where * is the rest of the path and :name is one segment.
function redirectRules() {
  const seg = s => (s === '*' ? '.*' : s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return read('_redirects').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => l.split(/\s+/))
    .map(([from, to]) => ({ from, to, re: new RegExp('^' + from.split('/').map(seg).join('/') + '$') }));
}

// The viewer is one page: which route kinds does it actually handle, and which of those have sub-kinds?
function router() {
  const app = read('assets/js', 'app.js');
  assert(/location\.hash/.test(app), 'the app no longer routes on location.hash, so this test has to be rewritten');
  return {
    kinds: new Set([...app.matchAll(/parts\[0\] === '([^']+)'/g)].map(m => m[1])),
    sub: new Set([...app.matchAll(/parts\[1\] === '([^']+)'/g)].map(m => m[1])),
  };
}

function resolvePath(addr, ctx) {
  const bare = addr.split('?')[0];
  if (ctx.functions.exact.has(bare)) return { via: 'function' };
  // An optional catch-all also answers the bare path: functions/count/[[path]].js serves /count as well as /count/...
  const dir = ctx.functions.prefix.find(p => bare.startsWith(p) || bare === p.slice(0, -1));
  if (dir) return { via: 'function', dir };
  const rule = ctx.redirects.find(r => r.re.test(bare));
  if (rule) return { via: 'redirect', to: rule.to };
  const file = path.join(ROOT, bare.replace(/^\//, ''));
  if (bare === '/' || (fs.existsSync(file) && fs.statSync(file).isFile())) return { via: 'static' };
  return null;
}

function resolveHash(addr, ctx) {
  const at = addr.indexOf('#/');
  assert(at >= 0, `${addr} has no #/ fragment`);
  const segs = addr.slice(at + 1).split('?')[0].replace(/^\//, '').split('/').filter(Boolean);
  if (!segs.length) return { via: 'hash', kind: '(home)' };
  assert(ctx.router.kinds.has(segs[0]), `the router has no "${segs[0]}" route, so ${addr} would land on the home page`);
  if (segs[0] === 'compare' && segs.length > 1) assert(ctx.router.sub.has(segs[1]), `the router has no compare/"${segs[1]}" route`);
  return { via: 'hash', kind: segs[0] };
}

function check(addr, ctx) {
  if (addr.startsWith('#/') || addr.startsWith('/#/')) return resolveHash(addr, ctx);
  assert(addr.startsWith('/'), `${addr} is not an address on this site`);
  const first = addr.slice(1).split(/[/?]/)[0];
  const hit = resolvePath(addr, ctx);
  if (hit) return hit;
  if (ctx.router.kinds.has(first)) {
    throw new Error(`${addr} looks like a hash route missing its "#": the router only serves /#/${first}/…, so this address lands on the home page`);
  }
  throw new Error(`${addr} matches no Function, no _redirects rule and no file, so Cloudflare would answer with the app shell`);
}

// A hash href in a served document is a fragment of that document, not a destination. The shell's brand link shipped
// that way, and every other link the pages inherit (the bar, the dialogs) comes from the same shell, so this looks at
// the whole page rather than at the one element that broke.
const fragmentLinks = html => [...html.matchAll(/<a\b[^>]*\shref="(#[^"]*)"/g)].map(m => m[1]);

// Substitute the {placeholders} the pages use with values that keep the same shape.
const SAMPLES = {
  owner: 'o', repo: 'r', branch: 'main', older: 'main', newer: 'dev', path: 'nb',
  'first-notebook-link': 'https%3A%2F%2Fraw.githubusercontent.com%2Fo%2Fr%2Fmain%2Fa.ipynb',
  'second-notebook-link': 'https%3A%2F%2Fraw.githubusercontent.com%2Fo%2Fr%2Fdev%2Fa.ipynb',
};
const fill = s => s.replace(/\{([a-z-]+)\}/g, (m, k) => {
  assert(SAMPLES[k] !== undefined, `the pages print ${m}, which this test has no sample for`);
  return SAMPLES[k];
});

// Resolve it the way the deployment would, and where a Function can answer offline, ask that Function.
async function expectReachable(addr, ctx) {
  const hit = check(addr, ctx);
  const bare = addr.split('?')[0];
  if (hit.via === 'hash') return hit;

  if (bare.startsWith('/embed/')) {
    const embed = await load('functions', 'embed', '[[path]].js');
    const res = await embed.onRequest({
      request: new Request(ORIGIN + addr),
      env: { ASSETS: { fetch: async () => new Response(read('index.html')) } },
    });
    assert(res.status === 200, `/embed answered ${res.status} for ${addr}: the path shape is not one it accepts`);
    return { via: 'embed' };
  }

  if (/^\/(github|gist)\//.test(bare)) {
    const dir = bare.slice(1).split('/')[0];
    const fn = await load('functions', dir, '[[path]].js');
    const res = await fn.onRequest({ request: new Request(ORIGIN + addr) });
    assert(res.status === 200 || res.status === 302, `${bare} answered ${res.status}`);
    if (res.status === 302) {
      const location = res.headers.get('location') || '';
      assert(location.startsWith(ORIGIN + '/#/'), `${bare} redirected to ${location}`);
      resolveHash(location, ctx); // the redirect target is a hash route, so the router has to serve it too
      const query = addr.includes('?') ? addr.slice(addr.indexOf('?')) : '';
      if (query) assert(location.endsWith(query), `${bare} redirected to ${location}, dropping ${query}`);
    }
    return { via: dir, status: res.status };
  }

  return hit;
}

/* ---------- what the pages print ---------- */

// One pass with a map, so `&amp;lt;` decodes once to `&lt;` and never twice to `<`.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const unescape = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, name) => ENTITIES[name]);

function addresses(html) {
  const pre = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)]
    .flatMap(m => unescape(m[1]).split('\n')).map(s => s.trim()).filter(Boolean);
  // Prose snippets are printed in <code> too, and the embed address lives only there.
  const inline = [...html.matchAll(/<code>([\s\S]*?)<\/code>/g)].map(m => unescape(m[1]).trim());
  const printed = [...pre, ...inline].filter(s => s.startsWith('/') || s.startsWith('#/'));
  const code = new Map();
  for (const raw of printed) {
    const shorthand = /\.{3}$/.test(raw); // "/github/..." names a shape, so only its prefix is checked
    const text = shorthand ? raw.replace(/\.{3}$/, '') : raw;
    const prev = code.get(text);
    code.set(text, { text, run: !shorthand || Boolean(prev && prev.run) });
  }
  // The pages style their links, so the class attribute comes before href.
  const links = [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map(m => m[1]).filter(h => h.startsWith('/') && !h.startsWith('//'));
  return { pre, code: [...code.values()], links, all: [...new Set([...code.keys(), ...links])] };
}

(async () => {
  const ctx = { functions: functionRoutes(), redirects: redirectRules(), router: router() };
  const rendered = {};
  for (const p of PAGES) {
    const fn = await load(...p.file);
    const res = await fn.onRequest({ request: new Request(ORIGIN + p.path), env });
    assert(res.status === 200, `${p.path} answered ${res.status}`);
    rendered[p.name] = await res.text();
  }

  test('both pages are documents inside the app shell: their own head, the app top bar, no home hero', () => {
    for (const p of PAGES) {
      const html = rendered[p.name];
      assert((html.match(/<h1[\s>]/g) || []).length === 1, `${p.path} should have exactly one h1`);
      assert((html.match(/<title>[^<]*<\/title>/g) || []).length === 1, `${p.path} title`);
      assert(html.includes(`<link rel="canonical" href="${ORIGIN}${p.path}">`), `${p.path} canonical`);
      assert(html.includes(`<meta property="og:url" content="${ORIGIN}${p.path}">`), `${p.path} og:url`);
      assert(/<body class="is-doc">/.test(html), `${p.path} body class`);
      assert(!html.includes('class="is-home"'), `${p.path} still carries the home body class`);
      assert(/<main id="app" tabindex="-1" class="doc">[\s\S]*?<h1/.test(html), `${p.path} document is not inside <main>`);
      assert(!/class="home-title"/.test(html), `${p.path} kept the home hero`);
      // The point of the shell: the bar and the dialog behind its button are the app's, not a second copy.
      assert(html.includes('id="jump-input"') && html.includes('id="theme-btn"') && html.includes('id="settings-btn"'), `${p.path} is missing the app top bar`);
      assert(html.includes('id="settings"'), `${p.path} is missing the dialog the bar opens`);
      // The brand is a hash link in the shell, where "#/" is home. On a document that is a fragment of itself, so the
      // click looks like a link, changes the address, and stays on the page.
      assert(html.includes('<a class="brand" href="/">'), `${p.path} keeps the shell's hash-only brand link, so the logo goes nowhere`);
      const fragments = fragmentLinks(html);
      assert(!fragments.length, `${p.path} links to ${fragments.join(' ')}, which is a fragment of the same page, so the click goes nowhere`);
      assert(html.includes('assets/js/theme.js?v=') && html.includes('assets/js/app.js?v='), `${p.path} does not load the app's scripts`);
    }
  });

  test('the pages serve the same policy as the rest of the site', async () => {
    const site = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(read('_headers'));
    assert(site, '_headers has no Content-Security-Policy');
    const fn = await load(...PAGES[0].file);
    const res = await fn.onRequest({ request: new Request(ORIGIN + PAGES[0].path), env });
    const served = res.headers.get('content-security-policy');
    assert(served === site[1].trim(), `the policy these pages send has drifted from _headers:\n      ${served}`);
  });

  test('each page still prints addresses for this test to check', () => {
    let printed = 0;
    for (const p of PAGES) {
      const a = addresses(rendered[p.name]);
      assert(a.pre.length >= 1, `${p.path} prints no format in a <pre><code>`);
      assert(a.links.length >= 2, `${p.path} links to nowhere`);
      printed += a.code.length;
    }
    // Guards the extractor itself: if the markup changes shape, this drops instead of the checks passing vacuously.
    assert(printed >= 5, `only ${printed} printed addresses found across both pages`);
  });

  test('every address printed in a code block or a snippet resolves', async () => {
    for (const p of PAGES) {
      for (const { text, run } of addresses(rendered[p.name]).code) {
        if (run) await expectReachable(fill(text), ctx);
        else check(fill(text), ctx);
      }
    }
  });

  test('every internal link resolves', async () => {
    for (const p of PAGES) {
      for (const href of addresses(rendered[p.name]).links) await expectReachable(fill(href), ctx);
    }
  });

  test('the check has teeth: the two mistakes that shipped once are rejected', async () => {
    await rejects(expectReachable('/compare/github/o/r/main...dev/nb.ipynb', ctx), /missing its "#"/);
    await rejects(expectReachable('/compare/links/a/b', ctx), /missing its "#"/);
    await rejects(expectReachable('/embed/o/r/blob/main/nb.ipynb', ctx), /not one it accepts/);
  });

  test('the ?cell=N the view page promises survives the /github redirect', async () => {
    const fn = await load('functions', 'github', '[[path]].js');
    const res = await fn.onRequest({ request: new Request(ORIGIN + '/github/o/r/blob/main/nb.ipynb?cell=3') });
    const location = res.headers.get('location') || '';
    assert(res.status === 302, res.status);
    assert(location.endsWith('#/github/o/r/blob/main/nb.ipynb?cell=3'), location);
    assert(resolveHash(location, ctx).via === 'hash', location);
  });

  test('the privacy note is a page of its own, linked from the home page and from both guides', async () => {
    const fn = await load('functions', 'privacy.js');
    const res = await fn.onRequest({ request: new Request(ORIGIN + '/privacy'), env });
    assert(res.status === 200, `/privacy answered ${res.status}`);
    const html = await res.text();
    assert(/<body class="is-doc">/.test(html), '/privacy is not a document in the app shell');
    assert(!/class="is-home"/.test(html), '/privacy carries the home body class');
    assert(html.includes('id="jump-input"') && html.includes('id="settings"'), '/privacy has no app top bar');
    assert(html.includes('<a class="brand" href="/">'), '/privacy keeps the shell\u2019s hash-only brand link, so the logo goes nowhere');
    const fragments = fragmentLinks(html);
    assert(!fragments.length, `/privacy links to ${fragments.join(' ')}, which is a fragment of the same page, so the click goes nowhere`);
    assert((html.match(/<h1[\s>]/g) || []).length === 1, '/privacy should have exactly one h1');
    assert(html.includes(`<link rel="canonical" href="${ORIGIN}/privacy">`), '/privacy canonical');
    // The point of the page is that a reader can find it: from the home column, in the markup and in the render,
    // and from the guides it is meant to answer for.
    for (const [what, src] of [['index.html', read('index.html')], ['renderHome()', read('assets', 'js', 'app.js')]]) {
      assert(src.includes('href="/privacy"'), `${what} does not link the privacy note`);
    }
    for (const p of PAGES) assert(rendered[p.name].includes('href="/privacy"'), `${p.path} does not link the privacy note`);
    // And from the dialog that asks for a token, which is where a reader starts wondering what it keeps.
    const dialog = /<dialog id="settings">[\s\S]*?<\/dialog>/.exec(html);
    assert(dialog && dialog[0].includes('href="/privacy"'), 'the Private repos dialog does not link the privacy note');
    for (const href of addresses(html).links) await expectReachable(href, ctx);
  });

  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS  ' + t.name); }
    catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + e.message.slice(0, 400)); }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FAIL  harness\n      ' + (e && e.message)); process.exit(1); });
