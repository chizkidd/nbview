/* Server-rendered pages for the two questions nbview answers: comparing notebooks, and opening an .ipynb from GitHub.
 *
 * The viewer is one client-side page with hash routes, so a crawler that fetches nbview.org gets the app shell and
 * nothing to index. These paths are real documents instead: their own title, description and canonical URL, one h1,
 * headings and prose, rendered with the site's own stylesheet. No script is served, so the policy only has to allow
 * styles and the fonts they load.
 */

const SITE = 'https://nbview.org';

export const CSP = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The same mark the top bar draws on the home page (assets/icon.svg, cropped to the brackets and the cell).
const MARK = '<svg class="brand-mark" viewBox="278 360 468 304" width="23" height="15" fill="currentColor" aria-hidden="true" focusable="false"><rect x="278" y="360" width="74" height="304" rx="8"/><rect x="672" y="360" width="74" height="304" rx="8"/><rect x="278" y="360" width="150" height="74" rx="8"/><rect x="278" y="590" width="150" height="74" rx="8"/><rect x="596" y="360" width="150" height="74" rx="8"/><rect x="596" y="590" width="150" height="74" rx="8"/><rect x="456" y="452" width="112" height="120" rx="12"/></svg>';

// Only the document layout lives here; colours, type and dark mode come from assets/css/style.css.
const STYLE = `
.doc { max-width: 44rem; margin: 0 auto; padding: 0.5rem 0 4rem; }
.doc-bar-cta { margin-left: auto; }
.doc h1 { font: 700 clamp(1.9rem, 4.6vw, 2.9rem)/1.12 var(--serif); letter-spacing: -0.02em; margin: 0 0 1.1rem; max-width: 22ch; }
.doc .lede { font-size: 1.06rem; line-height: 1.6; margin: 0 0 1.1rem; }
.doc h2 { font: 600 1.12rem/1.35 var(--serif); margin: 2.3rem 0 0.7rem; }
.doc p, .doc li { line-height: 1.65; }
.doc p { margin: 0 0 0.9rem; }
.doc ul, .doc ol { margin: 0 0 1rem; padding-left: 1.3rem; }
.doc li { margin: 0.4rem 0; }
.doc a { color: var(--in); }
.doc code { font: 0.86em var(--mono); background: var(--code-bg); padding: 0.1em 0.32em; border-radius: 3px; overflow-wrap: anywhere; }
.doc pre { background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 0.85rem 1rem; margin: 0 0 1rem; overflow-x: auto; }
.doc pre code { background: none; padding: 0; font-size: 0.82rem; }
.doc-table { width: 100%; border-collapse: collapse; margin: 0 0 1.1rem; font-size: 0.93rem; }
.doc-table th, .doc-table td { text-align: left; vertical-align: top; padding: 0.55rem 0.9rem 0.55rem 0; border-bottom: 1px solid var(--rule); }
.doc-table th { font: 600 11.5px var(--mono); text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.doc-cta { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 1.9rem 0 0; }
.doc-foot { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; font-size: 0.86rem; line-height: 1.6; color: var(--muted); }
.doc-foot a { color: inherit; }
@media (max-width: 480px) { .doc-bar-cta { font-size: 12px; padding: 0.35rem 0.55rem; } }
`.trim();

export function page({ path, title, description, body }) {
  const url = SITE + path;
  const t = esc(title), d = esc(description);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="nbview">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/og-light.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#2D52CF">
<link rel="stylesheet" href="/assets/css/style.css">
<style>${STYLE}</style>
</head>
<body>
<header class="bar"><a class="brand" href="/">${MARK}nbview</a><a class="btn primary doc-bar-cta" href="/">Open a notebook</a></header>
<main class="doc">
${body}
</main>
</body>
</html>
`;
}

// Both pages are static text, so the only per-request work is the method check and the headers.
export function respond(request, html) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'cache-control': 'public, max-age=3600',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  });
}
