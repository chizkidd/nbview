# nbview

A client-side Jupyter notebook viewer for public GitHub repos. No server: the browser fetches the `.ipynb` straight from GitHub and renders it, so there's nothing to crash or queue.

**Live at [nbview.org](https://nbview.org)**

## What it does

- Browse any user, org or repo (`chizkidd`, `owner/repo`, or a pasted GitHub URL)
- Render `.ipynb` files: markdown, LaTeX (KaTeX), syntax-highlighted code, text, HTML tables, images, SVG, ANSI-colored tracebacks, progress bars
- Inspired by nbviewer: Jupyter classic typography, Pygments-style Python colors, upright math, and long equations that wrap instead of running off the page
- Open notebooks from any direct `.ipynb` URL that allows cross-origin reads, from a gist link, or from a local file
- nbviewer links work too: paste one into the box, or just change `nbviewer.org` to `nbview.org` in the address bar
- Shareable URLs, e.g. `nbview.org/#/github/owner/repo/blob/main/path/to/notebook.ipynb`, plus a "Copy link" button on every notebook
- Hide code, download, open in Binder (standard JupyterLab, so widgets work) or Colab
- Light and dark mode, following your system until you pick one

## Folder structure

```
nbview/
├── index.html
├── _redirects
├── _headers
├── robots.txt
├── .well-known/
│   └── security.txt
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js
│   │   └── theme.js
│   ├── vendor/
│   ├── og-light.png
│   └── og-dark.png
├── LICENSE
└── README.md
```

- `_redirects`: sends `/github/*` to `/#/github/*`, which is what makes the nbviewer domain swap work.
- `_headers`: security headers for Cloudflare Pages: a strict Content-Security-Policy (no form submissions, no framing, scripts only from this site), plus `X-Frame-Options` and `Permissions-Policy`.
- `robots.txt`: allows all crawlers. Without it, Cloudflare Pages answers `/robots.txt` with the home page.
- `.well-known/security.txt`: how to report a security problem (GitHub private vulnerability reporting). Its `Expires` date is one year out, so renew it yearly by editing that line (next: 2027-10-07).
- `assets/vendor/`: the libraries (marked, DOMPurify, highlight.js, KaTeX), served from this site rather than a CDN. Versions and licenses are listed in `assets/vendor/README.md`.
- `assets/js/theme.js`: restores the saved light or dark theme before the first paint.
- `assets/og-light.png`: the 1200x630 preview image used for link cards on X, Slack, Discourse and similar (`og-dark.png` is the dark variant).

## Deployment

1. Hosted on Cloudflare Pages. Every push to `main` deploys to nbview.org automatically. There is no build step; the repo is served as-is, and Pages reads `_redirects` on its own.

To run locally: `python -m http.server` in this folder, then open http://localhost:8000. The `_redirects` rule only applies on Cloudflare Pages, not locally.

## Limits

- Folder browsing and gists use the GitHub API: 60 requests/hour per IP without a token. Add a no-scope token via the "GitHub token" button for 5,000/hour. Opening notebooks uses raw.githubusercontent.com and doesn't count.
- API responses are cached for 5 minutes in the tab (sessionStorage), so going back to a folder you just viewed doesn't use up the limit.
- JavaScript-based outputs (Plotly, Bokeh, ipywidgets) aren't executed, for safety. Static images, tables and text render normally.
- HTML in notebooks is sanitized: scripts, forms and form controls are removed, and author CSS is limited to colors, borders, fonts and layout (no positioning, no `url()`), scoped to the cell it came from. Only http and https notebook links are accepted.
- Size limits keep one cell from freezing the tab: notebooks over 10 MB (including local files) ask before opening, outputs over 1 MB sit behind a "Show output" button, code cells over 200 KB are shown without syntax colors, and equations over 4,000 characters or 40 levels of nesting, or beyond the first 2,000 in a notebook, are shown as plain TeX. A cell that fails to render is replaced by a notice with its raw source.
- Public repos only.
