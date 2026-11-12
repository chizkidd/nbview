# Changelog

All notable changes to nbview. Dates are when the release’s last change landed on `main`. Versions below 1.0 may still change how things work.

## [Unreleased]

## [0.12.0] - 2026-11-12

Compare a notebook against any earlier version in its own history, count the events a page view cannot see, and keep the whole site readable offline.

### Added
- **Counts for the events a page view cannot see.** The viewer is one hash-routed page, so analytics counted the document that arrived and nothing else: opening ten notebooks in one tab looked like one visit. The page now posts one word (`open`, `compare` or `embed`) to `/count`, and the Function adds one to a counter in a KV namespace. No address, user agent, notebook, repo, cookie or timestamp is stored with it, Do Not Track and Global Privacy Control are honoured, and a deployment with no namespace bound answers 204 and records nothing. Totals print at `/count`, an ordinary public page in the app’s shell with no account or sign-in, and the same figures are JSON at `/count?format=json`; `tests/count.js` covers the allowlist, the writes, the page, the JSON and the opt-out.
- **A privacy note at `/privacy`.** One page saying what stays in the browser (a GitHub token, the recently opened list, the theme, a five-minute folder cache in the tab), what goes to GitHub and where, that notebook images from other hosts wait for a click, that there is no nbview server and no account, what the analytics count, and the one sign-in cookie the site can set. Linked from the home column, from both guides and from the dialog that asks for a token, and listed in `sitemap.xml`.
- **Two rendered pages for the two questions people search for.** `/view-ipynb-from-github` and `/compare-jupyter-notebooks` are ordinary server-rendered documents with their own title, description, canonical URL and prose, styled by the site’s stylesheet, listed in `sitemap.xml`, and linked from the home page footer, which disappears once a notebook is open. The viewer is a single hash-routed page, so until now a search engine had only `/` to index while the answers to “open an .ipynb from GitHub” and “compare two notebooks” lived in addresses nothing would find.
- **Remote images wait for a click.** Images in a notebook live anywhere the author pointed them, and loading one hands that server the reader’s IP address (and, in the `Referer`, which notebook they are reading) the moment the page opens. Images from GitHub’s own file hosts load as before; every other image is now a button naming its host, and the picture is fetched only when it is clicked. This closes the last way reading a notebook could reach out on its own.
- **Works offline.** An installed nbview keeps the page shell and its own CSS, JS and icons in a service worker cache, so a repeat visit paints from disk and the app still opens with no network. Notebook content still comes from GitHub, so a notebook it has not cached shows a short explanation instead.
- **Download a clean copy.** The Export menu now saves the notebook itself with outputs and execution counts removed, or with only its markdown cells. Like the other exports it is built in the browser, so cleaning a notebook never uploads it.
- **Embed a notebook.** The Embed button copies an `<iframe>` snippet pointing at `/embed/...`, which shows the notebook without the toolbar and may be framed by any site. Only that path allows framing; the rest of the site still can’t be.
- **Sign in with GitHub.** Where the deployment has a GitHub OAuth app (`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`), the token dialog offers one-click sign-in for private repos. Only the code-for-token exchange is server-side; notebook content is still fetched and rendered by the reader’s browser. The fine-grained token path stays for anyone who wants least privilege.
- **Private repos.** Save a fine-grained GitHub token with **Contents: Read-only** access and open or compare notebooks from private repos, including notebooks in two different private repos. The token is sent only to `api.github.com`; public notebooks keep loading from `raw.githubusercontent.com` without using the API limit.
- Press `/` on the home page to jump into the search box. Inside a notebook the same key still opens Find.
- **Compare against any earlier version.** Opening Compare on a GitHub notebook now lists the file’s own commit history without a click, fifty at a time, with **Load more** for the older ones; the commit you pick stays marked. It used to show thirty and only after pressing a button, so a notebook with a long history had versions nobody could reach. Gists page their revisions the same way. The list can be filtered by message, author or date as you type, and when GitHub’s signed-out limit runs out the dialog says so, with a link to the file’s history on GitHub. `tests/run.js` covers the automatic list, the paging, the filter and the limit message.

