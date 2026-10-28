// Optional smoke test against the real GitHub (needs network; unauthenticated API calls are limited to 60 an hour).
// Run: node tests/live.js   (add LIVE_VIA_CURL=1 if the browser itself has no internet access)
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start, stop } = require('./harness');
// Cases use this repo for API calls because some sandboxes only allow GitHub API access to one repository.
// Swap in any public repo (and add a user page, gist or missing repo case) when running on a normal connection.
const CASES = [
  ['repo (default branch redirect)', '#/github/chizkidd/nbview', s => /tree\/main/.test(s.hash) && s.listing > 3],
  ['folder', '#/github/chizkidd/nbview/tree/main/assets', s => s.listing >= 3 && !s.err],
  ['missing folder', '#/github/chizkidd/nbview/tree/main/does-not-exist', s => /Not found/.test(s.err || '')],
  ['file that is not a notebook', '#/github/chizkidd/nbview/blob/main/README.md', s => /tree\/main/.test(s.hash) && s.listing > 3],
  ['notebook', '#/github/jakevdp/PythonDataScienceHandbook/blob/master/notebooks/04.02-Simple-Scatter-Plots.ipynb', s => s.cells > 10 && !s.err],
  ['missing notebook', '#/github/jakevdp/PythonDataScienceHandbook/blob/master/notebooks/nope.ipynb', s => /not found/i.test(s.err || '')],
  ['compare a real notebook with itself', '#/compare/github/jakevdp/PythonDataScienceHandbook/master...master/notebooks/00.00-Preface.ipynb', s => /No differences/.test(s.text) || /unchanged/.test(s.text)],
  ['compare two real notebooks from different repos', '#/compare/links/' + encodeURIComponent('https://raw.githubusercontent.com/jakevdp/PythonDataScienceHandbook/master/notebooks/00.00-Preface.ipynb') + '/' + encodeURIComponent('https://raw.githubusercontent.com/jupyter-widgets/ipywidgets/main/docs/source/examples/Widget%20Basics.ipynb'), s => /removed|added/.test(s.text)],
  ['nbviewer-style /urls/', '#/urls/raw.githubusercontent.com/jakevdp/PythonDataScienceHandbook/master/notebooks/00.00-Preface.ipynb', s => s.cells > 3],
];
(async () => {
  const base = await start();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let failed = 0;
  for (const [name, hash, check] of CASES) {
    const ctx = await browser.newContext();
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '', contentType: 'text/css' }));
    if (process.env.LIVE_VIA_CURL) {
      // For sandboxes where the browser cannot reach the internet itself: fetch GitHub with curl, hand the real answer to the page.
      await ctx.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com|gist\.githubusercontent\.com)\//, route => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbv-live-'));
        spawnSync('curl', ['-sS', '-m', '25', '-D', path.join(dir, 'h'), '-o', path.join(dir, 'b'), route.request().url()]);
        const blocks = (fs.existsSync(path.join(dir, 'h')) ? fs.readFileSync(path.join(dir, 'h'), 'utf8') : '').split(/\r\n\r\n/).filter(Boolean);
        const head = (blocks[blocks.length - 1] || '').split('\r\n'); // the last block is the real response, earlier ones are proxy handshakes
        const status = Number((head[0].match(/ (\d{3})/) || [])[1]) || 502;
        const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset' };
        for (const line of head.slice(1)) { const k = line.slice(0, line.indexOf(':')).toLowerCase(); if (['content-type', 'x-ratelimit-remaining', 'x-ratelimit-reset'].includes(k)) headers[k] = line.slice(line.indexOf(':') + 1).trim(); }
        const body = fs.existsSync(path.join(dir, 'b')) ? fs.readFileSync(path.join(dir, 'b')) : Buffer.alloc(0);
        fs.rmSync(dir, { recursive: true, force: true });
        route.fulfill({ status, headers, body });
      });
    }
    const page = await ctx.newPage();
    await page.goto(base + '/' + hash);
    await page.waitForSelector('.cell, .error-box, .listing, .page h1', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => ({ cells: document.querySelectorAll('.cell').length, listing: document.querySelectorAll('.listing li').length, err: (document.querySelector('.error-box h1') || {}).textContent, errText: (document.querySelector('.error-box p') || {}).textContent, text: document.body.innerText.slice(0, 400), hash: location.hash }));
    const ok = check(s);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${ok ? '' : JSON.stringify({ ...s, text: s.text.slice(0, 100) })}`);
    await ctx.close();
  }
  await browser.close(); await stop();
  process.exit(failed ? 1 : 0);
})();
