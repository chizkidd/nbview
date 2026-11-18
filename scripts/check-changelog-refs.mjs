#!/usr/bin/env node
/* A changelog entry belongs to the release that shipped it, and an entry that names the change it came from can be
 * checked instead of audited by hand. A reference is a pull request number (#104, PR #104, pulls/104, or a
 * github.com/.../pull/104 link) or a commit (a backticked short or full sha, or commit/<sha>). Every reference has to
 * resolve to a commit that is an ancestor of the tag for the section it sits in: v0.13.0 for [0.13.0]. An entry moved
 * into an earlier section names a commit that is not an ancestor of that tag and fails here.
 *
 *   node scripts/check-changelog-refs.mjs
 *
 * Only sections with a tag are checked. [Unreleased], and a version heading that the release pull request has written
 * but not tagged yet, describe work with no tag to place them against, so the run names them and moves on. That keeps
 * a release pull request green while it cites the pull request that is merging it.
 *
 * Entries without a reference are counted, not failed: the older sections were written before the convention, so the
 * check reports what it could not compare rather than pretending those entries passed.
 *
 * A shallow clone has no tags or history to walk, so the check says it skipped and exits 0 instead of failing on data
 * it was never given. That matters because npm test runs in CI on a depth-1 checkout.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A section heading: ## [0.13.0] - 2026-11-17.
const HEADING = /^##[ \t]+\[([^\]]+)\](?:[ \t]+-[ \t]+\d{4}-\d{2}-\d{2})?[ \t]*$/gm;
const PR_REF = /(?:\bPR[ \t]*)?#(\d{1,6})\b|\bpulls?\/(\d{1,6})\b/gi;
const SHA_REF = /\bcommit\/([0-9a-f]{7,40})\b|`([0-9a-f]{7,40})`/gi;

const run = args => {
  try {
    return {
      ok: true,
      out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim(),
    };
  } catch (error) {
    return { ok: false, code: error.status, out: String(error.stdout || '').trim() };
  }
};
const short = sha => sha.slice(0, 7);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/* Sections and their top-level bullets. Nested bullets belong to the entry above them, which keeps a multi-line entry
 * in one piece, and a subheading closes the entry it follows. */
function readSections(text) {
  const found = [];
  HEADING.lastIndex = 0;
  let match;
  while ((match = HEADING.exec(text))) {
    found.push({ label: match[1], body: match.index + match[0].length, from: match.index });
  }
  found.forEach((section, index) => {
    section.to = index + 1 < found.length ? found[index + 1].from : text.length;
    section.entries = readEntries(text.slice(section.body, section.to));
  });
  return found;
}

function readEntries(body) {
  const entries = [];
  let current = null;
  for (const line of body.split('\n')) {
    if (/^#{2,6}[ \t]/.test(line)) {
      current = null;
      continue;
    }
    if (/^-[ \t]/.test(line)) {
      current = { text: line.replace(/^-[ \t]+/, '') };
      entries.push(current);
      continue;
    }
    if (current && line.trim()) current.text += ' ' + line.trim();
  }
  return entries;
}

/* Pull request numbers and commit tokens in one entry, deduplicated so a repeated reference is checked once. */
function references(text) {
  const prs = new Set();
  const commits = new Set();
  for (const match of text.matchAll(PR_REF)) prs.add(Number(match[1] || match[2]));
  for (const match of text.matchAll(SHA_REF)) commits.add(match[1] || match[2]);
  return { prs: [...prs].sort((a, b) => a - b), commits: [...commits] };
}

let log = null;
function commitLog() {
  if (log) return log;
  const result = run(['log', '--all', '--format=%H%x1f%s']);
  log = result.ok
    ? result.out.split('\n').filter(Boolean).map(line => {
      const [sha, subject] = line.split('\x1f');
      return { sha, subject };
    })
    : [];
  return log;
}

/* Every commit whose subject names the pull request, usually the merge commit. If several do, any ancestor counts. */
function commitsForPr(number) {
  const pattern = new RegExp(`(^|[^0-9])#${number}([^0-9]|$)`);
  return commitLog().filter(commit => pattern.test(commit.subject));
}

function isAncestor(sha, tag) {
  const result = run(['merge-base', '--is-ancestor', sha, tag]);
  if (result.ok) return true;
  if (result.code === 1) return false;
  throw new Error(`git merge-base failed for ${short(sha)} and ${tag}`);
}

const repository = run(['rev-parse', '--is-shallow-repository']);
if (!repository.ok) {
  console.log('changelog refs: skipped, this is not a git checkout');
  process.exit(0);
}
if (repository.out === 'true') {
  console.log('changelog refs: skipped, a shallow clone has no tags or history (git fetch --unshallow --tags)');
  process.exit(0);
}

const sections = readSections(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'));
const passed = [];
const failed = [];
const skipped = [];
let released = 0;
let entries = 0;
let cited = 0;
let checked = 0;

for (const section of sections) {
  if (!/^\d+\.\d+\.\d+$/.test(section.label)) continue;
  const tag = `v${section.label}`;
  if (!run(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).ok) {
    skipped.push(`[${section.label}] has no tag ${tag} yet, so its entries were not checked`);
    continue;
  }
  released += 1;

  for (const entry of section.entries) {
    entries += 1;
    const { prs, commits } = references(entry.text);
    if (!prs.length && !commits.length) continue;
    cited += 1;
    const excerpt = entry.text.length > 60 ? `${entry.text.slice(0, 57)}...` : entry.text;

    for (const number of prs) {
      checked += 1;
      const candidates = commitsForPr(number);
      if (!candidates.length) {
        failed.push(`[${section.label}] PR #${number}: no commit in this checkout names it (${excerpt})`);
        continue;
      }
      const good = candidates.find(commit => isAncestor(commit.sha, tag));
      if (good) passed.push(`PASS  [${section.label}] PR #${number} is ${short(good.sha)} in ${tag}`);
      else failed.push(`[${section.label}] PR #${number}: ${candidates.map(commit => short(commit.sha)).join(', ')} not an ancestor of ${tag} (${excerpt})`);
    }

    for (const token of commits) {
      checked += 1;
      const resolved = run(['rev-parse', '--verify', '--quiet', `${token}^{commit}`]);
      if (!resolved.ok) {
        failed.push(`[${section.label}] commit ${token} is not a commit in this checkout (${excerpt})`);
        continue;
      }
      if (isAncestor(resolved.out, tag)) passed.push(`PASS  [${section.label}] commit ${short(resolved.out)} is in ${tag}`);
      else failed.push(`[${section.label}] commit ${short(resolved.out)} is not an ancestor of ${tag} (${excerpt})`);
    }
  }
}

for (const line of passed) console.log(line);
for (const line of skipped) console.log(`SKIP  ${line}`);
if (failed.length) {
  for (const line of failed) console.log(`FAIL  ${line}`);
  console.log(`changelog refs: ${checked} checked, ${failed.length} failed`);
  process.exit(1);
}
if (!checked) {
  console.log(`changelog refs: ${plural(entries, 'entry', 'entries')} read in ${plural(released, 'released section', 'released sections')}, none cites a commit or PR yet`);
  console.log('  Cite the pull request in new entries, as `(#104)`, and this check can place them.');
  process.exit(0);
}
console.log(`changelog refs: ${plural(checked, 'reference', 'references')} in ${plural(cited, 'entry', 'entries')}, all ancestors of their release tag`);
