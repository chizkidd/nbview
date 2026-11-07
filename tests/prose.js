// Typography tests for hand-written text: the docs and the page copy read without em dashes or en dashes, and the
// Markdown uses curly quotes rather than straight ones. The prose was rewritten by hand to get there, so the check runs
// on the repo rather than on a list of files, and a dash or a straight quote in a new guide, README sentence or worker
// comment is caught here.
//
// Only tracked text is read, and assets/vendor/ is skipped: KaTeX and highlight.js ship their own strings, and their
// punctuation is not ours to change. Characters are written as escapes so this file does not trip over itself.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR = 'assets/vendor/';
const EM_DASH = '\u2014';
const EN_DASH = '\u2013';
// Invisible characters that look like a space but are not one, plus the soft hyphen and a stray BOM.
const INVISIBLE = {
  '\u00a0': 'non-breaking space',
  '\u202f': 'narrow non-breaking space',
  '\u2009': 'thin space',
  '\u200b': 'zero-width space',
  '\u00ad': 'soft hyphen',
  '\ufeff': 'byte order mark',
};
const STRAIGHT_QUOTES = { '"': 'straight double quote', '\'': 'straight apostrophe' };

const TEXT = new Set([
  '.md', '.markdown', '.txt', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.html', '.css',
  '.xml', '.svg', '.webmanifest', '.yml', '.yaml', '.toml', '.sh', '.py',
]);
// Extensionless files that are still text: the worker's routing tables, the licence, dotfiles.
const NO_EXTENSION = new Set(['LICENSE', 'LICENCE', '_redirects', '_headers', '.gitignore', '.gitattributes', '.editorconfig']);
// Markdown and plain-text files are the prose: every character in them is copy once code is stripped out.
const PROSE = new Set(['.md', '.markdown', '.txt']);

// Code must stay ASCII: fenced blocks, inline spans, link destinations and raw HTML tags are not prose, and a straight
// quote inside backticks is correct there. Replacing matches with spaces keeps line numbers and offsets intact, so a
// report still points at the right line.
const CODE = /```[\s\S]*?```|`[^`\n]*`|\]\([^)\n]*\)|<[^>\n]+>/g;
const withoutCode = src => src.replace(CODE, match => match.replace(/[^\n]/g, ' '));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => {
  if (!cond) throw new Error(detail === undefined ? 'assertion failed' : detail);
};

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

const ext = file => path.extname(file).toLowerCase();
const isText = file => (ext(file) ? TEXT.has(ext(file)) : NO_EXTENSION.has(path.basename(file)));
const isProse = file => PROSE.has(ext(file));

const excerpt = (line, at, width = 40) => line.slice(Math.max(0, at - width), at + width).replace(/\s+/g, ' ').trim();
const report = hits => hits.length
  ? [`${hits.length} to fix:`, ...hits.map(hit => '  ' + hit)].join('\n')
  : '';

function scan(files, wanted, read) {
  const hits = [];
  for (const file of files) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      for (const [needle, label] of wanted(line)) {
        const at = line.indexOf(needle);
        if (at !== -1) hits.push(`${file}:${index + 1}  ${label}  ...${excerpt(line, at)}...`);
      }
    });
  }
  return hits;
}

test('no em dash or en dash in hand-written text', () => {
  const files = trackedFiles().filter(file => !file.startsWith(VENDOR) && isText(file));
  const hits = scan(files, line => [[EM_DASH, 'em dash'], [EN_DASH, 'en dash']].filter(([needle]) => line.includes(needle)), f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  assert(!hits.length, [
    report(hits),
    '',
    'Use a colon, a semicolon, commas or parentheses, or start a new sentence.',
  ].join('\n'));
  return `${files.length} tracked text files`;
});

test('Markdown prose uses curly quotes and plain spaces', () => {
  const files = trackedFiles().filter(file => !file.startsWith(VENDOR) && isProse(file));
  assert(files.length >= 5, `only ${files.length} prose files were found, so this scan is not reading the docs`);
  const hits = scan(files, line => [
    ...Object.entries(STRAIGHT_QUOTES).filter(([needle]) => line.includes(needle)),
    ...Object.entries(INVISIBLE).filter(([needle]) => line.includes(needle)),
  ], f => withoutCode(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert(!hits.length, [
    report(hits),
    '',
    'Wrap a quoted label in typographic quotes (U+201C and U+201D), write an apostrophe as U+2019, and type a real space.',
    'Quotes inside code spans and fenced blocks are deliberately ignored.',
  ].join('\n'));
  return `${files.length} prose files`;
});

test('the prose scan covers the files it claims to', () => {
  const files = trackedFiles();
  const text = files.filter(file => !file.startsWith(VENDOR) && isText(file));
  assert(text.length >= 20, `only ${text.length} tracked text files were found, so this scan is not reading the repo`);
  for (const expected of ['README.md', 'CHANGELOG.md', 'MAINTENANCE.md', 'llms.txt', 'sw.js', 'index.html', 'functions/privacy.js', 'tests/README.md']) {
    assert(text.includes(expected), `${expected} was not scanned, so these tests are not covering the copy they claim to`);
  }
  assert(files.filter(isProse).length >= 5, 'the prose list lost files, so the quote test would pass by reading nothing');
  return 'README, changelog, maintenance note, llms.txt, worker, shell and privacy page are in scope';
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
