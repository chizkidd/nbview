#!/usr/bin/env node
/* The page asks for its CSS and JS with a content hash: assets/css/style.css?v=1a2b3c4d.
 * Pages caches /assets for four hours, so a URL that never changes can pair new markup with an old stylesheet.
 * _headers revalidates these paths on every load; the hash makes the URL change, which no cache can ignore.
 *
 *   node scripts/stamp-assets.mjs           rewrite index.html
 *   node scripts/stamp-assets.mjs --check   exit 1 if a version is missing or stale (npm test runs this)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'index.html');
const check = process.argv.includes('--check');
const REF = /(assets\/(?:css|js|vendor)\/[A-Za-z0-9._-]+\.(?:css|js))(?:\?v=[A-Za-z0-9]+)?/g;

const html = readFileSync(page, 'utf8');
const stale = [];
const next = html.replace(REF, (match, path) => {
  const hash = createHash('sha256').update(readFileSync(join(root, path))).digest('hex').slice(0, 8);
  const stamped = `${path}?v=${hash}`;
  if (match !== stamped) stale.push({ from: match, to: stamped });
  return stamped;
});

if (!stale.length) {
  console.log('assets: every version matches its file');
  process.exit(0);
}
if (check) {
  console.error('assets: stale versions, run `npm run stamp`');
  for (const s of stale) console.error(`  ${s.from}  ->  ${s.to}`);
  process.exit(1);
}
writeFileSync(page, next);
for (const s of stale) console.log(`  ${s.from}  ->  ${s.to}`);
console.log(`assets: stamped ${stale.length}`);
