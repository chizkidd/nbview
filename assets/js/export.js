/* Export helpers: turn a notebook into a Python script, Markdown, or a standalone HTML page.
   Pure functions on the notebook's cells; app.js handles buttons and downloads. */
(function () {
  'use strict';

  const join = s => (Array.isArray(s) ? s.join('') : typeof s === 'string' ? s : '');
  const oneLine = s => String(s).replace(/[\r\n]+/g, ' ');
  const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const collapseCR = s => s.split('\n').map(l => (l.includes('\r') ? l.split('\r').filter(Boolean).pop() || '' : l)).join('\n');
  const MAX_IMG = 2 * 1024 * 1024;

  // A code fence longer than any run of backticks inside the text.
  function fence(text, info) {
    let n = 3;
    for (const m of text.matchAll(/`+/g)) n = Math.max(n, m[0].length + 1);
    const f = '`'.repeat(n);
    return f + (info || '') + '\n' + text.replace(/\n+$/, '') + '\n' + f;
  }

  // IPython magics and shell escapes are not valid Python, so they become comments.
  function toPython(cells, name) {
    const out = ['# Exported from nbview: ' + oneLine(name), '# https://nbview.org', ''];
    const comment = text => text.replace(/\n+$/, '').split('\n').map(l => (l ? '# ' + l : '#'));
    for (const c of cells) {
      if (!c || typeof c !== 'object') continue;
      const src = join(c.source);
      if (c.cell_type === 'code') {
        out.push('# In[' + (c.execution_count == null ? ' ' : c.execution_count) + ']:', '');
        const lines = src.replace(/\n+$/, '').split('\n');
        const cellMagic = /^\s*%%/.test(lines[0]);
        for (const l of lines) out.push(cellMagic || /^\s*[%!]/.test(l) ? (l ? '# ' + l : '#') : l);
      } else if (src.trim()) {
        out.push(...comment(src));
      } else continue;
      out.push('', '');
    }
    return out.join('\n').replace(/\n+$/, '') + '\n';
  }

  const B64 = /^[A-Za-z0-9+/=]+$/;
  function imageLink(alt, mime, data) {
    const b64 = join(data).replace(/\s+/g, '');
    if (!B64.test(b64)) return '';
    if (b64.length > MAX_IMG) return '*(image omitted: too large)*';
    return `![${alt}](data:${mime};base64,${b64})`;
  }

  function outputToMarkdown(o) {
    if (o.output_type === 'stream') {
      const t = collapseCR(stripAnsi(join(o.text)));
      return t.trim() ? fence(t, 'text') : '';
    }
    if (o.output_type === 'error') {
      const tb = Array.isArray(o.traceback) && o.traceback.length ? join(o.traceback.map(x => String(x) + '\n')) : `${o.ename || 'Error'}: ${o.evalue || ''}`;
      return fence(stripAnsi(tb), 'text');
    }
    const d = o.data;
    if (!d || typeof d !== 'object') return '';
    for (const mime of ['image/png', 'image/jpeg']) {
      if (d[mime]) { const link = imageLink('output', mime, d[mime]); if (link) return link; }
    }
    if (d['text/plain']) return fence(stripAnsi(join(d['text/plain'])), 'text');
    if (d['text/html'] || d['image/svg+xml']) return '*(rich output omitted)*';
    return '';
  }

  function toMarkdown(cells, lang) {
    const info = /^[a-z0-9+#_-]{1,20}$/i.test(lang || '') ? lang : '';
    const parts = [];
    for (const c of cells) {
      if (!c || typeof c !== 'object') continue;
      const src = join(c.source);
      if (c.cell_type === 'markdown') {
        let text = src.trim();
        if (c.attachments && typeof c.attachments === 'object') {
          text = text.replace(/\(attachment:([^)\s]+)\)/g, (m, nm) => {
            const a = c.attachments[nm];
            const mime = a && Object.keys(a).find(k => /^image\/(png|jpeg|gif)$/.test(k));
            const link = mime ? imageLink('', mime, a[mime]) : '';
            return link ? link.slice(link.indexOf('(')) : m;
          });
        }
        if (text) parts.push(text);
      } else if (c.cell_type === 'code') {
        if (src.trim()) parts.push(fence(src, info));
        const outs = (Array.isArray(c.outputs) ? c.outputs : []).filter(o => o && typeof o === 'object');
        const merged = [];
        for (const o of outs) {
          const prev = merged[merged.length - 1];
          if (o.output_type === 'stream' && prev && prev.output_type === 'stream' && prev.name === o.name) prev.text = join(prev.text) + join(o.text);
          else merged.push(o.output_type === 'stream' ? { ...o } : o);
        }
        for (const o of merged) { const md = outputToMarkdown(o); if (md) parts.push(md); }
      } else if (src.trim()) {
        parts.push(fence(src, ''));
      }
    }
    return parts.join('\n\n') + '\n';
  }

  const escHtml = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // One self-contained page: the already-sanitized cells plus the site's styles. A strict CSP in the page
  // blocks scripts, so the file stays inert even if it is edited or re-hosted.
  function toHtml(o) {
    const css = String(o.css || '').replace(/<\/style/gi, '<\\/style');
    const fonts = escHtml(o.origin || '');
    return '<!doctype html>\n<html lang="en" data-theme="light">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${fonts} data:; img-src * data:">\n` +
      `<title>${escHtml(o.name)}</title>\n<style>\n${css}\nbody { display: block; }\n</style>\n</head>\n` +
      `<body class="${escHtml(o.bodyClass || '')}">\n<main>\n<article class="nb">\n<h1 class="nb-title">${escHtml(o.name)}</h1>\n` +
      `<p class="nb-meta"><span>Exported from nbview.org</span></p>\n<div class="cells">\n${o.cellsHtml}\n</div>\n</article>\n</main>\n</body>\n</html>\n`;
  }

  window.nbvExport = { toPython, toMarkdown, toHtml };
})();