### Changed
- **A revoked token stops claiming it is saved.** The top bar kept saying **Token saved**, or **@name**, after GitHub had stopped accepting the token, so a private notebook failed with no hint that the credential was dead. One request on load now asks GitHub who the token belongs to: a 401 relabels the button **Sign in again** and the dialog says GitHub no longer accepts it, while an outage or the rate limit leaves the label alone and the token in place.
- **Signing in with GitHub no longer needs several clicks.** Every click on **Sign in with GitHub** asked GitHub for a new sign-in and reused the same popup, so a second click replaced the attempt the open tab was about to finish, and a failed exchange left a page offering nothing but “Back to nbview”. The open tab is now brought forward instead of restarted, the button reads **Waiting for GitHub** until that tab closes, the recent sign-in states are all accepted so overlapping attempts finish, and a failure says what GitHub answered, both in the popup with a **Try again with GitHub** link and in the dialog that started sign-in.
- **The guides are above the fold on the home page.** They lived in a footer under the recently opened list, so any browsing history pushed them out of view. They now sit in the home column, between the drop zone and that list, and the footer is gone.
- **The two rendered pages use the viewer’s own top bar.** They were built with a second, smaller header (brand and one button), so `/view-ipynb-from-github` and `/compare-jupyter-notebooks` looked like a different site from the page they link to. They are now the app shell with the document spliced into `<main>`: same search box, theme toggle, Private repos dialog and GitHub link, and the same scripts, with app.js leaving the server-rendered text alone. The document itself is unchanged, and is still server-rendered for crawlers.
- **A real answer at `/.well-known/ard.json`, and fonts that start sooner.** Agentic Resource Discovery looks for a manifest at that path; the app shell answered with HTML, which reads as a malformed manifest. The path now returns a valid one with an empty entry list, because nbview publishes no MCP server, agent or API; what it does offer automated readers is documented in `llms.txt`. The page also preloads its two fonts and loads its stylesheet before the theme script, so a first visit on a phone no longer waits for the stylesheet before it discovers the fonts.
- **“Copy link” copies the commit, not the branch.** On a GitHub notebook the copied address now names the exact commit the notebook was read at, resolved in one API request (and skipped when the address already names a commit), so a link pasted into a paper, a chat or a class still shows the same notebook after the branch moves on. If the request fails, the branch link is copied as before.
- **One control for GitHub access.** The top bar’s “GitHub token” button is now **Private repos**, and the dialog leads with **Sign in with GitHub** where the deployment has an OAuth app, with the fine-grained token path below it. The button itself reads **@your-name** once signed in, **Token saved** for a pasted token, or **Private repos**, so the state of private-repo access is visible without opening anything, and the dialog’s clear action says **Sign out** when the token came from a sign-in.
- **New mark.** The tab icon is now nbview’s own `[ ]` cell mark instead of the notebook emoji (SVG first, with 16/32/48/180/512 PNG and `.ico` fallbacks), and the wordmark in the top bar draws the same mark rather than the typed `[ ]` characters.

- **Installable, with a new preview card.** `manifest.webmanifest` gives nbview a home-screen name and icon, a maskable PNG for Android and a themed status bar. The two `og-*.png` social images are regenerated with the drawn cell mark where the brackets used to be typed.

### Removed
- The “Skip to content” link. It was invisible until it received keyboard focus, easy to miss, and the top bar is only a few controls wide, so it caused more confusion than it saved. Focus still moves to the main content when the view changes, so keyboard and screen reader users keep their place.

### Fixed
- **Your own private repositories appear in your repository list.** The list came from GitHub’s public-only endpoint, so signing in changed nothing on that page. When the saved token belongs to the account being viewed it is now built from the authenticated endpoint instead, private repos are tagged, and the count no longer claims every row is public.
- The home page’s search box no longer takes focus when the page loads, so Tab starts at the top of the page instead of in the box (and phones no longer raise the keyboard on arrival).

### Internal
- `/embed/` and `/auth/` are Pages Functions, which set their own security headers because `_headers` rules do not apply to Function responses. That is what lets the embed path allow framing while the rest of the site keeps `frame-ancestors 'self'`.
- Link previews now fall back to the plain redirect to the viewer if anything in the preview code fails, and `_redirects` keeps `/github/...` and `/gist/...` links working if the Functions are ever not invoked (for example a failed Functions deploy). Opening a shared link no longer depends on a single mechanism.

## [0.11.0] - 2026-11-02

Improves accessibility, adds notebook search and saved widget rendering, introduces privacy-preserving link previews, and speeds up initial page loading.

### Accessibility
- **Skip link.** The first Tab stop on every page is now “Skip to content”, which moves keyboard focus to the main content without touching the address.
- **Focus no longer gets lost** when a view changes (opening a notebook, going back, switching to Compare): it moves to the main region instead of dropping to the top of the page.

