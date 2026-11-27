// Tests for the link-preview function (functions/_lib/preview.mjs), run in Node. It makes no network requests at all.
const assert = require('assert');

const BOT = 'Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)';
const req = (path, ua = BOT) => new Request('https://nbview.org' + path, { headers: { 'user-agent': ua } });

(async () => {
  const { handle, githubCard, gistCard, compareCard } = await import('../functions/_lib/preview.mjs');
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('card: file name, cell, repo, folder, index and compare cards come from the link', () => {
    assert.deepStrictEqual(githubCard(['o', 'r', 'blob', 'main', 'dir', 'Data%20Viz.ipynb']), { title: 'Data Viz', description: 'Jupyter notebook in o/r' });
    assert.deepStrictEqual(githubCard(['o', 'r', 'blob', 'main', 'Data%20Viz.ipynb'], '?cell=12'), { title: 'Data Viz (cell 12)', description: 'Jupyter notebook in o/r' });
    assert.deepStrictEqual(githubCard(['o', 'r']), { title: 'o/r', description: 'Jupyter notebooks in o/r on GitHub' });
    assert.deepStrictEqual(githubCard(['o', 'r', 'tree', 'main', 'dir']), { title: 'dir in o/r', description: 'Browse notebooks in o/r on GitHub' });
    assert.deepStrictEqual(githubCard(['o', 'r', 'notebooks', 'main']), { title: 'Notebooks in o/r', description: 'Every Jupyter notebook in o/r' });
    assert.deepStrictEqual(compareCard(['github', 'o', 'r', 'v1...v2', 'dir', 'train.ipynb']), { title: 'Compare train (v1 to v2)', description: 'Cell and line diff of train.ipynb in o/r' });
    assert.strictEqual(compareCard(['github', 'o', 'r', 'a'.repeat(40) + '...' + 'b'.repeat(40), 'nb.ipynb']).title, 'Compare nb (aaaaaaa to bbbbbbb)');
    for (const bad of [
      ['o', 'r', 'blob', 'main', 'a.txt'], ['o', 'r', 'blob', 'main'],
      ['o', 'r', 'blob', 'main', '..', 'a.ipynb'], ['o', 'r', 'blob', 'main', '%2e%2e', 'a.ipynb'], ['-bad_owner', 'r', 'blob', 'main', 'a.ipynb'],
      ['o', 'r/x', 'blob', 'main', 'a.ipynb'], ['o', 'r', 'blob', 'ma%00in', 'a.ipynb'], ['o', 'r', 'blob', '%E0%A4%A', 'a.ipynb'],
      ['o', 'r', 'unknown', 'main', 'a.ipynb'],
    ]) assert.strictEqual(githubCard(bad), null, bad.join('/'));
    for (const bad of [
      ['github', 'o', 'r', 'main', 'a.ipynb'],
      ['github', 'o', 'r', 'a...b', 'a.txt'],
      ['github', 'o', 'r', 'a...b', '..', 'a.ipynb'],
      ['links', 'a', 'b'],
    ]) assert.strictEqual(compareCard(bad), null, bad.join('/'));
    assert.strictEqual(gistCard(['u', 'abc123def']).description, 'Jupyter notebook gist by u');
    assert.strictEqual(gistCard(['u', 'abc123def', 'eval.ipynb']).title, 'eval');
    assert.strictEqual(gistCard(['abc123def']), null);
    assert.strictEqual(gistCard(['u', '../x']), null);
  });

  test('people (and unknown clients) are redirected to the viewer', () => {
    for (const ua of ['Mozilla/5.0 (Macintosh) Safari/605.1', '']) {
      const r = handle(req('/github/o/r/blob/main/a.ipynb?cell=3', ua), 'github');
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.get('location'), 'https://nbview.org/#/github/o/r/blob/main/a.ipynb?cell=3');
    }
    assert.strictEqual(handle(req('/compare/github/o/r/v1...v2/a.ipynb', ''), 'compare').headers.get('location'), 'https://nbview.org/#/compare/github/o/r/v1...v2/a.ipynb');
    assert.strictEqual(handle(req('/gist/someone/0123abcd', ''), 'gist').headers.get('location'), 'https://nbview.org/#/gist/0123abcd');
    assert.strictEqual(handle(req('/gist/someone/0123abcd/eval.ipynb', ''), 'gist').headers.get('location'), 'https://nbview.org/#/gist/0123abcd/eval.ipynb');
    assert.strictEqual(handle(req('/gist/0123abcd', ''), 'gist').headers.get('location'), 'https://nbview.org/#/gist/0123abcd');
  });

  test('crawlers get a preview page built from the link', async () => {
    const r = handle(req('/github/o/r/blob/main/Data%20Viz.ipynb?cell=4'), 'github');
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert(html.includes('<meta property="og:title" content="Data Viz (cell 4)">'), html);
    assert(html.includes('content="Jupyter notebook in o/r"'), html);
    assert(html.includes('content="0;url=https://nbview.org/#/github/o/r/blob/main/Data%20Viz.ipynb?cell=4"'), html);
    assert(/default-src 'none'/.test(r.headers.get('content-security-policy')));
    const g = handle(req('/gist/u/0123abcd'), 'gist');
    assert((await g.text()).includes('og:title" content="Notebook gist by u"'));
    const cmp = handle(req('/compare/github/o/r/v1...v2/train.ipynb'), 'compare');
    assert.strictEqual(cmp.status, 200);
    assert((await cmp.text()).includes('og:title" content="Compare train (v1 to v2)"'));
    const repo = handle(req('/github/o/r'), 'github');
    assert.strictEqual(repo.status, 200);
    assert((await repo.text()).includes('og:title" content="o/r"'));
  });

  test('hostile names cannot break out of the preview page', async () => {
    const name = encodeURIComponent('"><script>alert(1)</script><img src=x onerror=alert(2)>.ipynb');
    const html = await handle(req(`/github/o/r/blob/main/${name}`), 'github').text();
    assert(!/<script|<img/i.test(html), html);
  });

  test('anything else falls back to the plain redirect', () => {
    for (const p of ['/github/o/r/blob/main/a.txt', '/github/', '/github/o', '/github/o/r/blob/main/..%2Fa.ipynb']) {
      assert.strictEqual(handle(req(p), 'github').status, 302, p);
    }
    assert.strictEqual(handle(req('/compare/links/a/b'), 'compare').status, 302);
    assert.strictEqual(handle(req('/gist/'), 'gist').status, 302);
  });

  test('a broken request still redirects instead of failing', () => {
    // The preview is a nicety; the redirect is the product. Nothing here may throw a 500 over a shared link.
    const r = handle({ url: 'not a url', method: 'GET', headers: new Headers() }, 'github');
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), 'https://nbview.org/#/github/');
    assert.strictEqual(handle({ url: 'not a url', method: 'GET', headers: new Headers() }, 'gist').headers.get('location'), 'https://nbview.org/#/gist/');
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
