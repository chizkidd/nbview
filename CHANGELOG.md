# Changelog

All notable changes to nbview. Dates are when the release's last change landed on `main`. Versions below 1.0 may still change how things work.

## [Unreleased]

### Added
- nbviewer `/gist/...`, `/url/...` and `/urls/...` links now work by swapping the domain, not just `/github/...`. The same forms can be pasted into the box.
- `sitemap.xml`, referenced from `robots.txt`.
- A note on the home page and in the README that nbview is independent and not affiliated with Project Jupyter or nbviewer.

## [0.4.0] - 2026-10-08

Open notebooks in a real Jupyter, and a few site housekeeping files.

### Added
- **Open in Binder** button on notebooks opened from GitHub. It launches the notebook in standard JupyterLab on mybinder.org, so ipywidgets, Plotly and Bokeh outputs can run. Binder builds the environment from the repo's own files (`requirements.txt`, `environment.yml` and so on), so a repo without them opens with only the default libraries.
- The note shown under JavaScript-only outputs now says "Open in Binder or Colab to run it".
- `robots.txt` that allows all crawlers. Before this, `/robots.txt` returned the home page.
- `.well-known/security.txt` that points to GitHub's private vulnerability reporting. It expires on 2027-10-07 and needs renewing once a year.

### Changed
- README updated for the new button and files.

## [0.3.0] - 2026-10-04

Safer, harder to freeze, and no more third-party scripts.

### Security
- Notebook HTML can no longer contain forms, text boxes, buttons or other form controls, so a notebook cannot show a fake sign-in box.
- Author CSS in notebooks keeps colors, borders, fonts and layout, but loses positioning, `z-index` and anything that loads a URL. A notebook can no longer cover the page or restyle the header. Each cell's styles apply to that cell only.
- Only `http` and `https` links are accepted for notebooks opened by URL. `data:`, `javascript:`, `file:` and similar links show an "Unsupported link" message.
- New `_headers` file for Cloudflare Pages: a strict Content-Security-Policy (no form submissions, no framing, scripts only from this site and the Cloudflare analytics script), plus `X-Frame-Options`, `Permissions-Policy` and a referrer policy.
- The libraries are now served from this site (`assets/vendor/`) instead of cdnjs, at current versions with no known advisories: marked 18.0.14, DOMPurify 3.4.16, highlight.js 11.12.0, KaTeX 0.19.0. The theme script moved to its own file so the policy needs no inline scripts.

### Added
- Size limits so one cell cannot freeze the tab:
  - Output over 1 MB sits behind a "Show output" button.
  - Code cells over 200 KB are shown without syntax colors.
  - An equation over 4,000 characters, or nested more than 40 levels deep, is shown as plain TeX. After the first 2,000 equations in a notebook, the rest are shown as TeX too.
  - Local files (drag and drop or "choose one") get the same 10 MB warning as links.
- A cell that fails to render now shows "This cell couldn't be displayed" with its raw source in a collapsible, instead of silently disappearing. A broken output shows its own notice and the rest of the cell still renders.
- New link-preview image (light and dark versions).

### Fixed
- Output images get their pixel size up front (read from the PNG, GIF or JPEG data), so the page no longer jumps as images load.
- Long notebook titles wrap at underscores and dots instead of in the middle of a word, and the title uses the same font as the notebook.
- A leading `<style>` block in HTML output (pandas Styler tables start with one) is kept instead of dropped, so Styler colors show up.
- The error and size-warning pages have a proper top-level heading.

### Changed
- Headings no longer get ids from the markdown library. In-page links such as a table of contents still scroll to the right heading.

## [0.2.0] - 2026-10-03

Looks and links like nbviewer.

### Added
- **Domain swap:** change `nbviewer.org` to `nbview.org` in the address bar and the same notebook opens (`nbview.org/github/owner/repo/blob/main/nb.ipynb`). This works for `/github/` links; nbviewer's `/url/` and `/gist/` link forms are not supported yet.
- **Gist support:** `gist.github.com` links open the first notebook in the gist.
- **Copy link** button on notebooks, and a GitHub icon in the header that links to this repo.
- Folder listings are cached for 5 minutes per tab, so going back to a folder does not use up GitHub's 60-requests-per-hour limit.
- Warning before opening a notebook over 10 MB, with "Open anyway" and "Download" choices.
- A clearer title and description for search engines, a canonical link, and a short text block on the home page for crawlers.
- Link previews: Open Graph and Twitter card tags and a placeholder preview image.

### Changed
- Notebook rendering follows the Jupyter classic / nbviewer look:
  - Helvetica Neue text at 14 px with nbviewer's heading sizes.
  - Light-gray input boxes, `In [n]:` prompts in blue and `Out[n]:` in orange-red.
  - Gray text-output blocks, inline-code chips, and the gray bar on block quotes.
  - Python highlighting with the same Pygments colors: green keywords and built-ins, red strings, purple operators, blue module and function names.
  - Equations use upright letters like nbviewer's MathJax, and long display equations wrap onto several lines instead of running off the page.

## [0.1.0] - 2026-10-02

First release.

### Added
- **Browse GitHub:** a user or org's repos, a repo's folders, with an "only notebooks" filter and the folder's README shown below the listing.
- **Render notebooks** (nbformat 3 and 4): markdown, KaTeX math, syntax-highlighted code, text, HTML tables, PNG/JPEG/GIF/SVG images, ANSI-colored tracebacks, progress-bar output and markdown attachments.
- **Open from many places:** a GitHub URL, `owner/repo`, a `raw.githubusercontent.com` link, a pasted `nbviewer.org/github/...` link, any direct `.ipynb` URL that allows cross-origin reads, or a local file (drag and drop or choose one; it is read in your browser and never uploaded).
- Shareable links of the form `nbview.org/#/github/owner/repo/blob/main/path/nb.ipynb`, and a list of recently opened items on the home page.
- Hide code, Download, Open in Colab and View on GitHub buttons on each notebook.
- Light and dark mode that follows your system until you pick one.
- Optional GitHub token (stored only in your browser) that raises the folder-browsing limit from 60 to 5,000 requests per hour. Opening notebooks does not count toward that limit.
- Hosted on Cloudflare Pages at nbview.org. There is no server and no build step.

### Known limits
- JavaScript outputs (ipywidgets, Plotly, Bokeh) are not run; a note points to Colab.
- Public GitHub repositories only.

[0.4.0]: https://github.com/chizkidd/nbview/releases/tag/v0.4.0
[0.3.0]: https://github.com/chizkidd/nbview/releases/tag/v0.3.0
[0.2.0]: https://github.com/chizkidd/nbview/releases/tag/v0.2.0
[0.1.0]: https://github.com/chizkidd/nbview/releases/tag/v0.1.0