### Added
- **Find in notebook.** A **Find** button (or press `/`) opens a search bar that highlights every match in code, text and outputs, shows “3 of 12”, and steps through matches with Enter, Shift+Enter or the arrow buttons. Unlike the browser’s find, it works on cells scrolled far off screen in large notebooks, and it skips code or outputs you have hidden. Matching ignores case and treats what you type literally. Escape closes it. Browsers without the highlight feature outline the cell instead.
- **`llms.txt`** describing the site, how to build links to notebooks, and where an automated reader should get notebook contents (raw files on GitHub), for AI agents and tools that look for it.
- **Saved widgets are shown.** ipywidgets outputs (tqdm progress bars, sliders, dropdowns, labels, HTML, and the boxes holding them) now appear read-only from the widget state saved in the notebook, instead of a bare text description. Passwords are never shown, and widgets with no saved state keep their text fallback or a short note.
- **Link previews.** Links like `nbview.org/github/owner/repo/blob/main/notebook.ipynb` now show a card with the notebook’s file name and repo when pasted into Slack, Reddit, X, Discord and similar. The card is built from the address only: the server never fetches or reads the notebook. “Copy link” and the cell `#` button copy this form for GitHub notebooks. People opening the link are redirected to the viewer as before.

### Changed
- **Faster first load.** The page’s scripts no longer block it from showing, and syntax highlighting and math (about 120 KB) load when a notebook opens instead of with the home page. On a throttled phone profile the home page shows its content in about 0.6 s instead of 1.2 s; opening a notebook takes the same time as before.

## [0.10.0] - 2026-10-29

Share a link to one cell, and run Plotly charts safely.

### Added
- **Link to a single cell.** Every cell has a `#` button that copies a link ending in `?cell=N`. Opening it scrolls to that cell and highlights it. The button doesn’t appear in exports or print.
- **Interactive Plotly charts.** A Plotly figure saved in the notebook as data now shows a **Run interactive chart** button. Nothing runs until you click. The chart then runs in a sandboxed frame that can’t touch this page, your storage or cookies, or the network, and it only ever receives the figure’s data. Notebook scripts are still never executed. Stop it with the same button. HTML exports leave a note instead of the chart.

### Changed
- `http://` notebook links (including nbviewer `/url/` links) are now loaded over `https://`, since the site’s security policy blocks plain http requests. Before, they failed to load.
- Pages may now be framed by this site itself (needed for the chart frame); other sites still can’t frame them.

### Internal
- Tests now run under the site’s real `_headers` policy, so a change the browser would block in production fails a test.

## [0.9.0] - 2026-10-29

More ways into Compare, and word-level highlights.

### Added
- **Changed words are highlighted** inside changed lines in Compare, so a one-word edit stands out in a long line.
- **Compare works with gists.** Paste a gist link (or `gist.github.com/user/id/revision`) as either notebook, and the Compare button on a gist notebook can pick an earlier revision of that gist.
- **Compare from the notebook you have open.** A local file or a notebook opened by URL now has a Compare button that carries it over to the Compare page as the first notebook, so you only add the second.

## [0.8.0] - 2026-10-29

Compare any two notebooks, and diffs that read like GitHub’s.

### Added
- **Compare two different notebooks.** The Compare page has a new **Two links** tab: paste a GitHub notebook link, a raw link, `owner/repo/path/to/notebook.ipynb` (uses the default branch) or any direct `.ipynb` URL for each side, in the same repo or different repos. On a GitHub notebook, the Compare dialog also accepts “a different notebook”. Shareable as `nbview.org/#/compare/links/<first>/<second>`. Gist links are not supported in Compare yet.
- **Swap sides** (for two notebooks) and **Swap versions** (for two versions of one notebook) buttons.

### Changed
- Compare diffs now look like GitHub’s: long lines wrap instead of scrolling one by one, each line has its old and new line number, and the side-by-side view uses the full width of the page.
- Compare always opens in the unified (one column) view, on any screen size. The toolbar now reads Unified, then Side by side, and a side-by-side choice is still remembered.

## [0.7.0] - 2026-10-28

See exactly what changed between two versions of a notebook.

