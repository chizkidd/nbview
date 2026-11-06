/* Offline shell for nbview. https://nbview.org
 *
 * Two kinds of request, two policies:
 *
 *   navigations   network first, so a deploy takes effect on the next load. The cached shell is the fallback.
 *   assets        cache first, but only for URLs carrying a ?v= stamp. The stamp is a hash of the file
 *                 (scripts/stamp-assets.mjs), so a new build is a new URL and a cached copy can never be stale.
 *                 An unstamped file (icon, font, favicon) is served from cache and refreshed behind the scenes.
 *
 * Never cached: /auth/* (a sign-in response must not be replayable), /embed/* (rendered per notebook), anything
 * that is not a GET, and every other origin — GitHub API responses can be private or authorised by a token.
 *
 * Notebook content still needs the network; it is fetched from GitHub by the page, not by this worker.
 */

const VERSION = '1';
const SHELL = `nbv-shell-${VERSION}`;
const ASSETS = `nbv-assets-${VERSION}`;
const SHELL_KEY = '/index.html';

// The page, the manifest, and the icons the install prompt draws from. Everything else comes from index.html,
// so this list never has to be kept in step with the markup by hand.
const CORE = [
  '/',
  '/manifest.webmanifest',
  '/assets/icon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png',
];

const BYPASS = /^\/(?:auth|embed)(?:\/|$)/;
const STAMPED = /[?&]v=/;
const PRUNABLE = /^\/assets\/(?:css|js|vendor)\//;
// Screenshots and share images are several hundred kilobytes each and are never needed to paint the page.
const SKIP = /^\/assets\/(?:screenshots\/|og-)/;
const REF = /(?:src|href)="(\/?assets\/[^"]+)"/g;

function refsIn(html) {
  const out = new Set();
  for (const [, href] of html.matchAll(REF)) {
    const path = href.startsWith('/') ? href : '/' + href;
    if (!SKIP.test(path)) out.add(path);
  }
  return [...out];
}

async function fresh(url) {
  const res = await fetch(new Request(url, { cache: 'reload' }));
  return res.ok && res.type === 'basic' ? res : null;
}

async function precache() {
  const shell = await caches.open(SHELL);
  const assets = await caches.open(ASSETS);
  await Promise.all(CORE.map(async url => {
    // One missing file must not fail the install; the page is useless without its own copy, though.
    try { const res = await fresh(url); if (res) await shell.put(url, res); } catch { /* try the next one */ }
  }));
  const page = await shell.match('/');
  if (!page) return;
  const html = await page.clone().text();
  await shell.put(SHELL_KEY, page);
  await Promise.all(refsIn(html).map(async url => {
    try { const res = await fresh(url); if (res) await assets.put(url, res); } catch { /* the next load will fetch it */ }
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('nbv-') && name !== SHELL && name !== ASSETS) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || BYPASS.test(url.pathname)) return;
  event.respondWith(req.mode === 'navigate' ? page(req) : asset(req, url));
});

async function page(req) {
  const shell = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      const copy = res.clone();
      await shell.put('/', res.clone());
      await shell.put(SHELL_KEY, res.clone());
      await remember(copy);
    }
    return res;
  } catch {
    return (await shell.match('/')) || (await shell.match(SHELL_KEY)) || offline();
  }
}

// A fresh shell just arrived: cache what it asks for, and forget stamped files it no longer mentions, so a
// series of deploys cannot pile old stylesheets up in the cache.
async function remember(res) {
  try {
    const refs = refsIn(await res.text());
    const assets = await caches.open(ASSETS);
    await Promise.all(refs.map(async url => {
      if (await assets.match(url)) return;
      try { const r = await fresh(url); if (r) await assets.put(url, r); } catch { /* cached on demand later */ }
    }));
    const keep = new Set(refs);
    for (const key of await assets.keys()) {
      const url = new URL(key.url);
      if (PRUNABLE.test(url.pathname) && !keep.has(url.pathname + url.search)) await assets.delete(key);
    }
  } catch { /* caching is a speed-up, never a requirement */ }
}

async function asset(req, url) {
  const cached = await caches.match(req, { cacheName: ASSETS });
  if (cached && STAMPED.test(url.search)) return cached;
  const assets = await caches.open(ASSETS);
  const network = fetch(req).then(async res => {
    if (res.ok && res.type === 'basic') await assets.put(req, res.clone());
    return res;
  });
  if (cached) {
    network.catch(() => {}); // an unstamped file: show the cached copy, refresh it in the background
    return cached;
  }
  try { return await network; } catch { return Response.error(); }
}

function offline() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>nbview is offline</title>' +
    '<style>body{font:16px/1.6 system-ui,sans-serif;margin:12vh auto;max-width:32rem;padding:0 1.25rem;' +
    'color:#1b2537;background:#F6F7F9}@media(prefers-color-scheme:dark){body{color:#e8ecf4;background:#12182a}}' +
    'a{color:#2D52CF}h1{font-size:1.4rem;margin:0 0 .5rem}</style></head><body>' +
    '<h1>nbview is offline</h1><p>This notebook has not been saved to this device yet. ' +
    'Reconnect and reload to open it.</p><p><a href="/">Back to nbview</a></p></body></html>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}
