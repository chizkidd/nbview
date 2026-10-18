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
- Hide code, line numbers, wrap long lines, download, open in Binder (standard JupyterLab, so widgets work) or Colab
- Export a notebook as a Python script, Markdown, a standalone HTML page, or a PDF (via your browser's print dialog), all built locally in your browser
- Light and dark mode, following your system until you pick one

nbview is an independent project and is not affiliated with Project Jupyter or nbviewer.

## Limits

- Folder browsing and gists use the GitHub API: 60 requests/hour per IP without a token. Add a no-scope token via the "GitHub token" button for 5,000/hour. Opening notebooks uses raw.githubusercontent.com and doesn't count.
- API responses are cached for 5 minutes in the tab (sessionStorage), so going back to a folder you just viewed doesn't use up the limit.
- JavaScript-based outputs (Plotly, Bokeh, ipywidgets) aren't executed, for safety. Static images, tables and text render normally.
- HTML in notebooks is sanitized: scripts, forms and form controls are removed, and author CSS is limited to colors, borders, fonts and layout (no positioning, no `url()`), scoped to the cell it came from. Only http and https notebook links are accepted.
- Size limits keep one cell from freezing the tab: notebooks over 10 MB (including local files) ask before opening, outputs over 1 MB sit behind a "Show output" button, code cells over 200 KB are shown without syntax colors, and equations over 4,000 characters or 40 levels of nesting, or beyond the first 2,000 in a notebook, are shown as plain TeX. A cell that fails to render is replaced by a notice with its raw source.
- Safari is slower than Chrome and Firefox on very large notebooks: about 3x slower for thousands of cells, and a single markdown cell with over 1 MB of text and no spaces or line breaks can freeze the tab for many seconds.
- Public repos only.

## Privacy

- Notebooks are fetched and rendered in your browser. There is no nbview server that sees them.
- Remote images in a notebook load from whatever host the notebook points at, so that host can see your IP address. Everything else (scripts, math fonts, page fonts) is served from nbview.org itself.
- The optional GitHub token and your recently opened list stay in this browser's local storage. The token is sent only to api.github.com.
- nbview.org uses Cloudflare's privacy-focused analytics (page views, no cookies).

## Development

There is no build step: the repo is served as-is by Cloudflare Pages, and every push to `main` deploys to nbview.org.

### Folder structure

```
nbview/
├── index.html           page shell and static home text
├── _redirects           nbviewer-style /github, /gist, /url, /urls paths -> /#/... routes (the domain swap)
├── _headers             security headers: strict CSP (no forms, no framing, scripts from this site only)
├── robots.txt           allow all crawlers, points to the sitemap
├── sitemap.xml          the home page
├── .well-known/
│   └── security.txt     how to report a security problem
├── assets/
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js       routing, GitHub fetching, notebook rendering
│   │   ├── export.js    builds the .py, .md and .html exports
│   │   └── theme.js     restores light/dark theme before first paint
│   ├── fonts/           JetBrains Mono and Source Serif 4 (self-hosted, Latin)
│   ├── vendor/          marked, DOMPurify, highlight.js, KaTeX, served from this site (no CDN)
│   ├── og-light.png     1200x630 link-preview image (og-dark.png is the dark variant)
│   └── og-dark.png
├── tests/               regression tests (Playwright), see Tests below
├── package.json         dev dependencies for the tests only
├── CHANGELOG.md
├── LICENSE
└── README.md
```

### Run locally

`python -m http.server` in this folder, then open http://localhost:8000. The `_redirects` rules only apply on Cloudflare Pages, not locally.

### Tests

Regression tests cover the sanitizer, size limits, input parsing, accessibility and exports. They run offline against a local server with GitHub stubbed:

```
npm install
npx playwright install chromium
npm test
```

`BROWSER=firefox npm test` and `BROWSER=webkit npm test` run them in Firefox and Safari's engine, `npm test -- <text>` runs only matching tests, and `CHROMIUM_PATH` points at a Chromium you already have. `node tests/live.js` is an optional smoke test against the real GitHub and needs network access.

### Upkeep

- `.well-known/security.txt` has an `Expires` date one year out. Renew it by editing that line (next: 2027-10-07).
- Library versions and licenses are in `assets/vendor/README.md`, and the fonts are in `assets/fonts/README.md`. Update them by replacing the files, not by adding a CDN.
- Keep `robots.txt`: without it Cloudflare Pages answers `/robots.txt` with the home page.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
