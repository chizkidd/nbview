// Fails if an em dash turns up in hand-written prose again. The rendered pages, the README, the changelog and the
// worker comments were all rewritten to read without one, so the check runs on the whole repo rather than on a list of
// files: a dash in a new guide, a new README sentence or a new sw.js comment is caught here, and so is one put back
// into a file this test never heard of.
//
// Only tracked text is read, and assets/vendor/ is skipped: KaTeX and highlight.js ship their own strings, and their
// punctuation is not ours to change. The needle is written as an escape so this file does not trip over itself.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DASH = '\u2014';
const VENDOR = 'assets/vendor/';
const TEXT = new Set([
  '.md', '.markdown', '.txt', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.html', '.css',
  '.xml', '.svg', '.webmanifest', '.yml', '.yaml', '.toml', '.sh', '.py',
]);
// Extensionless files that are still prose or config: the worker's routing tables, the licence, dotfiles.
const NO_EXTENSION = new Set(['LICENSE', 'LICENCE', '_redirects', '_headers', '.gitignore', '.gitattributes', '.editorconfig']);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => {
  if (!cond) throw new Error(detail === undefined ? 'assertion failed' : detail);
};

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function isText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext) return TEXT.has(ext);
  return NO_EXTENSION.has(path.basename(file));
}

function excerpt(line, at, width = 40) {
  return line.slice(Math.max(0, at - width), at + width).replace(/\s+/g, ' ').trim();
}

test('no em dash in hand-written prose', () => {
  const files = trackedFiles().filter(file => !file.startsWith(VENDOR) && isText(file));

  // Guard the guard: if the file list ever stops covering the copy this test exists to protect, say so instead of
  // passing because it read nothing.
  assert(files.length >= 20, `only ${files.length} tracked text files were found, so this scan is not reading the repo`);
  for (const expected of ['README.md', 'CHANGELOG.md', 'sw.js', 'index.html', 'functions/privacy.js', 'tests/README.md']) {
    assert(files.includes(expected), `${expected} was not scanned, so this test is not covering the prose it claims to`);
  }

  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const at = line.indexOf(DASH);
      if (at !== -1) hits.push(`${file}:${index + 1}  ...${excerpt(line, at)}...`);
    });
  }

  assert(!hits.length, [
    `an em dash is back in ${hits.length} place${hits.length === 1 ? '' : 's'}:`,
    ...hits.map(hit => '  ' + hit),
    '',
    'Use a colon, a semicolon, commas or parentheses, or start a new sentence.',
  ].join('\n'));

  return `${files.length} tracked text files`;
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    const detail = fn();
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    for (const line of String(error.message).split('\n')) console.log(`      ${line}`);
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
