# Maintenance

Chores that are easy to forget. There is no build step, so there is little else to do.

## Every year

- **Renew `.well-known/security.txt`.** It has an `Expires` date one year out. Edit that line to a date one year from now (next due: 2027-10-07). Browsers and scanners treat an expired `security.txt` as stale.

## When updating a library

- Libraries (marked, DOMPurify, highlight.js, KaTeX) are served from `assets/vendor/`, not a CDN. Versions and licenses are listed in `assets/vendor/README.md`.
- Update by replacing the files in that folder and the versions in its README, then run the tests. Do not add a CDN: the Content-Security-Policy only allows scripts from this site.
- Fonts live in `assets/fonts/` (see its README). The `@font-face` rules are at the top of `assets/css/style.css`.

## Files to keep

- `robots.txt`: without it, Cloudflare Pages answers `/robots.txt` with the home page.
- `_headers`: the Content-Security-Policy and other security headers. If you add a new script, font or image host, the policy has to allow it or the browser will block it. `https://nbview.org` appears in `script-src` on purpose: Safari does not match `'self'` inside the sandboxed chart frame. If the domain ever changes, change it there.
- `sandbox/plotly/index.html` and `assets/sandbox/plotly-frame.js`: the isolated chart frame. Keep `sandbox="allow-scripts"` (never add `allow-same-origin`) on the iframe in `plotlyBox` in `assets/js/app.js`.
- `_redirects` and `functions/`: make the nbviewer domain swap work. `/github/*` and `/gist/*` go through `functions/` (redirect for people, link preview for crawlers), so do not add `_redirects` rules for those paths. Cloudflare Pages deploys `functions/` automatically with the site.

## Cloudflare and GitHub settings (not in the repo)

- Cloudflare: MFA on the account and HSTS on the zone.
- GitHub: private vulnerability reporting (the link in `security.txt`), secret scanning with push protection, and a ruleset on `main` that blocks force pushes and deletions.

## Releasing

1. Move the "Unreleased" entries in `CHANGELOG.md` under a new version heading with the date, and merge.
2. Tag the merge commit (`git tag -a vX.Y.Z -m "vX.Y.Z"`, `git push origin vX.Y.Z`).
3. Publish a GitHub release with the same notes (`gh release create vX.Y.Z --notes-file notes.md --latest`).
