/* Link previews. Share links like nbview.org/github/owner/repo/blob/main/nb.ipynb redirect people to the viewer
   (/#/github/...). When the visitor is a link-preview crawler (Slack, Reddit, X, Discord...) the reply is a small
   page whose title and description come from the link itself (file name and repo), so the shared link shows what it is.
   This code never fetches or reads a notebook: it only looks at the address it was asked for. */

const SITE = 'https://nbview.org';
const BOT = /bot|crawler|spider|facebookexternalhit|slack|discord|telegram|whatsapp|linkedin|twitter|reddit|skype|embedly|pinterest|mastodon|bluesky|iframely|preview/i;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const GIST_ID = /^[0-9a-f]{6,64}$/i;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return null; } }

const badSegment = x => !x || x === '.' || x === '..' || /[\x00-\x1f\\/]/.test(x);

// What a /github/... path says about its notebook, or null when it is not a plain notebook link.
function githubCard(segments) {
  const [owner, repo, kind, ref, ...rest] = segments;
  if (kind !== 'blob' || !ref || !rest.length) return null;
  const o = safeDecode(owner), r = safeDecode(repo), f = safeDecode(ref);
  const path = rest.map(safeDecode);
  if (!o || !r || !f || path.includes(null) || !OWNER.test(o) || !REPO.test(r)) return null;
  if (badSegment(f) || path.some(badSegment) || !/\.ipynb$/i.test(path[path.length - 1])) return null;
  const name = path[path.length - 1].replace(/\.ipynb$/i, '');
  return { title: clip(name, 90), description: `Jupyter notebook in ${o}/${r}` };
}

function gistCard(segments) {
  if (segments.length < 2) return null;
  const user = safeDecode(segments[0]), id = safeDecode(segments[1]);
  if (!user || !id || !OWNER.test(user) || !GIST_ID.test(id)) return null;
  return { title: `Notebook gist by ${user}`, description: `Jupyter notebook gist by ${user}` };
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

// kind is 'github' or 'gist'. Returns a Response.
function handle(request, kind) {
  const url = new URL(request.url);
  const tail = url.pathname.replace(new RegExp(`^/${kind}/?`), '');
  const segments = tail.split('/').filter(Boolean);
  // /gist/user/id and /gist/id both open the gist by id, as the old redirect rules did.
  const hashPath = kind === 'gist' ? `/gist/${segments[segments.length - 1] || ''}` : `/${kind}/${segments.join('/')}`;
  const human = Response.redirect(`${url.origin}/#${hashPath}${url.search}`, 302);
  if (!segments.length || request.method === 'POST' || !BOT.test(request.headers.get('user-agent') || '')) return human;

  const card = kind === 'github' ? githubCard(segments) : gistCard(segments);
  if (!card) return human;
  return new Response(previewPage({ ...card, path: hashPath }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

export { handle, previewPage, githubCard, gistCard };
