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

const REF_SEG = /^[A-Za-z0-9._~:@+-]{1,200}$/;
const shortRef = s => (/^[0-9a-f]{40}$/i.test(s) ? s.slice(0, 7) : clip(s, 30));

// What a /github/... path says about its target (notebook, repo, folder or notebook index).
function githubCard(segments, search = '') {
  const [owner, repo, kind, ref, ...rest] = segments;
  if (!owner || !repo) return null;
  const o = safeDecode(owner), r = safeDecode(repo);
  if (!o || !r || !OWNER.test(o) || !REPO.test(r)) return null;

  if (!kind) {
    return { title: clip(`${o}/${r}`, 90), description: `Jupyter notebooks in ${o}/${r} on GitHub` };
  }
  if (!ref) return null;
  const f = safeDecode(ref);
  if (!f || badSegment(f)) return null;

  if (kind === 'notebooks' && !rest.length) {
    return { title: clip(`Notebooks in ${o}/${r}`, 90), description: `Every Jupyter notebook in ${o}/${r}` };
  }
  if (kind === 'tree') {
    const path = rest.map(safeDecode);
    if (path.includes(null) || path.some(badSegment)) return null;
    const label = path.length ? `${path[path.length - 1]} in ${o}/${r}` : `${o}/${r}`;
    return { title: clip(label, 90), description: `Browse notebooks in ${o}/${r} on GitHub` };
  }
  if (kind === 'blob' && rest.length) {
    const path = rest.map(safeDecode);
    if (path.includes(null) || path.some(badSegment) || !/\.ipynb$/i.test(path[path.length - 1])) return null;
    const name = path[path.length - 1].replace(/\.ipynb$/i, '');
    const cellMatch = /[?&]cell=(\d{1,6})(?:&|$)/.exec(search || '');
    const suffix = cellMatch ? ` (cell ${cellMatch[1]})` : '';
    return { title: clip(name + suffix, 90), description: `Jupyter notebook in ${o}/${r}` };
  }
  return null;
}

// What a /compare/github/owner/repo/base...head/path.ipynb link says about its diff.
function compareCard(segments) {
  const [kind, owner, repo, spec, ...rest] = segments;
  if (kind !== 'github' || !owner || !repo || !spec || !rest.length) return null;
  const o = safeDecode(owner), r = safeDecode(repo), sp = safeDecode(spec);
  const path = rest.map(safeDecode);
  if (!o || !r || !sp || path.includes(null) || !OWNER.test(o) || !REPO.test(r)) return null;
  const cut = sp.indexOf('...');
  if (cut <= 0 || cut + 3 >= sp.length) return null;
  const base = sp.slice(0, cut), head = sp.slice(cut + 3);
  if (!REF_SEG.test(base) || !REF_SEG.test(head) || path.some(badSegment) || !/\.ipynb$/i.test(path[path.length - 1])) return null;
  const file = path[path.length - 1];
  const name = file.replace(/\.ipynb$/i, '');
  return {
    title: clip(`Compare ${name} (${shortRef(base)} to ${shortRef(head)})`, 90),
    description: `Cell and line diff of ${clip(file, 60)} in ${o}/${r}`,
  };
}

function gistCard(segments) {
  if (segments.length < 2) return null;
  const user = safeDecode(segments[0]), id = safeDecode(segments[1]);
  if (!user || !id || !OWNER.test(user) || !GIST_ID.test(id)) return null;
  const file = segments.length >= 3 ? safeDecode(segments[segments.length - 1]) : null;
  if (file && !badSegment(file) && /\.ipynb$/i.test(file)) {
    return { title: clip(file.replace(/\.ipynb$/i, ''), 90), description: `Jupyter notebook gist by ${user}` };
  }
  return { title: `Notebook gist by ${user}`, description: `Jupyter notebook gist by ${user}` };
}

function previewPage({ title, description, path, search = '' }) {
  const q = /^\?cell=\d{1,6}$/.test(search || '') ? search : '';
  const url = SITE + path + q;
  const hash = `${SITE}/#${path}${q}`;
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

// Where a /kind/... path lands in the viewer. /gist/user/id and /gist/id both open the gist by id, and an extra
// trailing segment (a notebook filename or revision) is preserved so multi-notebook gists link cleanly.
function hashPathFor(kind, segments) {
  if (kind === 'gist') {
    if (!segments.length) return '/gist/';
    if (GIST_ID.test(segments[0])) return `/gist/${segments.join('/')}`;
    if (segments.length >= 2 && GIST_ID.test(segments[1])) return `/gist/${segments.slice(1).join('/')}`;
    return `/gist/${segments[segments.length - 1] || ''}`;
  }
  return `/${kind}/${segments.join('/')}`;
}

// The plain redirect to the viewer, kept separate so it can still be built when something else has gone wrong.
// It never throws: this is what a visitor gets in the worst case, so a bug in the preview code cannot take a link down.
function viewerRedirect(request, kind) {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.replace(new RegExp(`^/${kind}/?`), '').split('/').filter(Boolean);
    return Response.redirect(`${url.origin}/#${hashPathFor(kind, segments)}${url.search}`, 302);
  } catch {
    return new Response(null, { status: 302, headers: { location: `${SITE}/#/${kind}/` } });
  }
}

// kind is 'github', 'gist' or 'compare'. Always returns a Response: the preview is a nicety, opening the notebook is the product.
function handle(request, kind) {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.replace(new RegExp(`^/${kind}/?`), '').split('/').filter(Boolean);
    const hashPath = hashPathFor(kind, segments);
    const human = viewerRedirect(request, kind);
    if (!segments.length || request.method === 'POST' || !BOT.test(request.headers.get('user-agent') || '')) return human;

    const card = kind === 'github' ? githubCard(segments, url.search)
      : kind === 'compare' ? compareCard(segments)
      : gistCard(segments);
    if (!card) return human;
    return new Response(previewPage({ ...card, path: hashPath, search: url.search }), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'",
      },
    });
  } catch {
    return viewerRedirect(request, kind);
  }
}

export { handle, previewPage, githubCard, gistCard, compareCard, hashPathFor };
