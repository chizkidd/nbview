// Tests for the offline shell (sw.js), the registration in assets/js/theme.js, and the header rule that keeps the
// worker fresh. No browser: the worker is checked as source, with its regexes evaluated so the policies are tested
// as behaviour rather than as strings.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SW = read('sw.js');
const THEME = read('assets/js/theme.js');
const HEADERS = read('_headers');
const PAGE = read('index.html');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => { if (!cond) throw new Error(detail === undefined ? 'assertion failed' : typeof detail === 'string' ? detail : JSON.stringify(detail)); };

// The worker's own constants, so a policy change is reflected here instead of being restated.
const literal = name => {
  const m = SW.match(new RegExp(`const ${name} = (\\/[^;]+\\/[a-z]*);`));
  assert(m, `sw.js no longer defines ${name}`);
  return vm.runInNewContext(m[1]);
};

test('the worker parses and takes over on install and activate', () => {
  new vm.Script(SW, { filename: 'sw.js' });
  for (const t of ['install', 'activate', 'fetch']) assert(SW.includes(`addEventListener('${t}'`), `no ${t} listener`);
  assert(/skipWaiting/.test(SW), 'a new worker must not wait behind the old one');
  assert(/clients\.claim/.test(SW), 'the first load after install must be controlled too');
  assert(/nbv-/.test(SW) && /caches\.delete/.test(SW), 'old caches are never cleared');
});

test('sign-in and framed pages are never served from the cache', () => {
  const bypass = literal('BYPASS');
  for (const p of ['/auth/status', '/auth/login', '/auth/callback', '/embed/github/o/r/blob/main/a.ipynb']) {
    assert(bypass.test(p), p);
  }
  for (const p of ['/', '/index.html', '/assets/js/app.js?v=abc', '/author', '/embedding']) {
    assert(!bypass.test(p), p);
  }
});

test('only stamped URLs are cache-first, and only build output is pruned', () => {
  const stamped = literal('STAMPED');
  assert(stamped.test('?v=7c3269f0') && stamped.test('&v=abc'), 'stamp detection');
  assert(!stamped.test('') && !stamped.test('?ref=main'), 'unstamped files must be refreshed, not pinned');
  const prunable = literal('PRUNABLE');
  assert(prunable.test('/assets/js/app.js') && prunable.test('/assets/js/vendor/x.js') && prunable.test('/assets/css/style.css'));
  assert(!prunable.test('/assets/fonts/inter.woff2') && !prunable.test('/assets/icon-192.png'), 'icons and fonts are not build output');
  const skip = literal('SKIP');
  assert(skip.test('/assets/screenshots/home-wide.png') && skip.test('/assets/og-light.png'), 'heavy share images are precached');
  assert(!skip.test('/assets/css/style.css'));
});

test('the precache reads its file list from the real page', () => {
  const ref = literal('REF');
  const refs = [...PAGE.matchAll(ref)].map(m => m[1]);
  assert(refs.length >= 4, 'index.html refs: ' + refs.length);
  assert(refs.some(r => /(^|\/)assets\/css\/style\.css\?v=/.test(r)), 'stylesheet with its stamp');
  assert(refs.some(r => /(^|\/)assets\/js\/app\.js\?v=/.test(r)), 'app.js with its stamp');
  assert(SW.includes("shell.match('/')"), 'the cached page is where the list comes from');
});

test('the page is not treated as cacheable when the response is not the app', () => {
  assert(/res\.ok/.test(SW) && /text\/html/.test(SW), 'a 502 or a redirect body must not replace the shell');
  assert(/Response\.error\(\)/.test(SW), 'a failed asset must not be answered with HTML');
  assert(/status: 200/.test(SW) && /is offline/.test(SW), 'no offline page');
});

test('the worker is registered once, from the top page, and not inside embeds', () => {
  assert(/serviceWorker' in navigator/.test(THEME), 'no support check');
  assert(/navigator\.serviceWorker\.register\('\/sw\.js'\)/.test(THEME), 'wrong worker path: scope would be limited');
  assert(/window\.top === window\.self/.test(THEME), 'frames must not register it');
  assert(/\^\\\/\(\?:embed\|auth\)/.test(THEME), 'embeds and sign-in pages must not register it');
  assert(!/sw\.js/.test(PAGE), 'registration belongs in theme.js, not in the markup');
  assert(/load/.test(THEME) && /catch/.test(THEME), 'registration must not delay the page or throw');
});

test('the worker itself is revalidated, and the CSP allows a same-origin worker', () => {
  assert(/\/sw\.js\s*\n\s*Cache-Control: public, max-age=0, must-revalidate/.test(HEADERS), 'stale worker policy');
  assert(/worker-src 'self'/.test(HEADERS), 'worker-src missing from the CSP');
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS  ' + t.name); }
    catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + e.message); }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
