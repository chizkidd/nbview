/* Link previews. Share links like nbview.org/github/owner/repo/blob/main/nb.ipynb redirect people to the viewer
   (/#/github/...). When the visitor is a link-preview crawler (Slack, Reddit, X, Discord...) the reply is a small
   page whose title and description come from the notebook, so the shared link shows what it is.
   Only the crawlers' requests cause a fetch, and it goes to GitHub's raw file host with a validated path. */

const SITE = 'https://nbview.org';
const BOT = /bot|crawler|spider|facebookexternalhit|slack|discord|telegram|whatsapp|linkedin|twitter|reddit|skype|embedly|pinterest|mastodon|bluesky|iframely|preview/i;
const MAX_BYTES = 8 * 1024 * 1024;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const GIST_ID = /^[0-9a-f]{6,64}$/i;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const join = s => (Array.isArray(s) ? s.join('') : typeof s === 'string' ? s : '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return null; } }

// Plain text from a markdown cell: no tags, links reduced to their text, no emphasis marks.
function plain(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]+/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Title from the first heading, description from the first paragraph of text after it.
function summarize(nb, fallbackName) {
  const cells = nb && Array.isArray(nb.cells) ? nb.cells : [];
  let title = '', desc = '';
  for (const c of cells.slice(0, 30)) {
    if (!c || c.cell_type !== 'markdown') continue;
    const src = join(c.source);
    for (const block of src.split(/\n\s*\n/)) {
      const heading = /^\s*#{1,6}\s+(.+)$/m.exec(block.split('\n')[0]);
      if (heading && !title) { title = plain(heading[1]); const rest = plain(block.split('\n').slice(1).join(' ')); if (rest && !desc) desc = rest; continue; }
      const t = plain(block);
      if (t && !desc) desc = t;
    }
    if (title && desc) break;
  }
  const n = cells.length;
  const meta = n ? `${n} cell${n === 1 ? '' : 's'}` : '';
  return {
    title: clip(title || fallbackName, 90),
    description: clip([desc, meta].filter(Boolean).join(' · ') || 'A Jupyter notebook on nbview', 200),
  };
}

function previewPage({ title, description, path }) {
  const url = SITE + path;
  const hash = `${SITE}/#${path}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} | nbview</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="nbview">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/assets/og-light.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${esc(hash)}">
</head><body><p><a href="${esc(hash)}">${esc(title)}</a></p></body></html>
`;
}

// The raw-file address for a /github/... path, or null when it is not a plain notebook link.
function rawUrl(segments) {
  const [owner, repo, kind, ref, ...rest] = segments;
  if (kind !== 'blob' || !ref || !rest.length) return null;
  const o = safeDecode(owner), r = safeDecode(repo), f = safeDecode(ref);
  const path = rest.map(safeDecode);
  if (!o || !r || !f || path.includes(null) || !OWNER.test(o) || !REPO.test(r)) return null;
  const bad = x => !x || x === '.' || x === '..' || /[\x00-\x1f\\]/.test(x);
  if (bad(f) || path.some(bad) || !/\.ipynb$/i.test(path[path.length - 1])) return null;
  return {
    url: `https://raw.githubusercontent.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}/${encodeURIComponent(f)}/${path.map(encodeURIComponent).join('/')}`,
    name: path[path.length - 1],
  };
}

function gistUrl(segments) {
  if (segments.length < 2) return null;
  const user = safeDecode(segments[0]), id = safeDecode(segments[1]);
  if (!user || !id || !OWNER.test(user) || !GIST_ID.test(id)) return null;
  return { url: `https://gist.githubusercontent.com/${encodeURIComponent(user)}/${id}/raw`, name: 'Gist' };
}

async function readLimited(res) {
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_BYTES) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}

async function describe(target, fetchFn) {
  try {
    const res = await fetchFn(target.url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json, text/plain, */*' } });
    if (!res.ok) return null;
    const text = await readLimited(res);
    if (text == null) return null;
    const nb = JSON.parse(text);
    if (!nb || !Array.isArray(nb.cells)) return null;
    return summarize(nb, target.name);
  } catch { return null; }
}

// kind is 'github' or 'gist'. Returns a Response.
async function handle(request, kind, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const url = new URL(request.url);
  const tail = url.pathname.replace(new RegExp(`^/${kind}/?`), '');
  const segments = tail.split('/').filter(Boolean);
  // /gist/user/id and /gist/id both open the gist by id, as the old redirect rules did.
  const hashPath = kind === 'gist' ? `/gist/${segments[segments.length - 1] || ''}` : `/${kind}/${segments.join('/')}`;
  const human = Response.redirect(`${url.origin}/#${hashPath}${url.search}`, 302);
  if (!segments.length || request.method === 'POST' || !BOT.test(request.headers.get('user-agent') || '')) return human;

  const target = kind === 'github' ? rawUrl(segments) : gistUrl(segments);
  const info = target && (await describe(target, fetchFn));
  if (!info) return human;
  return new Response(previewPage({ ...info, path: hashPath }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

export { handle, summarize, previewPage, rawUrl, gistUrl, plain };
