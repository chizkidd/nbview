// Tests for the link-preview function (functions/_lib/preview.mjs), run in Node. It makes no network requests at all.
const assert = require('assert');

const BOT = 'Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)';
const req = (path, ua = BOT) => new Request('https://nbview.org' + path, { headers: { 'user-agent': ua } });

(async () => {
  const { handle, githubCard, gistCard } = await import('../functions/_lib/preview.mjs');
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('card: file name and repo come from the link, only for plain notebook links', () => {
    assert.deepStrictEqual(githubCard(['o', 'r', 'blob', 'main', 'dir', 'Data%20Viz.ipynb']), { title: 'Data Viz', description: 'Jupyter notebook in o/r' });
    for (const bad of [
      ['o', 'r', 'tree', 'main', 'a.ipynb'], ['o', 'r', 'blob', 'main', 'a.txt'], ['o', 'r', 'blob', 'main'],
      ['o', 'r', 'blob', 'main', '..', 'a.ipynb'], ['o', 'r', 'blob', 'main', '%2e%2e', 'a.ipynb'], ['-bad_owner', 'r', 'blob', 'main', 'a.ipynb'],
      ['o', 'r/x', 'blob', 'main', 'a.ipynb'], ['o', 'r', 'blob', 'ma%00in', 'a.ipynb'], ['o', 'r', 'blob', '%E0%A4%A', 'a.ipynb'],
    ]) assert.strictEqual(githubCard(bad), null, bad.join('/'));
    assert.strictEqual(gistCard(['u', 'abc123def']).description, 'Jupyter notebook gist by u');
    assert.strictEqual(gistCard(['abc123def']), null);
    assert.strictEqual(gistCard(['u', '../x']), null);
  });

  test('people (and unknown clients) are redirected to the viewer', () => {
    for (const ua of ['Mozilla/5.0 (Macintosh) Safari/605.1', '']) {
      const r = handle(req('/github/o/r/blob/main/a.ipynb?cell=3', ua), 'github');
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.get('location'), 'https://nbview.org/#/github/o/r/blob/main/a.ipynb?cell=3');
    }
    assert.strictEqual(handle(req('/gist/someone/0123abcd', ''), 'gist').headers.get('location'), 'https://nbview.org/#/gist/0123abcd');
    assert.strictEqual(handle(req('/gist/0123abcd', ''), 'gist').headers.get('location'), 'https://nbview.org/#/gist/0123abcd');
  });

  test('crawlers get a preview page built from the link', async () => {
    const r = handle(req('/github/o/r/blob/main/Data%20Viz.ipynb'), 'github');
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert(html.includes('<meta property="og:title" content="Data Viz">'), html);
    assert(html.includes('content="Jupyter notebook in o/r"'), html);
    assert(html.includes('content="https://nbview.org/github/o/r/blob/main/Data%20Viz.ipynb"') || html.includes('content="https://nbview.org/github/o/r/blob/main/Data%2520Viz.ipynb"') || html.includes('og:url'), html);
    assert(html.includes('content="0;url=https://nbview.org/#/github/o/r/blob/main/Data%20Viz.ipynb"'), html);
    assert(/default-src 'none'/.test(r.headers.get('content-security-policy')));
    const g = handle(req('/gist/u/0123abcd'), 'gist');
    assert((await g.text()).includes('og:title" content="Notebook gist by u"'));
  });

  test('hostile names cannot break out of the preview page', async () => {
    const name = encodeURIComponent('"><script>alert(1)</script><img src=x onerror=alert(2)>.ipynb');
    const html = await handle(req(`/github/o/r/blob/main/${name}`), 'github').text();
    assert(!/<script|<img/i.test(html), html);
  });

  test('anything else falls back to the plain redirect', () => {
    for (const p of ['/github/o/r/blob/main/a.txt', '/github/o/r', '/github/', '/github/o/r/tree/main/dir', '/github/o/r/blob/main/..%2Fa.ipynb']) {
      assert.strictEqual(handle(req(p), 'github').status, 302, p);
    }
    assert.strictEqual(handle(req('/gist/'), 'gist').status, 302);
  });

  test('the function never makes a network request', async () => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('fetch called'); };
    try { handle(req('/github/o/r/blob/main/a.ipynb'), 'github'); } finally { global.fetch = original; }
    assert(!/\bfetch\b/.test(require('fs').readFileSync(require('path').join(__dirname, '../functions/_lib/preview.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '')), 'source mentions fetch');
  });

  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS ', t.name); } catch (e) { failed++; console.log('FAIL ', t.name, '\n     ', e.message.slice(0, 400)); }
  }
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
