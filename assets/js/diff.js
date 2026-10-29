/* Notebook diff engine: pure functions, no DOM. Used by the Compare view and by the tests.
   diffLines(a, b)          -> [{ t: 'eq' | 'del' | 'add', text }]
   diffCells(aCells, bCells) -> [{ kind: 'same' | 'added' | 'removed' | 'modified', a, b, ai, bi, lines, outA, outB }] */
(function (root) {
  'use strict';

  const MAX_DP = 4000000; // cells in a diff table; bigger inputs fall back to "replace everything"

  const join = s => (Array.isArray(s) ? s.join('') : typeof s === 'string' ? s : '');
  const norm = s => join(s).replace(/\r\n?/g, '\n');
  const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  // Longest common subsequence over two arrays of comparable keys; returns matched index pairs.
  function lcs(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m) return [];
    if ((n + 1) * (m + 1) > MAX_DP) return null;
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  // Longest increasing subsequence of `seq` (values), returned as indices into `seq`.
  function lis(seq) {
    const tails = [], prev = new Array(seq.length).fill(-1);
    for (let k = 0; k < seq.length; k++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tails[mid]] < seq[k]) lo = mid + 1; else hi = mid; }
      if (lo > 0) prev[k] = tails[lo - 1];
      tails[lo] = k;
    }
    const out = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(k);
    return out.reverse();
  }

  // Patience-style alignment: trim the common start and end, anchor on items that occur exactly once on each
  // side, then align what lies between the anchors (small gaps with the exact LCS). Stays fast and sensible
  // on thousands of cells where a plain LCS table would be too big.
  function alignRange(a, as, ae, b, bs, be, out) {
    while (as < ae && bs < be && a[as] === b[bs]) { out.push([as, bs]); as++; bs++; }
    const tail = [];
    while (as < ae && bs < be && a[ae - 1] === b[be - 1]) { ae--; be--; tail.push([ae, be]); }
    if (as < ae && bs < be) {
      const countA = new Map(), posB = new Map();
      for (let i = as; i < ae; i++) countA.set(a[i], (countA.get(a[i]) || 0) + 1);
      for (let j = bs; j < be; j++) posB.set(b[j], posB.has(b[j]) ? -1 : j);
      const anchors = [];
      for (let i = as; i < ae; i++) {
        const j = posB.get(a[i]);
        if (countA.get(a[i]) === 1 && j !== undefined && j >= 0) anchors.push([i, j]);
      }
      if (anchors.length) {
        let ci = as, cj = bs;
        for (const k of lis(anchors.map(x => x[1]))) {
          const [i, j] = anchors[k];
          alignRange(a, ci, i, b, cj, j, out);
          out.push([i, j]);
          ci = i + 1; cj = j + 1;
        }
        alignRange(a, ci, ae, b, cj, be, out);
      } else {
        const mid = lcs(a.slice(as, ae), b.slice(bs, be));
        if (mid) for (const [i, j] of mid) out.push([as + i, bs + j]);
      }
    }
    for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]);
  }

  function align(a, b) {
    const out = [];
    alignRange(a, 0, a.length, b, 0, b.length, out);
    return out;
  }

  const TOKEN = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;
  const MAX_WORD_LINE = 4000;  // characters per line for the word-level diff
  const MAX_WORD_PAIRS = 300;  // paired lines per cell
  const WORD_SIMILAR = 0.4;

  // Which parts of two similar lines differ: segments for the old line and for the new line, as [{ t: 'eq' | 'chg', text }].
  function diffWords(a, b) {
    const x = a.match(TOKEN) || [], y = b.match(TOKEN) || [];
    const pairs = align(x, y);
    const inX = new Set(pairs.map(p => p[0])), inY = new Set(pairs.map(p => p[1]));
    const runs = (tokens, kept) => {
      const out = [];
      tokens.forEach((tok, i) => {
        const t = kept.has(i) ? 'eq' : 'chg';
        if (out.length && out[out.length - 1].t === t) out[out.length - 1].text += tok;
        else out.push({ t, text: tok });
      });
      return out;
    };
    let shared = 0;
    for (const [i] of pairs) shared += x[i].length;
    return { old: runs(x, inX), new: runs(y, inY), ratio: shared / Math.max(a.length, b.length, 1) };
  }

  // Marks changed words on removed/added lines that sit next to each other and are mostly alike.
  function markWords(lines) {
    let budget = MAX_WORD_PAIRS;
    for (let i = 0; i < lines.length && budget > 0;) {
      if (lines[i].t !== 'del') { i++; continue; }
      const dels = [], adds = [];
      while (i < lines.length && lines[i].t === 'del') dels.push(lines[i++]);
      while (i < lines.length && lines[i].t === 'add') adds.push(lines[i++]);
      for (let k = 0; k < Math.min(dels.length, adds.length) && budget > 0; k++, budget--) {
        const d = dels[k], a = adds[k];
        if (d.text.length > MAX_WORD_LINE || a.text.length > MAX_WORD_LINE) continue;
        const w = diffWords(d.text, a.text);
        if (w.ratio >= WORD_SIMILAR && w.ratio < 1) { d.parts = w.old; a.parts = w.new; }
      }
    }
    return lines;
  }

  function diffLines(a, b) {
    const x = norm(a) === '' ? [] : norm(a).split('\n');
    const y = norm(b) === '' ? [] : norm(b).split('\n');
    const out = [];
    let ai = 0, bi = 0;
    for (const [i, j] of align(x, y)) {
      while (ai < i) out.push({ t: 'del', text: x[ai++] });
      while (bi < j) out.push({ t: 'add', text: y[bi++] });
      out.push({ t: 'eq', text: x[i] });
      ai = i + 1; bi = j + 1;
    }
    while (ai < x.length) out.push({ t: 'del', text: x[ai++] });
    while (bi < y.length) out.push({ t: 'add', text: y[bi++] });
    return markWords(out);
  }

  // 0 to 1: how alike two cell sources are (shared lines, or shared start and end for one-liners).
  function similarity(a, b) {
    if (a === b) return 1;
    const la = a.split('\n').map(s => s.trim()), lb = b.split('\n').map(s => s.trim());
    const counts = new Map();
    for (const l of la) counts.set(l, (counts.get(l) || 0) + 1);
    let common = 0;
    for (const l of lb) { const c = counts.get(l); if (c) { common++; counts.set(l, c - 1); } }
    const dice = (2 * common) / (la.length + lb.length);
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const edge = (p + s) / Math.max(a.length, b.length, 1);
    return Math.max(dice, edge);
  }

  const SIMILAR = 0.4;
  const MAX_PAIR_WORK = 40000; // removed x added cells in one gap

  // Pairs removed and added cells of one gap into "modified" cells, keeping their order.
  function pairGap(removed, added) {
    const pairOf = new Array(removed.length).fill(-1);
    const taken = new Set();
    if (removed.length * added.length <= MAX_PAIR_WORK) {
      let from = 0;
      for (let i = 0; i < removed.length; i++) {
        let best = -1, bestSim = SIMILAR;
        for (let j = from; j < added.length; j++) {
          if (removed[i].type !== added[j].type) continue;
          const s = similarity(removed[i].text, added[j].text);
          if (s > bestSim) { best = j; bestSim = s; }
        }
        if (best >= 0) { pairOf[i] = best; taken.add(best); from = best + 1; }
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < removed.length || j < added.length) {
      if (i < removed.length && pairOf[i] < 0) { out.push({ kind: 'removed', a: removed[i] }); i++; }
      else if (j < added.length && !taken.has(j)) { out.push({ kind: 'added', b: added[j] }); j++; }
      else if (i < removed.length && j === pairOf[i]) { out.push({ kind: 'modified', a: removed[i], b: added[j] }); i++; j++; }
      else if (j < added.length) { out.push({ kind: 'added', b: added[j] }); j++; }
      else { out.push({ kind: 'removed', a: removed[i] }); i++; }
    }
    return out;
  }

  // The text of a code cell's outputs, for the optional output comparison. Images count as one marker.
  function outputText(cell) {
    const outs = cell && Array.isArray(cell.outputs) ? cell.outputs : [];
    const parts = [];
    for (const o of outs) {
      if (!o || typeof o !== 'object') continue;
      if (o.output_type === 'stream') parts.push(stripAnsi(norm(o.text)).replace(/[^\n]*\r/g, ''));
      else if (o.output_type === 'error') parts.push(stripAnsi(Array.isArray(o.traceback) && o.traceback.length ? o.traceback.join('\n') : `${o.ename || 'Error'}: ${o.evalue || ''}`));
      else if (o.data && typeof o.data === 'object') {
        if (o.data['text/plain'] != null) parts.push(stripAnsi(norm(o.data['text/plain'])));
        else parts.push('[' + (Object.keys(o.data)[0] || 'output') + ']');
      }
    }
    return parts.join('\n').replace(/\n+$/, '');
  }

  function describe(cell, index) {
    const type = cell && typeof cell === 'object' && typeof cell.cell_type === 'string' ? cell.cell_type : 'raw';
    return { index, type, text: norm(cell && cell.source), outputs: type === 'code' ? outputText(cell) : '' };
  }

  function diffCells(aCells, bCells) {
    const A = aCells.map(describe), B = bCells.map(describe);
    const keys = list => list.map(c => c.type + '\u0000' + c.text);
    const pairs = align(keys(A), keys(B));
    const out = [];
    let ai = 0, bi = 0;
    const flush = (toA, toB) => {
      const removed = A.slice(ai, toA), added = B.slice(bi, toB);
      if (removed.length || added.length) out.push(...pairGap(removed, added));
      ai = toA; bi = toB;
    };
    for (const [i, j] of pairs) {
      flush(i, j);
      out.push({ kind: 'same', a: A[i], b: B[j] });
      ai = i + 1; bi = j + 1;
    }
    flush(A.length, B.length);
    for (const e of out) {
      if (e.kind === 'modified') e.lines = diffLines(e.a.text, e.b.text);
      if (e.a && e.b) e.outputsChanged = e.a.outputs !== e.b.outputs;
      if (e.outputsChanged) e.outputLines = diffLines(e.a.outputs, e.b.outputs);
    }
    return out;
  }

  function summarize(entries) {
    const s = { added: 0, removed: 0, modified: 0, same: 0, outputsChanged: 0 };
    for (const e of entries) { s[e.kind]++; if (e.outputsChanged) s.outputsChanged++; }
    return s;
  }

  const api = { diffLines, diffWords, diffCells, summarize, outputText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.nbvDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
