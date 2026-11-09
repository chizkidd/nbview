/* The two rendered pages for the questions nbview answers: comparing notebooks, and opening an .ipynb from GitHub.
 *
 * The viewer is one client-side page with hash routes, so a crawler that fetches nbview.org gets the app shell and
 * nothing to index. These paths are real documents instead: their own title, description and canonical URL, one h1,
 * headings and prose.
 *
 * The document is spliced into the app's own shell, read from ASSETS at request time, so the top bar, the theme
 * toggle, the search box and the Private repos dialog are the same markup and the same scripts the viewer runs.
 * app.js sees the server-rendered <main> and leaves it alone (the guard in its route()). If the shell cannot be read,
 * the document is still served on its own, with a plain top bar and no script.
 */

const SITE = 'https://nbview.org';

// The site-wide policy lives in _headers, which Cloudflare does not apply to Function responses, so it is repeated
// here. tests/landing.js fails if the two drift apart.
export const CSP = [
  "default-src 'none'",
  "script-src 'self' https://nbview.org https://static.cloudflareinsights.com",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src * data: blob:",
  "manifest-src 'self'",
  "media-src https: data: blob:",
  "connect-src https:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "frame-src 'self'",
  "object-src 'none'",
].join('; ');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The same mark the top bar draws on the home page (assets/icon.svg, cropped to the brackets and the cell).
const MARK = '<svg class="brand-mark" viewBox="278 360 468 304" width="23" height="15" fill="currentColor" aria-hidden="true" focusable="false"><rect x="278" y="360" width="74" height="304" rx="8"/><rect x="672" y="360" width="74" height="304" rx="8"/><rect x="278" y="360" width="150" height="74" rx="8"/><rect x="278" y="590" width="150" height="74" rx="8"/><rect x="596" y="360" width="150" height="74" rx="8"/><rect x="596" y="590" width="150" height="74" rx="8"/><rect x="456" y="452" width="112" height="120" rx="12"/></svg>';

// Only the document layout lives here; colours, type and dark mode come from assets/css/style.css.
const STYLE = `
.doc { max-width: 44rem; margin: 0 auto; padding: 0.5rem 1.25rem 4rem; min-width: 0; overflow-wrap: break-word; }
.doc h1 { font: 700 clamp(1.9rem, 4.6vw, 2.9rem)/1.12 var(--serif); letter-spacing: -0.02em; margin: 0 0 1.1rem; max-width: 22ch; }
.doc .lede { font-size: 1.06rem; line-height: 1.6; margin: 0 0 1.1rem; }
.doc h2 { font: 600 1.12rem/1.35 var(--serif); margin: 2.3rem 0 0.7rem; }
.doc p, .doc li { line-height: 1.65; }
.doc p { margin: 0 0 0.9rem; }
.doc ul, .doc ol { margin: 0 0 1rem; padding-left: 1.3rem; }
.doc li { margin: 0.4rem 0; }
.doc a { color: var(--in); }
.doc code { font: 0.86em var(--mono); background: var(--code-bg); padding: 0.1em 0.32em; border-radius: 3px; overflow-wrap: anywhere; }
.doc pre { background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 0.85rem 1rem; margin: 0 0 1rem; max-width: 100%; overflow-x: auto; }
.doc pre code { background: none; padding: 0; font-size: 0.82rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.doc-table { width: 100%; border-collapse: collapse; margin: 0 0 1.1rem; font-size: 0.93rem; }
.doc-table th, .doc-table td { text-align: left; vertical-align: top; padding: 0.55rem 0.9rem 0.55rem 0; border-bottom: 1px solid var(--rule); }
.doc-table th { font: 600 11.5px var(--mono); text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.doc-cta { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 1.9rem 0 0; }
.doc-foot { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; font-size: 0.86rem; line-height: 1.6; color: var(--muted); }
.doc-foot a { color: inherit; }
`.trim();

function replace(html, pattern, replacement, what) {
  const found = typeof pattern === 'string' ? html.includes(pattern) : pattern.test(html);
  if (!found) throw new Error(`landing: index.html has no ${what}, so the page cannot be built from the shell`);
  return html.replace(pattern, replacement);
}

// The document inside the app's shell: same head links (stamped assets included), same top bar, same dialogs, same scripts.
function fromShell(shell, { title, description, canonical, body }) {
  const t = esc(title), d = esc(description);
  let html = replace(shell, /<title>[^<]*<\/title>/, `<title>${t}</title>`, 'title');
  html = replace(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`, 'description');
  html = replace(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`, 'canonical');
  html = replace(html, /<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="article">', 'og:type');
  html = replace(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t}">`, 'og:title');
  html = replace(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">`, 'og:description');
  html = replace(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonical}">`, 'og:url');
  html = replace(html, '</head>', `<style>${STYLE}</style>\n</head>`, 'head close');
  // Not is-home: the search box shows, the footer hides, and app.js knows not to draw the home view.
  html = replace(html, /<body class="is-home">/, '<body class="is-doc">', 'home body class');
  // The shell's brand is a hash link, which means "home" only on the viewer's own page. A document served at /privacy
  // or /view-ipynb-from-github needs a real address, or the link is a fragment of itself and clicking it does nothing.
  html = replace(html, /<a class="brand" href="#\/">/, '<a class="brand" href="/">', 'brand link');
  html = replace(html, /<main id="app" tabindex="-1">[\s\S]*?<\/main>/, `<main id="app" tabindex="-1" class="doc">\n${body}\n</main>`, 'main region');
  return html;
}

// The document on its own, for the case where the shell cannot be read: no top bar, no script, still correct.
function skeleton({ title, description, canonical, body }) {
  const t = esc(title), d = esc(description);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="nbview">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/assets/og-light.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="ard" href="/.well-known/ard.json">
<link rel="preload" href="/assets/fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
<meta name="theme-color" content="#2D52CF">
<link rel="stylesheet" href="/assets/css/style.css">
<style>${STYLE}</style>
</head>
<body class="is-doc">
<header class="bar"><a class="brand" href="/">${MARK}nbview</a></header>
<main class="doc">
${body}
</main>
</body>
</html>
`;
}

export async function render(request, env, spec) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        allow: 'GET, HEAD',
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
      },
    });
  }
  const canonical = SITE + spec.path;
  let html = '';
  try {
    const res = await env.ASSETS.fetch(new URL('/index.html', request.url));
    if (res.ok) html = fromShell(await res.text(), { ...spec, canonical });
  } catch { /* no shell available: serve the document by itself */ }
  return new Response(request.method === 'HEAD' ? null : html || skeleton({ ...spec, canonical }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'cache-control': 'public, max-age=3600',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  });
}
