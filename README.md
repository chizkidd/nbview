# nbview

A client-side Jupyter notebook viewer for public GitHub repos. No server: the browser fetches the `.ipynb` straight from GitHub and renders it, so there's nothing to crash or queue.

## What it does

- Browse any user, org or repo (`chizkidd`, `owner/repo`, or a pasted GitHub URL)
- Render `.ipynb` files: markdown, LaTeX (KaTeX), syntax-highlighted code, text, HTML tables, images, SVG, ANSI-colored tracebacks, progress bars
- Open notebooks from any direct `.ipynb` URL that allows cross-origin reads, or from a local file
- Paste an nbviewer link and it opens the same notebook here
- Shareable URLs, e.g. `/#/github/owner/repo/blob/main/path/to/notebook.ipynb`
- Hide code, download, open in Colab

## Folder structure
```
nbview/
├── index.html
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── README.md
└── .nojekyll
```


## Deploy on GitHub Pages

1. Create a repo (e.g. `nbview`) and push `index.html`, `style.css`, `app.js`.
2. Settings → Pages → Deploy from branch → `main` / root.
3. It goes live at `https://<username>.github.io/nbview/`.

To run locally: `python -m http.server` in this folder, then open http://localhost:8000.

## Limits

- Folder browsing uses the GitHub API: 60 requests/hour per IP without a token. Add a no-scope token via the "GitHub token" button for 5,000/hour. Opening notebooks uses raw.githubusercontent.com and doesn't count.
- JavaScript-based outputs (Plotly, Bokeh, ipywidgets) aren't executed, for safety. Static images, tables and text render normally.
- Public repos only.