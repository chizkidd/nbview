# nbview

A client-side Jupyter notebook viewer for GitHub repos (public, and private with a read-only token). No server: the browser fetches the `.ipynb` straight from GitHub and renders it, so there’s nothing to crash or queue.

**Live at [nbview.org](https://nbview.org)**

## What it does

- Browse any user, org or repo (`chizkidd`, `owner/repo`, or a pasted GitHub URL)
- Render `.ipynb` files: markdown, LaTeX (KaTeX), syntax-highlighted code, text, HTML tables, images, SVG, ANSI-colored tracebacks, progress bars
- An image hosted anywhere other than GitHub appears as **Image from example.com** with a **Show** button until it is clicked, so simply opening a notebook cannot make your browser call the author’s server
- Inspired by nbviewer: Jupyter classic typography, Pygments-style Python colors, upright math, and long equations that wrap instead of running off the page
- Open notebooks from any direct `.ipynb` URL that allows cross-origin reads, from a gist link, or from a local file
- Open and compare notebooks from **private repos** with a fine-grained GitHub token (Contents: Read-only), or with one-click **Sign in with GitHub** where the site has an OAuth app configured
- nbviewer links work too: paste one into the box, or just change `nbviewer.org` to `nbview.org` in the address bar
- Shareable URLs, e.g. `nbview.org/github/owner/repo/blob/main/path/to/notebook.ipynb` (the `#/github/...` form works too), with a preview card (file name and repo) when pasted into Slack, Reddit, X and similar, plus a “Copy link” button on every notebook and a `#` button on every cell that copies a link straight to that cell (`...?cell=12`)
- A Contents menu built from the notebook’s headings, Find in notebook (press `/`; matches highlight in code, text and outputs, even in very large notebooks, with next and previous), plus hide code, hide outputs, line numbers, wrap long lines, download, open in Binder (standard JupyterLab, so widgets work) or Colab
- Compare notebooks: use Compare on any GitHub notebook (pick a branch, tag or commit, any earlier commit in the file’s history, or a different notebook), on a gist (earlier revisions), on a local file or a notebook opened by URL; or compare any two notebooks by link, gist link or `owner/repo/path.ipynb` (different repos and branches are fine), or two local files. Changed lines highlight the changed words Changes show cell by cell, in one column (unified) or side by side, with optional output changes
- Plotly charts can run: a chart that was saved with its data shows a “Run interactive chart” button, and clicking it zooms, pans and hovers inside an isolated frame (off until you click)
- Export a notebook as a Python script, Markdown, a standalone HTML page, or a PDF (via your browser’s print dialog), all built locally in your browser
- Download a **clean copy** of the notebook itself: outputs and execution counts removed, or only the markdown cells, so a notebook can be shared without uploading it anywhere
- **Embed** a notebook: the Embed button copies an `<iframe>` snippet for `/embed/...`, which shows the notebook without the toolbar and may be framed by other sites (the rest of the site still can’t be)
- Light and dark mode, following your system until you pick one

nbview is an independent project and is not affiliated with Project Jupyter or nbviewer.

## Limits

- Folder browsing and gists use the GitHub API: 60 requests/hour per IP without a token. Sign in, or add a token via the “Private repos” button in the top bar, for 5,000/hour. Opening a public notebook uses raw.githubusercontent.com and doesn’t count. Opening a private notebook uses one Contents API request (with the token).
- API responses are cached for 5 minutes in the tab (sessionStorage), so going back to a folder you just viewed doesn’t use up the limit.
- Notebook JavaScript is never executed. Bokeh outputs are skipped, and ipywidgets show only their saved state, read-only (progress bars, labels, HTML, values; open the notebook in Binder or Colab to use them); static images, tables and text render normally. The one exception is Plotly figures that were saved as data: they only run after you click “Run interactive chart”, inside a frame the browser isolates from this page (no access to your tokens, storage, cookies or the page, and no network), using the Plotly library served from this site. Charts over about 3 million values or with more than 200 traces don’t run, and at most 8 run at once.
- HTML in notebooks is sanitized: scripts, forms and form controls are removed, and author CSS is limited to colors, borders, fonts and layout (no positioning, no `url()`), scoped to the cell it came from. Only http and https notebook links are accepted.
- Size limits keep one cell from freezing the tab: notebooks over 10 MB (including local files) ask before opening, outputs over 1 MB sit behind a “Show output” button, code cells over 200 KB are shown without syntax colors, and equations over 4,000 characters or 40 levels of nesting, or beyond the first 2,000 in a notebook, are shown as plain TeX. A cell that fails to render is replaced by a notice with its raw source.
- Safari is slower than Chrome and Firefox on very large notebooks: about 3x slower for thousands of cells, and a single markdown cell with over 1 MB of text and no spaces or line breaks can freeze the tab for many seconds.
- Private repos need a token with **Contents: Read** access to them, and with a token saved your own repository list includes them (other people’s lists show public repos only). Create a fine-grained token and select only the repos you want to read; a classic token with no scopes only covers public repos. The token is read-only for notebook content and never leaves this browser except to api.github.com. With Sign in with GitHub, the only server-side step is exchanging GitHub’s one-time code for that token; no notebook content is ever sent to it.

## Privacy

- Notebooks are fetched and rendered in your browser. There is no nbview server that sees them. Link previews are built from the address alone (file name and repo), never from the notebook’s contents.
- Images in a notebook are held back unless they come from GitHub’s own file hosts, the normal case for saved plots and relative paths. Anything else is shown as **Image from example.com** with a **Show** button and is fetched only when clicked, so a third-party host learns neither your IP address nor which notebook you are reading; every image is also requested without a Referer. Everything else (scripts, math fonts, page fonts) is served from nbview.org itself.
- The optional GitHub token, your recently opened list and (after a sign-in) your GitHub account name stay in this browser’s local storage. The token is sent only to api.github.com, never to raw.githubusercontent.com or to notebook image hosts. Use a fine-grained token limited to the repos you need, with Contents: Read-only.
- nbview.org uses Cloudflare’s privacy-focused analytics (page views, no cookies). The same points, at more length, are on `/privacy`, linked from the home page.
- Page-view analytics cannot see a notebook screen, because the viewer is one hash-routed page. So the page posts one word to `/count` (`open`, `compare`, `embed`) and the Function adds one to a counter in the KV binding `COUNTS`; totals print at `/count`, a page anyone can open, and the same numbers are JSON at `/count?format=json`. Nothing about the visitor is stored, no cookie is set, and a browser sending Do Not Track or Global Privacy Control is not counted. Bind the namespace once (Workers & Pages → the project → Settings → Bindings → KV namespace, variable name `COUNTS`); without it the endpoint answers 204 and records nothing.

## Development

There is no build step: the repo is served as-is by Cloudflare Pages, and every push to `main` deploys to nbview.org.

### Folder structure

```
nbview/
├── index.html           page shell and static home text
├── _redirects           nbviewer-style /url and /urls paths -> /#/... routes (the domain swap)
├── functions/           /github and /gist: redirect to the viewer, and answer link-preview crawlers with a card made from the link
│                        /embed: the same page without the toolbar, framed by other sites; /auth: optional GitHub sign-in
│                        /compare-jupyter-notebooks and /view-ipynb-from-github: rendered pages for the two searches the
│                        viewer answers, since the app itself is one hash-routed page a crawler cannot index;
│                        /privacy: what stays in the browser, what goes to GitHub, what the site records
│                        /count: one word per notebook opened, comparison shown or embed, and nothing else;
│                        the totals it holds, printed as a page for anyone who asks
├── manifest.webmanifest  name, colours and icon for a home screen install
├── _headers             security headers: strict CSP (no forms, only this site can frame it, scripts from this site only)
├── sandbox/plotly/      the page inside the isolated chart frame
├── robots.txt           allow all crawlers, points to the sitemap
├── llms.txt             plain-language summary and link formats for AI agents (llmstxt.org)
├── sitemap.xml          the home page, the two guide pages and the privacy page
├── .well-known/
│   ├── ard.json         an empty Agentic Resource Discovery manifest: nbview publishes no MCP server or agent,
│   │                    so the endpoint says so instead of answering with the app shell
│   └── security.txt     how to report a security problem
├── assets/
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js       routing, GitHub fetching, notebook rendering
│   │   ├── export.js    builds the .py, .md, .html and clean .ipynb exports
│   │   ├── diff.js      cell and line diff used by Compare
│   │   ├── embed-boot.js  turns an /embed/... address into the viewer's route
│   │   ├── auth-callback.js  hands a sign-in token to the page that opened it
│   │   └── theme.js     restores light/dark theme before first paint
│   ├── icon.svg         the [ ] cell mark, used for the tab icon and the wordmark (with favicon-16/32/48, apple-touch-icon, icon-512)
│   ├── fonts/           JetBrains Mono and Source Serif 4 (self-hosted, Latin)
│   ├── vendor/          marked, DOMPurify, highlight.js, KaTeX, served from this site (no CDN)
│   ├── og-light.png     1200x630 link-preview image (og-dark.png is the dark variant)
│   └── og-dark.png
├── tests/               regression tests (Playwright)
├── package.json         dev dependencies for the tests only
├── CHANGELOG.md
├── MAINTENANCE.md       yearly and per-release chores
├── LICENSE
└── README.md
```

### Run locally

`python -m http.server` in this folder, then open http://localhost:8000. The `_redirects` rules and the `functions/` link previews only apply on Cloudflare Pages, not locally.

### Tests

`npm install && npx playwright install --with-deps chromium && npm test` (there is no lockfile: the two dev dependencies are pinned exactly in `package.json`). More options, other browsers and the setup for a bare machine or CI are in [tests/README.md](tests/README.md).

CSS and JS are requested with a content hash (`?v=…`), so a deploy can never pair new markup with a stylesheet a browser cached earlier. After editing those files, run `npm run stamp`; `npm test` fails if the stamp is stale. The hash is what does the work: Cloudflare Pages sends its own four-hour `Cache-Control` for assets and ignores one set in `_headers`, so a repeat visit revalidates because the URL changed, not because a header asked it to.

An installed copy runs from `sw.js`: the page, its stamped CSS and JS, and the icons are cached on install, so repeat visits paint from disk and the app still opens with no network. Navigations are fetched from the network first, so a deploy takes effect on the next load. `/auth/*` and `/embed/*` are never cached. Notebook content itself still comes from GitHub, so opening a notebook that is not cached offline shows the offline page.

### Optional: GitHub sign-in

Private repos work with a pasted token out of the box. One-click sign-in needs a GitHub OAuth app, which is configured on the hosting side, not in the repo:

1. Create a GitHub OAuth app with **Authorization callback URL** `https://nbview.org/auth/callback` (for a preview deployment, that deployment’s `/auth/callback`).
2. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as environment variables for the Pages project (`GITHUB_CLIENT_SECRET` as a secret).

The token dialog shows the sign-in button only when `/auth/status` reports that both are set. A classic OAuth app can only ask for the `repo` scope, which is read access to all of the user’s repositories, so the dialog keeps the fine-grained token path for least privilege. `/auth/logout` revokes the token with GitHub when it is removed here.

### Upkeep

Yearly and per-release chores are in [MAINTENANCE.md](MAINTENANCE.md).

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
