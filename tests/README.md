# Tests

Regression tests for the sanitizer, size limits, input parsing, accessibility and the exports. They run offline: a small local server hosts the site and GitHub is stubbed.

```
npm install
npx playwright install chromium
npm test
```

## Options

- `npm test -- <text>` runs only the tests whose name contains that text.
- `BROWSER=firefox npm test` and `BROWSER=webkit npm test` run them in Firefox and Safari’s engine. Install them first with `npx playwright install firefox webkit` (WebKit may also need `npx playwright install-deps webkit` on Linux).
- `CHROMIUM_PATH=/path/to/chromium npm test` uses a Chromium you already have.
- `node tests/live.js` is an optional smoke test against the real GitHub and needs network access. Add `LIVE_VIA_CURL=1` if the browser itself has no internet access. Unauthenticated GitHub API calls are limited to 60 an hour.

## Fonts

The browser tests need no font installed. `harness.js` gives every page the site’s own faces from `assets/fonts/`, so line boxes, wrapping and scrolling measure the same on a machine with none at all. Without that, text falls back to the system faces at the end of each stack, a bare container has none of them, and it collapses to zero height.

Opening the app yourself on a bare Linux machine is the case that needs one: install a font package first, or the page looks empty.

```
sudo apt-get install -y --no-install-recommends fonts-dejavu-core
```

`npx playwright install-deps chromium` also pulls in fonts, along with the browser’s other system libraries.

## Files

- `preview.js`: Node tests for the link-preview function in `functions/` (it makes no network requests; no browser).
- `landing.js`: Node tests that every address the two rendered pages print actually resolves: a route with a missing `#` or a missing path segment fails here, not in production.
- `prose.js`: Node tests that no tracked text file outside `assets/vendor/` uses an em dash or en dash, and that the Markdown prose and the visible text of the rendered pages keep their curly quotes and plain spaces, so the docs and the page copy cannot drift back to straight punctuation.
- `harness.js`: starts the server (sending the headers from `_headers`, so tests run under the real CSP) and browser and stubs GitHub (`open()`), gives every page the repo’s own fonts so layout does not depend on the fonts a machine has installed, plus small notebook builders.
- `run.js`: the tests, one `test(name, fn)` each. Every test also hands the text it leaves on screen to a final test, which checks that the viewer’s own copy has no straight punctuation.
- `live.js`: the optional real-GitHub smoke test.
