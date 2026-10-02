# nbview

A client-side Jupyter notebook viewer for public GitHub repos. No server: the browser fetches the `.ipynb` straight from GitHub and renders it, so there's nothing to crash or queue.

**Live at [nbview.org](https://nbview.org)**

## What it does

- Browse any user, org or repo (`chizkidd`, `owner/repo`, or a pasted GitHub URL)
- Render `.ipynb` files: markdown, LaTeX (KaTeX), syntax-highlighted code, text, HTML tables, images, SVG, ANSI-colored tracebacks, progress bars
- Open notebooks from any direct `.ipynb` URL that allows cross-origin reads, or from a local file
- Paste an nbviewer link and it opens the same notebook here
- Shareable URLs, e.g. `nbview.org/#/github/owner/repo/blob/main/path/to/notebook.ipynb`
- Hide code, download, open in Colab
- Light and dark mode, following your system until you pick one

## Folder structure

```
nbview/
├── index.html
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── LICENSE
└── README.md
```

## Deployment

1. Hosted on Cloudflare Pages. Every push to `main` deploys to nbview.org automatically. There is no build step; the repo is served as-is. 

To run locally: `python -m http.server` in this folder, then open http://localhost:8000.


## Limits

- Folder browsing uses the GitHub API: 60 requests/hour per IP without a token. Add a no-scope token via the "GitHub token" button for 5,000/hour. Opening notebooks uses raw.githubusercontent.com and doesn't count.
- JavaScript-based outputs (Plotly, Bokeh, ipywidgets) aren't executed, for safety. Static images, tables and text render normally.
- Public repos only.