### Added
- **Compare**: see what changed between two versions of a notebook. On any GitHub notebook, Compare lets you pick a branch, tag or commit (or one of the file’s recent commits) to compare with; on the home page, “Compare two notebooks” takes two local `.ipynb` files. Changed cells show as a line-by-line diff, side by side or in one column (your choice is remembered, and phones get the one-column view). Unchanged cells collapse, long unchanged runs of lines fold, and Previous and Next change buttons jump between changes. Output changes are optional (Show output changes). Compare links are shareable: `nbview.org/#/compare/github/owner/repo/old...new/path/to/notebook.ipynb`.

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
- A corrupted “recently opened” list in the browser no longer breaks the home page, and a huge link is no longer saved there (it could fill the browser’s storage and put a megabyte-long name in the tab title). File names are capped at 120 characters.
- A GitHub token with an invisible or other disallowed character is now refused when saved, with an explanation, and an already saved one gets a clear message instead of “couldn’t reach GitHub”.
- nbformat 3 notebooks with odd heading levels or empty entries open instead of failing, and a JSON file that is not a notebook says so.
- Odd answers from the GitHub API (no default branch, a repo list that is not a list, folder entries without names) give a clear message instead of a stuck spinner or the word “undefined”. GitHub and notebook requests now time out after 20 and 60 seconds.
- Links of the form `data:`, `javascript:` and `file:` are refused clearly instead of being treated as a host name.
- Colab GitHub links open the notebook, `git@github.com:owner/repo.git` is understood, and Google Drive and Colab Drive links explain why they can’t be opened.
- Long file names no longer push the page sideways on phones.
- Accessibility: code blocks that scroll sideways can be reached with the keyboard and show a focus ring, and two colors (the `Out[n]` prompt and code comments) are slightly darker to reach the 4.5:1 contrast ratio.

### Changed
- A link to a non-notebook file in a repo (for example a README or script) now opens its folder instead of showing a JSON error.
- Page fonts (JetBrains Mono and Source Serif 4) are now served from nbview.org instead of Google Fonts, so visiting no longer sends anything to Google. The Content-Security-Policy no longer lists Google.

### Added
- Regression tests (`npm test`, also in Firefox and Safari’s engine via `BROWSER=firefox` or `BROWSER=webkit`), plus an optional smoke test against the real GitHub (`node tests/live.js`) and a Privacy section in the README.
- `MAINTENANCE.md` (yearly and per-release chores) and `tests/README.md`; the README now puts users first and keeps developer notes in one Development section.

## [0.5.0] - 2026-10-17

Export a notebook as a script, Markdown, HTML or PDF, and nbviewer’s gist and URL links now work too.

### Added
- **Export** menu on every notebook: Python script (`.py`, Python notebooks only; IPython magics and shell commands become comments), Markdown (`.md`, with code fences, text outputs and images), a self-contained HTML page (`.html`, with a strict Content-Security-Policy so it carries no scripts), and Print / Save as PDF. Everything is built in the browser, nothing is uploaded.
- **Line numbers** and **Wrap lines** toggles for code cells. Both are remembered in this browser.
- Print styles: header and buttons are hidden, code wraps, colors print as light mode.
- nbviewer `/gist/...`, `/url/...` and `/urls/...` links now work by swapping the domain, not just `/github/...`. The same forms can be pasted into the box.
- `sitemap.xml`, referenced from `robots.txt`.
- A note on the home page and in the README that nbview is independent and not affiliated with Project Jupyter or nbviewer.

### Changed
- The notebook title now has its own row above the toolbar, so the longer button row can’t squeeze it.
- `_headers` lets the math fonts be loaded from other origins, so saved HTML exports keep their equations when opened from disk.
- README: the folder tree is annotated in place and upkeep notes moved to a Maintenance section.

## [0.4.0] - 2026-10-08

Open notebooks in a real Jupyter, and a few site housekeeping files.

### Added
- **Open in Binder** button on notebooks opened from GitHub. It launches the notebook in standard JupyterLab on mybinder.org, so ipywidgets, Plotly and Bokeh outputs can run. Binder builds the environment from the repo’s own files (`requirements.txt`, `environment.yml` and so on), so a repo without them opens with only the default libraries.
- The note shown under JavaScript-only outputs now says “Open in Binder or Colab to run it”.
- `robots.txt` that allows all crawlers. Before this, `/robots.txt` returned the home page.
- `.well-known/security.txt` that points to GitHub’s private vulnerability reporting. It expires on 2027-10-07 and needs renewing once a year.

### Changed
- README updated for the new button and files.

## [0.3.0] - 2026-10-04

Safer, harder to freeze, and no more third-party scripts.

