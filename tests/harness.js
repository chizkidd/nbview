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

// The host of a URL, parsed (never a substring match).
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };

let server, browser, base;

// The headers Cloudflare Pages will send, read from the repo's own _headers file, so tests run under the real
// Content-Security-Policy and a violation shows up as a failing test instead of a surprise in production.
function readHeaders() {
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { current = { pattern: raw.trim(), headers: {} }; rules.push(current); continue; }
    const i = raw.indexOf(':');
    if (current && i > 0) current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
  }
  return rules;
}
const matches = (pattern, p) => (pattern.endsWith('*') ? p.startsWith(pattern.slice(0, -1)) : p === pattern);

async function start() {
  const rules = readHeaders();
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' };
    for (const rule of rules) if (matches(rule.pattern, p)) Object.assign(headers, rule.headers);
    res.writeHead(200, headers);
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
    const host = hostOf(u);
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return route.fulfill({ body: '', contentType: 'text/css' });
    requests.push(u);
    const pick = (src) => (typeof src === 'function' ? src(u, route.request()) : src === undefined ? null : { body: typeof src === 'string' || Buffer.isBuffer(src) ? src : JSON.stringify(src) });
    let h = null;
    if (host === 'raw.githubusercontent.com') h = pick(opts.raw);
    else if (host === 'api.github.com') h = pick(opts.api);
    if (!h && opts.other) h = pick(opts.other);
    if (!h || h.abort) return route.abort();
    return route.fulfill({ status: h.status || 200, body: h.body === undefined ? '' : h.body, contentType: h.type || 'application/json', headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(base + '/' + (opts.hash || ''), { waitUntil: 'load' });
  await page.waitForSelector(opts.waitFor || '.cell, .error-box, #big-open, .home, .listing, .diffview, .compare-slots, .compare-links', { timeout: opts.timeout || 20000 }).catch(() => {});
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

module.exports = { start, stop, open, state, nb, md, code, hostOf, get base() { return base; } };
