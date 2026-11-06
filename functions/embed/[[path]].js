/* Embeddable notebooks: /embed/github/{owner}/{repo}/blob/{ref}/{path}.ipynb
 *
 * Serves the normal page shell with the toolbar hidden and a policy that lets other sites frame it. A Function is
 * used because _headers rules do not apply to Function responses, so the framing policy for this one path can differ
 * from the rest of the site without weakening it anywhere else.
 *
 * The notebook itself is still fetched by the reader's browser, exactly like the main viewer.
 */

const SITE = 'https://nbview.org';

const CSP = [
  "default-src 'none'",
  "script-src 'self' https://nbview.org https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  'img-src * data: blob:',
  "manifest-src 'self'",
  'media-src https: data: blob:',
  'connect-src https:',
  "form-action 'none'",
  "base-uri 'none'",
  'frame-ancestors *',
  "frame-src 'self'",
  "object-src 'none'",
].join('; ');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isNb = p => /\.ipynb$/i.test(p);
const SEG = /^[A-Za-z0-9._~%:@+-]{1,200}$/;

// What the frame may show: a GitHub notebook (or folder), a gist, or a direct URL. Anything else is refused.
function routeFrom(pathname) {
  const rest = pathname.replace(/^\/embed\/?/, '');
  if (!rest) return null;
  let parts;
  try { parts = rest.split('/').map(decodeURIComponent); } catch { return null; }
  if (parts.length > 40) return null;
  const kind = parts[0];
  if (kind === 'github') {
    const [owner, repo, sub, ref, ...rest] = parts.slice(1);
    if (!owner || !repo || !SEG.test(owner) || !SEG.test(repo)) return null;
    // Notebooks only: a folder or repo listing is not something anyone wants inside a frame.
    if (sub !== 'blob' || !ref || !rest.length || !isNb(rest.join('/'))) return null;
    return '#/' + parts.map(encodeURIComponent).join('/');
  }
  if (kind === 'gist') {
    const id = parts[parts.length - 1];
    return /^[0-9a-f]{6,64}$/i.test(id || '') ? '#/gist/' + id : null;
  }
  if (kind === 'url') {
    const target = rest.replace(/^url\/?/, '');
    return target ? '#/url/' + target : null;
  }
  return null;
}

function titleFrom(pathname) {
  const last = pathname.split('/').filter(Boolean).pop() || '';
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep it as written */ }
  name = name.replace(/\.ipynb$/i, '').replace(/[-_]+/g, ' ').trim();
  return name || 'Jupyter notebook';
}

async function shell(env, request, { route, title, canonical }) {
  let html = '';
  try {
    const res = await env.ASSETS.fetch(new URL('/index.html', request.url));
    if (res.ok) html = await res.text();
  } catch { /* fall through to the plain link */ }

  if (!html) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} | nbview</title></head>
<body><p><a href="${esc(canonical)}">${esc(title)}</a></p></body></html>`;
  }

  const head = `<base href="/">
<meta name="nbv-embed" content="${esc(route)}">
<meta name="nbv-embed-title" content="${esc(title)}">`;
  html = html.replace(/<head>/i, '<head>\n' + head);
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)} | nbview</title>`);
  html = html.replace('<body class="is-home">', '<body>');
  // Keep whatever ?v= stamp the build gave app.js, so the frame gets the same sheet and script the page does.
  html = html.replace(
    /<script defer src="(assets\/js\/app\.js[^"]*)"><\/script>/,
    '<script defer src="/assets/js/embed-boot.js"></script>\n  <script defer src="/$1"></script>'
  );
  return html;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const route = routeFrom(url.pathname);
  if (!route) {
    return new Response('Not a notebook embed. Use /embed/github/{owner}/{repo}/blob/{ref}/{path}.ipynb', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' },
    });
  }
  const canonical = SITE + route.replace(/^#/, '');
  const body = await shell(env, request, { route, title: titleFrom(url.pathname), canonical });
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

export { routeFrom, titleFrom, CSP };