### Security
- Notebook HTML can no longer contain forms, text boxes, buttons or other form controls, so a notebook cannot show a fake sign-in box.
- Author CSS in notebooks keeps colors, borders, fonts and layout, but loses positioning, `z-index` and anything that loads a URL. A notebook can no longer cover the page or restyle the header. Each cell’s styles apply to that cell only.
- Only `http` and `https` links are accepted for notebooks opened by URL. `data:`, `javascript:`, `file:` and similar links show an “Unsupported link” message.
- New `_headers` file for Cloudflare Pages: a strict Content-Security-Policy (no form submissions, no framing, scripts only from this site and the Cloudflare analytics script), plus `X-Frame-Options`, `Permissions-Policy` and a referrer policy.
- The libraries are now served from this site (`assets/vendor/`) instead of cdnjs, at current versions with no known advisories: marked 18.0.14, DOMPurify 3.4.16, highlight.js 11.12.0, KaTeX 0.19.0. The theme script moved to its own file so the policy needs no inline scripts.

### Added
- Size limits so one cell cannot freeze the tab:
  - Output over 1 MB sits behind a “Show output” button.
  - Code cells over 200 KB are shown without syntax colors.
  - An equation over 4,000 characters, or nested more than 40 levels deep, is shown as plain TeX. After the first 2,000 equations in a notebook, the rest are shown as TeX too.
  - Local files (drag and drop or “choose one”) get the same 10 MB warning as links.
- A cell that fails to render now shows “This cell couldn’t be displayed” with its raw source in a collapsible, instead of silently disappearing. A broken output shows its own notice and the rest of the cell still renders.
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
- **Domain swap:** change `nbviewer.org` to `nbview.org` in the address bar and the same notebook opens (`nbview.org/github/owner/repo/blob/main/nb.ipynb`). This works for `/github/` links; nbviewer’s `/url/` and `/gist/` link forms are not supported yet.
- **Gist support:** `gist.github.com` links open the first notebook in the gist.
- **Copy link** button on notebooks, and a GitHub icon in the header that links to this repo.
- Folder listings are cached for 5 minutes per tab, so going back to a folder does not use up GitHub’s 60-requests-per-hour limit.
- Warning before opening a notebook over 10 MB, with “Open anyway” and “Download” choices.
- A clearer title and description for search engines, a canonical link, and a short text block on the home page for crawlers.
- Link previews: Open Graph and Twitter card tags and a placeholder preview image.

### Changed
- Notebook rendering follows the Jupyter classic / nbviewer look:
  - Helvetica Neue text at 14 px with nbviewer’s heading sizes.
  - Light-gray input boxes, `In [n]:` prompts in blue and `Out[n]:` in orange-red.
  - Gray text-output blocks, inline-code chips, and the gray bar on block quotes.
  - Python highlighting with the same Pygments colors: green keywords and built-ins, red strings, purple operators, blue module and function names.
  - Equations use upright letters like nbviewer’s MathJax, and long display equations wrap onto several lines instead of running off the page.

## [0.1.0] - 2026-10-02

First release.

### Added
- **Browse GitHub:** a user or org’s repos, a repo’s folders, with an “only notebooks” filter and the folder’s README shown below the listing.
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

[0.12.0]: https://github.com/chizkidd/nbview/releases/tag/v0.12.0
[0.11.0]: https://github.com/chizkidd/nbview/releases/tag/v0.11.0
[0.10.0]: https://github.com/chizkidd/nbview/releases/tag/v0.10.0
[0.9.0]: https://github.com/chizkidd/nbview/releases/tag/v0.9.0
[0.8.0]: https://github.com/chizkidd/nbview/releases/tag/v0.8.0
[0.7.0]: https://github.com/chizkidd/nbview/releases/tag/v0.7.0
[0.6.0]: https://github.com/chizkidd/nbview/releases/tag/v0.6.0
[0.5.1]: https://github.com/chizkidd/nbview/releases/tag/v0.5.1
[0.5.0]: https://github.com/chizkidd/nbview/releases/tag/v0.5.0
[0.4.0]: https://github.com/chizkidd/nbview/releases/tag/v0.4.0
[0.3.0]: https://github.com/chizkidd/nbview/releases/tag/v0.3.0
[0.2.0]: https://github.com/chizkidd/nbview/releases/tag/v0.2.0
[0.1.0]: https://github.com/chizkidd/nbview/releases/tag/v0.1.0
