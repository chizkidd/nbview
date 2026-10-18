// Starts a static server for the repo, launches Chromium, and stubs GitHub so tests never touch the network.
const http = require('http');
const fs = require('fs');
const path = require('path');
const pw = require('playwright');
const engine = pw[process.env.BROWSER || 'chromium'];

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml' };

const nb = (cells, meta = {}) => ({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, ...meta }, cells });
const md = s => ({ cell_type: 'markdown', metadata: {}, source: [s] });
const code = (s, outputs = [], n = 1) => ({ cell_type: 'code', execution_count: n, metadata: {}, source: [s], outputs });

let server, browser, base;

async function start() {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await engine.launch(process.env.CHROMIUM_PATH && !process.env.BROWSER ? { executablePath: process.env.CHROMIUM_PATH } : {});
  return base;
}

async function stop() {
  if (browser) await browser.close();
  if (server) server.close();
}

// opts: { hash, raw, api, other, viewport, init, settle, timeout, waitFor, scheme }
// raw/api/other: a value (JSON body) or a function(url) returning { status, body, type, abort } or null.
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 800 }, colorScheme: opts.scheme || 'light', acceptDownloads: true });
  if (opts.init) await ctx.addInitScript(opts.init);
  const requests = [];
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.fulfill({ body: '', contentType: 'text/css' });
    requests.push(u);
    const pick = (src) => (typeof src === 'function' ? src(u, route.request()) : src === undefined ? null : { body: typeof src === 'string' || Buffer.isBuffer(src) ? src : JSON.stringify(src) });
    let h = null;
    if (u.includes('raw.githubusercontent.com')) h = pick(opts.raw);
    else if (u.includes('api.github.com')) h = pick(opts.api);
    if (!h && opts.other) h = pick(opts.other);
    if (!h || h.abort) return route.abort();
    return route.fulfill({ status: h.status || 200, body: h.body === undefined ? '' : h.body, contentType: h.type || 'application/json', headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(base + '/' + (opts.hash || ''), { waitUntil: 'load' });
  await page.waitForSelector(opts.waitFor || '.cell, .error-box, #big-open, .home, .listing, .loading', { timeout: opts.timeout || 20000 }).catch(() => {});
  if (opts.settle) await page.waitForTimeout(opts.settle);
  return { page, ctx, requests, errors, base };
}

const state = page => page.evaluate(() => ({
  cells: document.querySelectorAll('.cell').length,
  err: (document.querySelector('.error-box h1') || {}).textContent || null,
  errText: (document.querySelector('.error-box p') || {}).textContent || null,
  hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  title: document.title,
}));

module.exports = { start, stop, open, state, nb, md, code, get base() { return base; } };
