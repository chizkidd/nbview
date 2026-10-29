// Tests for the link-preview function (functions/_lib/preview.mjs), run in Node with a fake fetch.
const assert = require('assert');

const nb = cells => JSON.stringify({ cells, nbformat: 4 });
const md = s => ({ cell_type: 'markdown', source: [s] });
const BOT = 'Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)';
const req = (path, ua = BOT) => new Request('https://nbview.org' + path, { headers: { 'user-agent': ua } });
const fake = (body, seen = [], init = {}) => async url => { seen.push(url); return new Response(body, { status: 200, ...init }); };

(async () => {
  const { handle, summarize, rawUrl, gistUrl, plain } = await import('../functions/_lib/preview.mjs');
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('summary: title from the first heading, description from the first paragraph', () => {
    const s = summarize(JSON.parse(nb([md('# Plotly **demo**\n\nA [tour](http://x.y) of `charts` with $x^2$ math.'), md('more')])), 'f.ipynb');
    assert.strictEqual(s.title, 'Plotly demo');
    assert.strictEqual(s.description, 'A tour of charts with math. · 2 cells');
    const t = summarize(JSON.parse(nb([{ cell_type: 'code', source: ['1'] }])), 'file.ipynb');
    assert.strictEqual(t.title, 'file.ipynb');
    assert.strictEqual(plain('<b>hi</b> ![img](a.png) text'), 'hi text');
  });

  test('raw URL: only plain notebook links to GitHub are accepted', () => {
    const ok = rawUrl(['o', 'r', 'blob', 'main', 'dir', 'My%20Nb.ipynb']);
    assert.strictEqual(ok.url, 'https://raw.githubusercontent.com/o/r/main/dir/My%20Nb.ipynb');
    for (const bad of [
      ['o', 'r', 'tree', 'main', 'a.ipynb'], ['o', 'r', 'blob', 'main', 'a.txt'], ['o', 'r', 'blob', 'main'],
      ['o', 'r', 'blob', 'main', '..', 'a.ipynb'], ['o', 'r', 'blob', 'main', '%2e%2e', 'a.ipynb'], ['-bad_owner', 'r', 'blob', 'main', 'a.ipynb'],
      ['o', 'r/x', 'blob', 'main', 'a.ipynb'], ['o', 'r', 'blob', 'ma%00in', 'a.ipynb'], ['o', 'r', 'blob', '%E0%A4%A', 'a.ipynb'],
    ]) assert.strictEqual(rawUrl(bad), null, bad.join('/'));
    assert.strictEqual(gistUrl(['u', 'abc123def']).url, 'https://gist.githubusercontent.com/u/abc123def/raw');
    assert.strictEqual(gistUrl(['abc123def']), null);
    assert.strictEqual(gistUrl(['u', '../x']), null);
  });

  test('people (and unknown clients) are redirected to the viewer, with no fetch', async () => {
    const seen = [];
    for (const ua of ['Mozilla/5.0 (Macintosh) Safari/605.1', '']) {
      const r = await handle(req('/github/o/r/blob/main/a.ipynb?cell=3', ua), 'github', { fetch: fake('x', seen) });
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.get('location'), 'https://nbview.org/#/github/o/r/blob/main/a.ipynb?cell=3');
    }
    const g = await handle(req('/gist/someone/0123abcd', ''), 'gist', { fetch: fake('x', seen) });
    assert.strictEqual(g.headers.get('location'), 'https://nbview.org/#/gist/0123abcd');
    const g2 = await handle(req('/gist/0123abcd', ''), 'gist', { fetch: fake('x', seen) });
    assert.strictEqual(g2.headers.get('location'), 'https://nbview.org/#/gist/0123abcd');
    assert.strictEqual(seen.length, 0);
  });

  test('crawlers get a preview page built from the notebook, fetched only from the raw file host', async () => {
    const seen = [];
    const r = await handle(req('/github/o/r/blob/main/a.ipynb'), 'github', { fetch: fake(nb([md('# T')]), seen) });
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert(html.includes('<meta property="og:title" content="T">'), html);
    assert(html.includes('content="https://nbview.org/github/o/r/blob/main/a.ipynb"'), html);
    assert(html.includes('content="0;url=https://nbview.org/#/github/o/r/blob/main/a.ipynb"'), html);
    assert.deepStrictEqual(seen, ['https://raw.githubusercontent.com/o/r/main/a.ipynb']);
    assert(/default-src 'none'/.test(r.headers.get('content-security-policy')));
    const g = await handle(req('/gist/u/0123abcd'), 'gist', { fetch: fake(nb([md('# Gist title')])) });
    assert((await g.text()).includes('og:title" content="Gist title"'));
  });

  test('hostile notebook text cannot break out of the preview page', async () => {
    const evil = '# </title><script>alert(1)</script>"><img src=x onerror=alert(2)>\n\n"\'><svg onload=alert(3)>';
    const html = await (await handle(req('/github/o/r/blob/main/a.ipynb'), 'github', { fetch: fake(nb([md(evil)])) })).text();
    assert(!/<script|<img|<svg|onerror=|onload=/i.test(html.replace(/<meta http-equiv="refresh"[^>]*>/, '')), html);
  });

  test('anything that is not a usable notebook falls back to the plain redirect', async () => {
    const cases = [
      fake('not json'), fake('{"cells": 5}'), fake('[]'), fake('', [], { status: 200 }),
      async () => new Response('nope', { status: 404 }),
      async () => { throw new Error('network'); },
      fake(nb([md('# big')]), [], { headers: { 'content-length': String(50 * 1024 * 1024) } }),
    ];
    for (const f of cases) {
      const r = await handle(req('/github/o/r/blob/main/a.ipynb'), 'github', { fetch: f });
      assert.strictEqual(r.status, 302);
    }
    const r = await handle(req('/github/o/r/blob/main/a.txt'), 'github', { fetch: fake(nb([md('# x')])) });
    assert.strictEqual(r.status, 302);
  });

  test('a body over the limit with no content-length is cut off', async () => {
    const big = new Response(new ReadableStream({ start(c) { const chunk = new Uint8Array(1024 * 1024); for (let i = 0; i < 10; i++) c.enqueue(chunk); c.close(); } }));
    const r = await handle(req('/github/o/r/blob/main/a.ipynb'), 'github', { fetch: async () => big });
    assert.strictEqual(r.status, 302);
  });

  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS ', t.name); } catch (e) { failed++; console.log('FAIL ', t.name, '\n     ', e.message.slice(0, 400)); }
  }
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
