# Changelog

All notable changes to nbview. Dates are when the release's last change landed on `main`. Versions below 1.0 may still change how things work.

## [0.10.0] - 2026-10-29

Share a link to one cell, and run Plotly charts safely.

### Added
- **Link to a single cell.** Every cell has a `#` button that copies a link ending in `?cell=N`. Opening it scrolls to that cell and highlights it. The button doesn't appear in exports or print.
- **Interactive Plotly charts.** A Plotly figure saved in the notebook as data now shows a **Run interactive chart** button. Nothing runs until you click. The chart then runs in a sandboxed frame that can't touch this page, your storage or cookies, or the network, and it only ever receives the figure's data. Notebook scripts are still never executed. Stop it with the same button. HTML exports leave a note instead of the chart.

### Changed
- `http://` notebook links (including nbviewer `/url/` links) are now loaded over `https://`, since the site's security policy blocks plain http requests. Before, they failed to load.
- Pages may now be framed by this site itself (needed for the chart frame); other sites still can't frame them.

### Internal
- Tests now run under the site's real `_headers` policy, so a change the browser would block in production fails a test.

## [0.9.0] - 2026-10-29

More ways into Compare, and word-level highlights.

### Added
- **Changed words are highlighted** inside changed lines in Compare, so a one-word edit stands out in a long line.
- **Compare works with gists.** Paste a gist link (or `gist.github.com/user/id/revision`) as either notebook, and the Compare button on a gist notebook can pick an earlier revision of that gist.
- **Compare from the notebook you have open.** A local file or a notebook opened by URL now has a Compare button that carries it over to the Compare page as the first notebook, so you only add the second.

## [0.8.0] - 2026-10-29

Compare any two notebooks, and diffs that read like GitHub's.

### Added
- **Compare two different notebooks.** The Compare page has a new **Two links** tab: paste a GitHub notebook link, a raw link, `owner/repo/path/to/notebook.ipynb` (uses the default branch) or any direct `.ipynb` URL for each side, in the same repo or different repos. On a GitHub notebook, the Compare dialog also accepts "a different notebook". Shareable as `nbview.org/#/compare/links/<first>/<second>`. Gist links are not supported in Compare yet.
- **Swap sides** (for two notebooks) and **Swap versions** (for two versions of one notebook) buttons.

### Changed
- Compare diffs now look like GitHub's: long lines wrap instead of scrolling one by one, each line has its old and new line number, and the side-by-side view uses the full width of the page.
- Compare always opens in the unified (one column) view, on any screen size. The toolbar now reads Unified, then Side by side, and a side-by-side choice is still remembered.

## [0.7.0] - 2026-10-28

See exactly what changed between two versions of a notebook.

### Added
- **Compare**: see what changed between two versions of a notebook. On any GitHub notebook, Compare lets you pick a branch, tag or commit (or one of the file's recent commits) to compare with; on the home page, "Compare two notebooks" takes two local `.ipynb` files. Changed cells show as a line-by-line diff, side by side or in one column (your choice is remembered, and phones get the one-column view). Unchanged cells collapse, long unchanged runs of lines fold, and Previous and Next change buttons jump between changes. Output changes are optional (Show output changes). Compare links are shareable: `nbview.org/#/compare/github/owner/repo/old...new/path/to/notebook.ipynb`.

## [0.6.0] - 2026-10-28

Find your way around long notebooks, and hide outputs when you only want the code.

### Added
- **Contents** menu on notebooks that have markdown headings (levels 1 to 4): click an entry to jump to that heading. It fills in as the notebook renders.
- **Hide outputs** toggle next to Hide code. The HTML export keeps the choice.

### Changed
- Escape or a click elsewhere closes any open toolbar menu.

## [0.5.1] - 2026-10-22

Hardening pass from the adversarial QA report, self-hosted fonts, and cross-browser tests.

### Fixed
- Very large notebooks render much faster: 5,000 cells went from about 19 s to about 3 s, and the first cell appears in half a second.
- A corrupted "recently opened" list in the browser no longer breaks the home page, and a huge link is no longer saved there (it could fill the browser's storage and put a megabyte-long name in the tab title). File names are capped at 120 characters.
- A GitHub token with an invisible or other disallowed character is now refused when saved, with an explanation, and an already saved one gets a clear message instead of "couldn't reach GitHub".
- nbformat 3 notebooks with odd heading levels or empty entries open instead of failing, and a JSON file that is not a notebook says so.
- Odd answers from the GitHub API (no default branch, a repo list that is not a list, folder entries without names) give a clear message instead of a stuck spinner or the word "undefined". GitHub and notebook requests now time out after 20 and 60 seconds.
- Links of the form `data:`, `javascript:` and `file:` are refused clearly instead of being treated as a host name.
- Colab GitHub links open the notebook, `git@github.com:owner/repo.git` is understood, and Google Drive and Colab Drive links explain why they can't be opened.
- Long file names no longer push the page sideways on phones.
- Accessibility: code blocks that scroll sideways can be reached with the keyboard and show a focus ring, and two colors (the `Out[n]` prompt and code comments) are slightly darker to reach the 4.5:1 contrast ratio.

### Changed
- A link to a non-notebook file in a repo (for example a README or script) now opens its folder instead of showing a JSON error.
- Page fonts (JetBrains Mono and Source Serif 4) are now served from nbview.org instead of Google Fonts, so visiting no longer sends anything to Google. The Content-Security-Policy no longer lists Google.

### Added
- Regression tests (`npm test`, also in Firefox and Safari's engine via `BROWSER=firefox` or `BROWSER=webkit`), plus an optional smoke test against the real GitHub (`node tests/live.js`) and a Privacy section in the README.
- `MAINTENANCE.md` (yearly and per-release chores) and `tests/README.md`; the README now puts users first and keeps developer notes in one Development section.

## [0.5.0] - 2026-10-17

Export a notebook as a script, Markdown, HTML or PDF, and nbviewer's gist and URL links now work too.

### Added
- **Export** menu on every notebook: Python script (`.py`, Python notebooks only; IPython magics and shell commands become comments), Markdown (`.md`, with code fences, text outputs and images), a self-contained HTML page (`.html`, with a strict Content-Security-Policy so it carries no scripts), and Print / Save as PDF. Everything is built in the browser, nothing is uploaded.
- **Line numbers** and **Wrap lines** toggles for code cells. Both are remembered in this browser.
- Print styles: header and buttons are hidden, code wraps, colors print as light mode.
- nbviewer `/gist/...`, `/url/...` and `/urls/...` links now work by swapping the domain, not just `/github/...`. The same forms can be pasted into the box.
- `sitemap.xml`, referenced from `robots.txt`.
- A note on the home page and in the README that nbview is independent and not affiliated with Project Jupyter or nbviewer.

### Changed
- The notebook title now has its own row above the toolbar, so the longer button row can't squeeze it.
- `_headers` lets the math fonts be loaded from other origins, so saved HTML exports keep their equations when opened from disk.
- README: the folder tree is annotated in place and upkeep notes moved to a Maintenance section.

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
