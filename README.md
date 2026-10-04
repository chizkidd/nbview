# nbview

A client-side Jupyter notebook viewer for public GitHub repos. No server: the browser fetches the `.ipynb` straight from GitHub and renders it, so there's nothing to crash or queue.

**Live at [nbview.org](https://nbview.org)**

## What it does

- Browse any user, org or repo (`chizkidd`, `owner/repo`, or a pasted GitHub URL)
- Render `.ipynb` files: markdown, LaTeX (KaTeX), syntax-highlighted code, text, HTML tables, images, SVG, ANSI-colored tracebacks, progress bars
- Looks like nbviewer: Jupyter classic typography, Pygments-style Python colors, upright math, and long equations that wrap instead of running off the page
- Open notebooks from any direct `.ipynb` URL that allows cross-origin reads, from a gist link, or from a local file
- nbviewer links work too: paste one into the box, or just change `nbviewer.org` to `nbview.org` in the address bar
- Shareable URLs, e.g. `nbview.org/#/github/owner/repo/blob/main/path/to/notebook.ipynb`, plus a "Copy link" button on every notebook
- Hide code, download, open in Colab
- Light and dark mode, following your system until you pick one

## Folder structure

```
nbview/
├── index.html
├── _redirects
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   ├── og-light.png
│   └── og-dark.png
├── LICENSE
└── README.md
```

- `_redirects`: sends `/github/*` to `/#/github/*`, which is what makes the nbviewer domain swap work.
- `assets/og-light.png`: the 1200x630 preview image used for link cards on X, Slack, Discourse and similar (`og-dark.png` is the dark variant).

## Deployment

1. Hosted on Cloudflare Pages. Every push to `main` deploys to nbview.org automatically. There is no build step; the repo is served as-is, and Pages reads `_redirects` on its own.

To run locally: `python -m http.server` in this folder, then open http://localhost:8000. The `_redirects` rule only applies on Cloudflare Pages, not locally.

## Limits

- Folder browsing and gists use the GitHub API: 60 requests/hour per IP without a token. Add a no-scope token via the "GitHub token" button for 5,000/hour. Opening notebooks uses raw.githubusercontent.com and doesn't count.
- API responses are cached for 5 minutes in the tab (sessionStorage), so going back to a folder you just viewed doesn't use up the limit.
- JavaScript-based outputs (Plotly, Bokeh, ipywidgets) aren't executed, for safety. Static images, tables and text render normally.
- Public repos only.
