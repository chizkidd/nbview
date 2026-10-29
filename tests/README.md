# Tests

Regression tests for the sanitizer, size limits, input parsing, accessibility and the exports. They run offline: a small local server hosts the site and GitHub is stubbed.

```
npm install
npx playwright install chromium
npm test
```

## Options

- `npm test -- <text>` runs only the tests whose name contains that text.
- `BROWSER=firefox npm test` and `BROWSER=webkit npm test` run them in Firefox and Safari's engine. Install them first with `npx playwright install firefox webkit` (WebKit may also need `npx playwright install-deps webkit` on Linux).
- `CHROMIUM_PATH=/path/to/chromium npm test` uses a Chromium you already have.
- `node tests/live.js` is an optional smoke test against the real GitHub and needs network access. Add `LIVE_VIA_CURL=1` if the browser itself has no internet access. Unauthenticated GitHub API calls are limited to 60 an hour.

## Files

- `harness.js`: starts the server (sending the headers from `_headers`, so tests run under the real CSP) and browser and stubs GitHub (`open()`), plus small notebook builders.
- `run.js`: the tests, one `test(name, fn)` each.
- `live.js`: the optional real-GitHub smoke test.
