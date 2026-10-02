/* nbview: a fully client-side Jupyter notebook viewer for public GitHub repos.
 *
 * Routes (hash-based, so it works on any static host):
 *   #/                                         home
 *   #/github/{owner}                           list a user's or org's repos
 *   #/github/{owner}/{repo}                    resolve default branch, then browse
 *   #/github/{owner}/{repo}/tree/{ref}/{path}  browse a folder
 *   #/github/{owner}/{repo}/blob/{ref}/{path}  render a notebook
 *   #/url/{encoded url}                        render a notebook from any CORS-friendly URL
 */
(() => {
  'use strict';

  const API = 'https://api.github.com';
  const RAW = 'https://raw.githubusercontent.com';
  const app = document.getElementById('app');

  let routeId = 0;
  let katexMacros = {};
  let downloadUrl = null;

  /* ---------- small helpers ---------- */

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
  const enc = p => String(p).split('/').map(encodeURIComponent).join('/');
  const join = v => Array.isArray(v) ? v.join('') : (v == null ? '' : String(v));
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const stale = id => id !== routeId;
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  const isNbName = n => /\.ipynb$/i.test(n);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  class ViewError extends Error {
    constructor(title, detail, opts = {}) {
      super(title);
      this.title = title;
      this.detail = detail;
      this.opts = opts;
    }
  }

  const ICONS = {
    dir: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.1l1.6 1.8H13a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
    nb: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="none" stroke="currentColor"/><path d="M5 5h6M5 8h6M5 11h3.5" stroke="currentColor"/></svg>',
    file: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" stroke="currentColor"/></svg>',
    repo: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h8v11h-8A1.5 1.5 0 0 0 3 13.5zm0 11A1.5 1.5 0 0 0 4.5 15h8v-3" fill="none" stroke="currentColor"/></svg>',
    up: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  };

  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  /* ---------- URLs ---------- */

  function hashFor(owner, repo, kind, ref, path = '') {
    const seg = ['github', owner, repo, kind, ref]
      .filter(x => x != null && x !== '')
      .map(encodeURIComponent);
    let h = '#/' + seg.join('/');
    if (path) h += '/' + enc(path);
    else if (kind === 'tree') h += '/';
    return h;
  }

  // Turns whatever the user pastes into a route.
  function parseInput(input) {
    let s = input.trim();
    if (!s) return null;
    let m;

    if ((m = s.match(/^(?:https?:\/\/)?raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)(?:[?#].*)?$/i))) {
      return hashFor(m[1], m[2], 'blob', m[3], safeDecode(m[4]));
    }
    if ((m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i))) {
      s = m[1];
    } else if ((m = s.match(/^(?:https?:\/\/)?nbviewer\.(?:org|jupyter\.org)\/github\/(.+)$/i))) {
      s = m[1];
    } else if (/^https?:\/\//i.test(s)) {
      return '#/url/' + encodeURIComponent(s);
    }

    s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
    const p = s.split('/').filter(Boolean).map(safeDecode);
    if (p.length >= 2) p[1] = p[1].replace(/\.git$/i, '');
    if (p.length === 1) return hashFor(p[0]);
    if (p.length === 2) return hashFor(p[0], p[1]);
    if ((p[2] === 'tree' || p[2] === 'blob') && p[3]) {
      const path = p.slice(4).join('/');
      if (p[2] === 'blob' && isNbName(path)) return hashFor(p[0], p[1], 'blob', p[3], path);
      if (p[2] === 'blob') return hashFor(p[0], p[1], 'tree', p[3], path.split('/').slice(0, -1).join('/'));
      return hashFor(p[0], p[1], 'tree', p[3], path);
    }
    return hashFor(p[0], p[1]);
  }

  /* ---------- GitHub ---------- */

  async function gh(path) {
    const headers = { Accept: 'application/vnd.github+json' };
    const token = store.get('nbv.token');
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(API + path, { headers });
    } catch {
      throw new ViewError("Couldn't reach GitHub", 'The network request failed. Check your connection and try again.');
    }
    if (res.ok) return res.json();

    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const mins = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
      throw new ViewError(
        'GitHub rate limit reached',
        `Folder browsing is paused for about ${mins} min. Add a GitHub token to raise the limit, or paste a notebook link directly, since opening notebooks doesn't count.`,
        { token: true }
      );
    }
    if (res.status === 401) {
      throw new ViewError('Token rejected', "GitHub didn't accept the saved token. Update or remove it.", { token: true });
    }
    if (res.status === 404) {
      throw new ViewError('Not found', "That repo, branch or folder doesn't exist, or it's private. Only public repos can be viewed.");
    }
    throw new ViewError(`GitHub returned ${res.status}`, 'The request was refused. Try again in a moment.');
  }

  function crumbs(owner, repo, ref, path) {
    const parts = [
      `<a href="${hashFor(owner)}">${esc(owner)}</a>`,
      path
        ? `<a href="${hashFor(owner, repo, 'tree', ref, '')}">${esc(repo)}</a>`
        : `<span aria-current="page">${esc(repo)}</span>`,
    ];
    const segs = path ? path.split('/') : [];
    segs.forEach((s, i) => {
      const last = i === segs.length - 1;
      const p = segs.slice(0, i + 1).join('/');
      parts.push(last
        ? `<span aria-current="page">${esc(s)}</span>`
        : `<a href="${hashFor(owner, repo, 'tree', ref, p)}">${esc(s)}</a>`);
    });
    return parts.join('<span class="sep">/</span>') +
      `<span class="ref" title="Branch, tag or commit">${esc(ref)}</span>`;
  }

  function addRecent(entry) {
    const list = store.get('nbv.recent', []).filter(r => r.hash !== entry.hash);
    list.unshift(entry);
    store.set('nbv.recent', list.slice(0, 8));
  }

  /* ---------- views ---------- */

  function showLoading(msg) {
    app.innerHTML = `<div class="loading" role="status"><span class="prompt in">In [<span class="star">*</span>]:</span><span>${esc(msg)}</span></div>`;
  }

  function renderError(e) {
    const title = e.title || 'Something went wrong';
    const detail = e.detail || e.message || 'An unexpected error occurred.';
    app.innerHTML = `
      <div class="error-box" role="alert">
        <h2>${esc(title)}</h2>
        <p>${esc(detail)}</p>
        <div class="toolbar">
          ${e.opts && e.opts.token ? '<button class="btn primary" id="err-token" type="button">Add GitHub token</button>' : ''}
          <a class="btn" href="#/">Back to start</a>
        </div>
      </div>`;
    const b = document.getElementById('err-token');
    if (b) b.addEventListener('click', openSettings);
    if (!(e instanceof ViewError)) console.error(e);
  }

  function renderHome() {
    document.title = 'nbview';
    const recents = store.get('nbv.recent', []);
    app.innerHTML = `
      <div class="home">
        <h1 class="home-title">Read Jupyter notebooks from any public GitHub repo.</h1>
        <form class="hero-cell" id="hero-form">
          <span class="prompt in" id="hero-prompt">In [ ]:</span>
          <input id="hero-input" type="text" placeholder="karpathy/nn-zero-to-hero"
                 aria-label="Repo, link or notebook URL" autocomplete="off" spellcheck="false" autofocus>
          <button class="btn primary" type="submit">Open</button>
        </form>
        <p class="hint">Takes a username, <code>owner/repo</code>, any GitHub or nbviewer link, or a direct URL to an <code>.ipynb</code> file.
          Try <a href="#/github/jakevdp/PythonDataScienceHandbook">jakevdp/PythonDataScienceHandbook</a>.</p>
        <div class="drop" id="drop">
          Have the file already? Drop an .ipynb here or <label>choose one<input type="file" id="file-input" accept=".ipynb,application/json" hidden></label>.
        </div>
        ${recents.length ? `
          <section class="recent">
            <h2>Recently opened</h2>
            <ul class="listing">
              ${recents.map(r => `
                <li class="entry ${r.kind === 'nb' ? 'is-nb' : 'is-dir'}">
                  <a href="${esc(r.hash)}">${r.kind === 'nb' ? ICONS.nb : ICONS.repo}
                    <span class="stack"><span class="name">${esc(r.title)}</span>${r.sub ? `<span class="desc">${esc(r.sub)}</span>` : ''}</span>
                  </a><span class="size"></span>
                </li>`).join('')}
            </ul>
          </section>` : ''}
      </div>`;

    document.getElementById('hero-form').addEventListener('submit', e => {
      e.preventDefault();
      const ok = go(document.getElementById('hero-input').value);
      if (ok) document.getElementById('hero-prompt').innerHTML = 'In [<span class="star">*</span>]:';
    });
    document.getElementById('file-input').addEventListener('change', e => openLocal(e.target.files[0]));
  }

  async function viewUser(owner, id) {
    showLoading(`Loading repositories for ${owner}`);
    const repos = await gh(`/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`);
    if (stale(id)) return;
    document.title = `${owner} | nbview`;
    app.innerHTML = `
      <div class="page">
        <nav class="crumbs"><a href="#/">Home</a><span class="sep">/</span><span aria-current="page">${esc(owner)}</span></nav>
        <header class="page-head">
          <h1>${esc(owner)}</h1>
          <div class="toolbar"><a class="btn" href="https://github.com/${encodeURIComponent(owner)}" target="_blank" rel="noopener">View on GitHub</a></div>
          <p class="count">${repos.length === 100 ? 'The 100 most recently updated public repositories' : `${repos.length} public repositories`}</p>
        </header>
        ${repos.length ? `<ul class="listing">${repos.map(r => `
          <li class="entry is-dir">
            <a href="${hashFor(r.owner.login, r.name)}">${ICONS.repo}
              <span class="stack"><span class="name">${esc(r.name)}</span>${r.description ? `<span class="desc">${esc(r.description)}</span>` : ''}</span>
            </a>
            <span class="size">${r.language === 'Jupyter Notebook' ? '<span class="tag">notebooks</span>' : esc(r.language || '')}</span>
          </li>`).join('')}</ul>` : `<p class="empty">${esc(owner)} has no public repositories.</p>`}
      </div>`;
  }

  async function viewTree(owner, repo, ref, path, id) {
    showLoading('Loading files');
    const items = await gh(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${path ? '/' + enc(path) : ''}?ref=${encodeURIComponent(ref)}`
    );
    if (stale(id)) return;

    if (!Array.isArray(items)) {
      // The path is a single file, not a folder.
      const target = isNbName(path)
        ? hashFor(owner, repo, 'blob', ref, path)
        : hashFor(owner, repo, 'tree', ref, path.split('/').slice(0, -1).join('/'));
      location.replace(target);
      return;
    }

    items.sort((a, b) =>
      (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const nbCount = items.filter(it => it.type === 'file' && isNbName(it.name)).length;
    const onlyNb = store.get('nbv.onlyNb', false);
    const parent = path ? path.split('/').slice(0, -1).join('/') : null;
    document.title = `${path ? path.split('/').pop() : `${owner}/${repo}`} | nbview`;
    if (!path) addRecent({ kind: 'repo', hash: location.hash, title: `${owner}/${repo}`, sub: ref });

    const rows = items.map(it => {
      const isDir = it.type === 'dir';
      const isNb = it.type === 'file' && isNbName(it.name);
      const cls = isDir ? 'is-dir' : isNb ? 'is-nb' : 'is-file';
      const href = isDir ? hashFor(owner, repo, 'tree', ref, it.path)
        : isNb ? hashFor(owner, repo, 'blob', ref, it.path)
        : it.html_url;
      const ext = !isDir && !isNb ? ' target="_blank" rel="noopener"' : '';
      const icon = isDir ? ICONS.dir : isNb ? ICONS.nb : ICONS.file;
      return `<li class="entry ${cls}"><a href="${esc(href || '#')}"${ext}>${icon}<span class="name">${esc(it.name)}</span></a><span class="size">${isDir ? '' : fmtSize(it.size)}</span></li>`;
    }).join('');

    app.innerHTML = `
      <div class="page">
        <nav class="crumbs">${crumbs(owner, repo, ref, path)}</nav>
        <header class="page-head">
          <h1>${esc(path ? path.split('/').pop() : repo)}</h1>
          <div class="toolbar">
            <label class="check"><input type="checkbox" id="only-nb"${onlyNb ? ' checked' : ''}> Notebooks only</label>
            <a class="btn" href="https://github.com/${enc(owner)}/${enc(repo)}/tree/${enc(ref)}${path ? '/' + enc(path) : ''}" target="_blank" rel="noopener">View on GitHub</a>
          </div>
          <p class="count">${nbCount === 1 ? '1 notebook' : `${nbCount} notebooks`} in this folder</p>
        </header>
        <ul class="listing${onlyNb ? ' only-nb' : ''}" id="listing">
          ${parent !== null ? `<li class="entry is-dir"><a href="${hashFor(owner, repo, 'tree', ref, parent)}">${ICONS.up}<span class="name">..</span></a><span class="size"></span></li>` : ''}
          ${rows || '<li class="empty">This folder is empty.</li>'}
        </ul>
        <div id="readme"></div>
      </div>`;

    document.getElementById('only-nb').addEventListener('change', e => {
      store.set('nbv.onlyNb', e.target.checked);
      document.getElementById('listing').classList.toggle('only-nb', e.target.checked);
    });

    const readme = items.find(it => it.type === 'file' && /^readme(\.md|\.markdown)?$/i.test(it.name));
    if (readme && readme.download_url) {
      fetch(readme.download_url)
        .then(r => (r.ok ? r.text() : null))
        .then(md => {
          if (!md || stale(id)) return;
          const box = document.getElementById('readme');
          box.innerHTML = `<h2 class="readme-title">${esc(readme.name)}</h2><div class="prose"></div>`;
          katexMacros = {};
          renderMarkdown(box.lastElementChild, md, { owner, repo, ref, dir: path, rawBase: readme.download_url });
        })
        .catch(() => { /* README is optional */ });
    }
  }

  async function viewNotebook(src, id) {
    showLoading('Fetching notebook');
    const isGh = !src.url;
    const url = isGh
      ? `${RAW}/${enc(src.owner)}/${enc(src.repo)}/${enc(src.ref)}/${enc(src.path)}`
      : src.url;

    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new ViewError(
        "Couldn't load the file",
        isGh
          ? 'The network request failed. Check your connection and try again.'
          : "The site hosting this file doesn't let other pages read it (CORS). GitHub, GitLab raw and gist raw links work."
      );
    }
    if (!res.ok) {
      throw res.status === 404
        ? new ViewError('Notebook not found', 'Check the path and branch. Only public repos can be viewed.')
        : new ViewError(`Request failed (${res.status})`, 'The server refused the request. Try again in a moment.');
    }
    const text = await res.text();
    if (stale(id)) return;

    let nb;
    try { nb = JSON.parse(text); } catch {
      throw new ViewError('Not a readable notebook', "The file isn't valid JSON, so it can't be opened as .ipynb.");
    }

    const host = isGh ? null : new URL(url).host;
    const name = isGh ? src.path.split('/').pop() : (safeDecode(new URL(url).pathname.split('/').pop()) || 'notebook.ipynb');
    const ghPath = isGh ? `${enc(src.owner)}/${enc(src.repo)}/blob/${enc(src.ref)}/${enc(src.path)}` : null;
    const ctx = isGh
      ? { owner: src.owner, repo: src.repo, ref: src.ref, dir: src.path.split('/').slice(0, -1).join('/'), rawBase: url }
      : { rawBase: url };

    addRecent({ kind: 'nb', hash: location.hash, title: name, sub: isGh ? `${src.owner}/${src.repo}` : host });

    await showNotebook(nb, ctx, {
      name,
      text,
      crumbs: isGh
        ? crumbs(src.owner, src.repo, src.ref, src.path)
        : `<a href="#/">Home</a><span class="sep">/</span><span aria-current="page">${esc(host)}</span>`,
      github: isGh ? `https://github.com/${ghPath}` : null,
      colab: isGh ? `https://colab.research.google.com/github/${ghPath}` : null,
      source: isGh ? null : url,
    }, id);
  }

  function openLocal(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const id = ++routeId;
      document.body.classList.remove('is-home');
      try {
        let nb;
        try { nb = JSON.parse(reader.result); } catch {
          throw new ViewError('Not a readable notebook', `${file.name} isn't valid JSON, so it can't be opened as .ipynb.`);
        }
        await showNotebook(nb, {}, {
          name: file.name,
          text: reader.result,
          crumbs: '<a href="#/">Home</a><span class="sep">/</span><span aria-current="page">Local file</span>',
        }, id);
      } catch (e) {
        if (!stale(id)) renderError(e);
      }
    };
    reader.readAsText(file);
  }

  /* ---------- notebook rendering ---------- */

  function normalize(nb) {
    if (Array.isArray(nb.cells)) return { cells: nb.cells, meta: nb.metadata || {} };
    if (Array.isArray(nb.worksheets)) {
      // nbformat 3
      const cells = ((nb.worksheets[0] || {}).cells || []).map(c => {
        if (c.cell_type === 'code') {
          return { cell_type: 'code', source: c.input, execution_count: c.prompt_number, outputs: (c.outputs || []).map(v3Output) };
        }
        if (c.cell_type === 'heading') {
          return { cell_type: 'markdown', source: '#'.repeat(c.level || 1) + ' ' + join(c.source) };
        }
        return c;
      });
      return { cells, meta: nb.metadata || {} };
    }
    throw new ViewError('Unsupported notebook', 'No cells were found. nbformat 3 and 4 notebooks are supported.');
  }

  function v3Output(o) {
    const MIME = { png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml', html: 'text/html', latex: 'text/latex', text: 'text/plain', json: 'application/json' };
    if (o.output_type === 'pyout' || o.output_type === 'display_data') {
      const data = {};
      for (const [k, v] of Object.entries(o)) if (MIME[k]) data[MIME[k]] = v;
      return { output_type: o.output_type === 'pyout' ? 'execute_result' : 'display_data', data, execution_count: o.prompt_number, metadata: o.metadata || {} };
    }
    if (o.output_type === 'pyerr') return { output_type: 'error', ename: o.ename, evalue: o.evalue, traceback: o.traceback };
    if (o.output_type === 'stream') return { output_type: 'stream', name: o.stream || 'stdout', text: o.text };
    return o;
  }

  async function showNotebook(nb, ctx, info, id) {
    const { cells, meta } = normalize(nb);
    const li = meta.language_info || {};
    const ks = meta.kernelspec || {};
    const lang = String(li.name || ks.language || meta.language || 'python').toLowerCase();
    const kernel = ks.display_name || li.name || '';

    katexMacros = {};
    document.title = `${info.name} | nbview`;
    document.body.classList.remove('hide-code');

    app.innerHTML = `
      <article class="nb">
        <nav class="crumbs">${info.crumbs || ''}</nav>
        <header class="nb-head">
          <h1 class="nb-title">${esc(info.name)}</h1>
          <div class="toolbar">
            <button class="btn" id="toggle-code" type="button" aria-pressed="false">Hide code</button>
            <a class="btn" id="dl">Download</a>
            ${info.colab ? `<a class="btn" href="${esc(info.colab)}" target="_blank" rel="noopener">Open in Colab</a>` : ''}
            ${info.github ? `<a class="btn" href="${esc(info.github)}" target="_blank" rel="noopener">View on GitHub</a>` : ''}
            ${info.source ? `<a class="btn" href="${esc(info.source)}" target="_blank" rel="noopener">Source</a>` : ''}
          </div>
          <p class="nb-meta">${kernel ? `<span>${esc(kernel)}</span>` : ''}<span>${cells.length} cells</span></p>
        </header>
        <div class="cells" id="cells"></div>
      </article>`;

    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([info.text], { type: 'application/x-ipynb+json' }));
    const dl = document.getElementById('dl');
    dl.href = downloadUrl;
    dl.download = info.name;

    const toggle = document.getElementById('toggle-code');
    toggle.addEventListener('click', () => {
      const hidden = document.body.classList.toggle('hide-code');
      toggle.setAttribute('aria-pressed', String(hidden));
      toggle.textContent = hidden ? 'Show code' : 'Hide code';
    });

    // Render in batches so huge notebooks stay responsive.
    const host = document.getElementById('cells');
    for (let i = 0; i < cells.length; i++) {
      if (stale(id)) return;
      try {
        const el = renderCell(cells[i], ctx, lang);
        if (el) host.append(el);
      } catch (err) {
        console.error('Cell failed to render', i, err);
      }
      if (i % 20 === 19) await nextFrame();
    }
  }

  function makeRow(label, kind) {
    const row = document.createElement('div');
    row.className = 'row';
    const p = document.createElement('div');
    p.className = `prompt ${kind}`;
    p.textContent = label;
    if (!label) p.setAttribute('aria-hidden', 'true');
    const c = document.createElement('div');
    c.className = 'content';
    row.append(p, c);
    return row;
  }

  function renderCell(cell, ctx, lang) {
    const sec = document.createElement('section');
    sec.className = `cell cell-${cell.cell_type}`;

    if (cell.cell_type === 'markdown') {
      const row = makeRow('', '');
      row.lastChild.classList.add('prose');
      renderMarkdown(row.lastChild, join(cell.source), ctx, cell.attachments);
      sec.append(row);
      return sec;
    }

    if (cell.cell_type === 'code') {
      const ec = cell.execution_count;
      const input = makeRow(`In [${ec ?? ' '}]:`, 'in');
      input.classList.add('input');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'hljs';
      code.innerHTML = highlight(join(cell.source), lang);
      pre.append(code);
      input.lastChild.append(pre);
      sec.append(input);

      for (const out of mergeStreams(cell.outputs || [])) {
        const content = renderOutput(out, ctx);
        if (!content) continue;
        const label = out.output_type === 'execute_result' ? `Out[${out.execution_count ?? ec ?? ' '}]:` : '';
        const row = makeRow(label, 'out');
        row.classList.add('output-row');
        row.lastChild.append(content);
        sec.append(row);
      }
      return sec;
    }

    // raw cells
    const row = makeRow('', '');
    const pre = document.createElement('pre');
    pre.className = 'raw';
    pre.textContent = join(cell.source);
    row.lastChild.append(pre);
    sec.append(row);
    return sec;
  }

  function mergeStreams(outs) {
    const res = [];
    for (const o of outs) {
      const prev = res[res.length - 1];
      if (o.output_type === 'stream' && prev && prev.output_type === 'stream' && prev.name === o.name) {
        prev.text = join(prev.text) + join(o.text);
      } else {
        res.push(o.output_type === 'stream' ? { ...o } : o);
      }
    }
    return res;
  }

  // Keeps only the last \r segment of each line, which is how terminals show progress bars.
  const collapseCR = s => s.split('\n').map(l => {
    if (!l.includes('\r')) return l;
    return l.split('\r').filter(Boolean).pop() || '';
  }).join('\n');

  function renderOutput(out, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'output';

    if (out.output_type === 'stream') {
      const pre = document.createElement('pre');
      pre.className = 'stream' + (out.name === 'stderr' ? ' stderr' : '');
      pre.innerHTML = ansiToHtml(collapseCR(join(out.text)));
      wrap.append(pre);
      return wrap;
    }

    if (out.output_type === 'error') {
      const pre = document.createElement('pre');
      pre.className = 'error';
      const tb = out.traceback && out.traceback.length ? out.traceback.join('\n') : `${out.ename}: ${out.evalue}`;
      pre.innerHTML = ansiToHtml(tb);
      wrap.append(pre);
      return wrap;
    }

    if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
      return renderMime(wrap, out.data || {}, out.metadata || {}, ctx) ? wrap : null;
    }
    return null;
  }

  const MIME_ORDER = [
    'text/html', 'image/svg+xml', 'image/png', 'image/jpeg', 'image/gif',
    'text/markdown', 'text/latex', 'application/json', 'text/plain',
  ];

  function renderMime(wrap, data, meta, ctx) {
    let skippedScript = false;

    for (const type of MIME_ORDER) {
      if (!(type in data)) continue;
      const raw = data[type];
      const v = type === 'application/json' ? raw : join(raw);

      if (type === 'text/html') {
        const clean = DOMPurify.sanitize(v);
        const probe = document.createElement('div');
        probe.innerHTML = clean;
        const visible = probe.textContent.trim() || probe.querySelector('img,svg,table,video,canvas');
        if (!visible) {
          // Typically Plotly/Bokeh/widget output that only works with JavaScript.
          skippedScript = /<script/i.test(v);
          continue;
        }
        const d = document.createElement('div');
        d.className = 'html-out';
        d.innerHTML = clean;
        d.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
        wrap.append(d);
        return true;
      }

      if (type.startsWith('image/')) {
        const img = new Image();
        img.alt = 'Cell output';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = type === 'image/svg+xml'
          ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(v)
          : `data:${type};base64,${v.replace(/\s/g, '')}`;
        const m = meta[type] || meta;
        if (m && m.width) img.width = m.width;
        if (m && m.height) img.height = m.height;
        wrap.append(img);
        return true;
      }

      if (type === 'text/markdown') {
        const d = document.createElement('div');
        d.className = 'prose';
        renderMarkdown(d, v, ctx);
        wrap.append(d);
        return true;
      }

      if (type === 'text/latex') {
        const d = document.createElement('div');
        d.textContent = v;
        typeset(d);
        wrap.append(d);
        return true;
      }

      const pre = document.createElement('pre');
      pre.innerHTML = type === 'application/json' ? esc(JSON.stringify(v, null, 2)) : ansiToHtml(v);
      wrap.append(pre);
      if (skippedScript) wrap.append(scriptNote());
      return true;
    }

    if (skippedScript) {
      wrap.append(scriptNote());
      return true;
    }
    return false;
  }

  function scriptNote() {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = 'Interactive output that needs JavaScript is not run here. Open in Colab to see it.';
    return n;
  }

  /* ---------- markdown + math ---------- */

  function highlight(code, lang) {
    if (window.hljs && lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fall through */ }
    }
    return esc(code);
  }

  if (window.marked) {
    marked.setOptions({
      gfm: true,
      headerIds: true,
      mangle: false,
      langPrefix: 'hljs language-',
      highlight: (code, lang) => highlight(code, (lang || '').toLowerCase()),
    });
  }

  const CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
  const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\begin\{([a-zA-Z*]+)\}[\s\S]+?\\end\{\1\}|(?<!\\)\$(?=\S)(?:\\\$|[^$\n])+?(?<=\S)\$/g;

  // Pulls math out before markdown parsing so underscores and asterisks inside it survive.
  function protectMath(src) {
    const code = [];
    const math = [];
    let s = src.replace(CODE_RE, m => `XCODEX${code.push(m) - 1}X`);
    s = s.replace(MATH_RE, m => `XMATHX${math.push(m) - 1}X`);
    s = s.replace(/XCODEX(\d+)X/g, (_, i) => code[+i]);
    return { text: s, math };
  }

  function renderMarkdown(el, src, ctx = {}, attachments) {
    if (attachments) {
      src = src.replace(/attachment:([^\s)"'>]+)/g, (m, name) => {
        const a = attachments[name] || attachments[safeDecode(name)];
        if (!a) return m;
        const [type, b64] = Object.entries(a)[0] || [];
        return type ? `data:${type};base64,${join(b64).replace(/\s/g, '')}` : m;
      });
    }
    const { text, math } = protectMath(src);
    let html = marked.parse(text);
    html = html.replace(/XMATHX(\d+)X/g, (_, i) => esc(math[+i]));
    el.innerHTML = DOMPurify.sanitize(html);
    fixLinks(el, ctx);
    typeset(el);
  }

  function typeset(el) {
    if (!window.renderMathInElement) return;
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
        { left: '\\begin{equation}', right: '\\end{equation}', display: true },
        { left: '\\begin{equation*}', right: '\\end{equation*}', display: true },
        { left: '\\begin{align}', right: '\\end{align}', display: true },
        { left: '\\begin{align*}', right: '\\end{align*}', display: true },
        { left: '\\begin{gather}', right: '\\end{gather}', display: true },
        { left: '\\begin{gather*}', right: '\\end{gather*}', display: true },
      ],
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      throwOnError: false,
      macros: katexMacros,
      globalGroup: true,
    });
  }

  const slug = s => s.toLowerCase().replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

  function jumpTo(id) {
    let t = document.getElementById(id);
    if (!t) {
      const want = id.toLowerCase();
      t = [...app.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h => {
        const txt = h.textContent.trim();
        return txt.replace(/\s+/g, '-').toLowerCase() === want || slug(txt) === want;
      });
    }
    if (t) t.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  // Makes relative images and links in markdown point at the right place.
  function fixLinks(el, ctx) {
    el.querySelectorAll('img[src]').forEach(img => {
      const src = img.getAttribute('src');
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src) || !ctx.rawBase) return;
      try { img.src = new URL(src, ctx.rawBase).href; } catch { /* leave as is */ }
    });

    el.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        a.addEventListener('click', e => { e.preventDefault(); jumpTo(safeDecode(href.slice(1))); });
        return;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener';
        return;
      }
      if (ctx.owner) {
        const u = new URL(href, `https://repo.invalid/${ctx.dir ? enc(ctx.dir) + '/' : ''}`);
        const path = safeDecode(u.pathname.replace(/^\//, ''));
        if (isNbName(path)) {
          a.href = hashFor(ctx.owner, ctx.repo, 'blob', ctx.ref, path);
        } else {
          a.href = `https://github.com/${enc(ctx.owner)}/${enc(ctx.repo)}/blob/${enc(ctx.ref)}/${enc(path)}${u.hash}`;
          a.target = '_blank';
          a.rel = 'noopener';
        }
      } else if (ctx.rawBase) {
        try { a.href = new URL(href, ctx.rawBase).href; } catch { /* leave as is */ }
        a.target = '_blank';
        a.rel = 'noopener';
      }
    });
  }

  /* ---------- ANSI colors (tracebacks, colored logs) ---------- */

  function ansiToHtml(str) {
    const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
    const re = /\x1b\[([0-9;]*)([A-Za-z])/g;
    let fg = null, bg = null, bold = false, out = '', last = 0, m;

    const push = t => {
      if (!t) return;
      const st = [];
      if (fg) st.push(`color:var(--a-${fg})`);
      if (bg) st.push(`background:color-mix(in srgb,var(--a-${bg}) 28%,transparent)`);
      if (bold) st.push('font-weight:700');
      out += st.length ? `<span style="${st.join(';')}">${esc(t)}</span>` : esc(t);
    };

    while ((m = re.exec(str))) {
      push(str.slice(last, m.index));
      last = re.lastIndex;
      if (m[2] !== 'm') continue;
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { fg = bg = null; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c >= 30 && c <= 37) fg = NAMES[c - 30];
        else if (c >= 90 && c <= 97) fg = NAMES[c - 90];
        else if (c === 39) fg = null;
        else if (c >= 40 && c <= 47) bg = NAMES[c - 40];
        else if (c >= 100 && c <= 107) bg = NAMES[c - 100];
        else if (c === 49) bg = null;
        else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      }
    }
    push(str.slice(last));
    return out;
  }

  /* ---------- router ---------- */

  async function route() {
    const id = ++routeId;
    const raw = location.hash.replace(/^#/, '');
    const parts = raw.split('/').filter(Boolean).map(safeDecode);
    document.body.classList.toggle('is-home', parts.length === 0);
    window.scrollTo(0, 0);

    if (!window.marked || !window.DOMPurify) {
      renderError(new ViewError("Couldn't load the rendering libraries", 'A script from cdnjs failed to load. Check your connection or any content blockers, then reload.'));
      return;
    }

    try {
      if (!parts.length) return renderHome();

      if (parts[0] === 'url' && parts[1]) {
        return await viewNotebook({ url: parts.slice(1).join('/') }, id);
      }

      if (parts[0] === 'github' && parts[1]) {
        const [, owner, repo, kind, ref, ...rest] = parts;
        const path = rest.join('/');
        if (!repo) return await viewUser(owner, id);
        if (!kind || !ref) {
          showLoading('Finding the default branch');
          const info = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
          if (!stale(id)) location.replace(hashFor(owner, repo, 'tree', info.default_branch, ''));
          return;
        }
        if (kind === 'tree') return await viewTree(owner, repo, ref, path, id);
        if (kind === 'blob') return await viewNotebook({ owner, repo, ref, path }, id);
      }

      throw new ViewError('Unknown address', 'Paste a repo or notebook link into the box at the top.');
    } catch (e) {
      if (!stale(id)) renderError(e);
    }
  }

  function go(input) {
    const h = parseInput(input);
    if (!h) return false;
    if (h === location.hash) route();
    else location.hash = h;
    return true;
  }

  /* ---------- global wiring ---------- */

  document.getElementById('jump').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('jump-input');
    if (go(input.value)) input.value = '';
    input.blur();
  });

  // Clicking a link to the current route (e.g. Home from a local file) should still re-render.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const href = a.getAttribute('href');
    if (href === location.hash || (href === '#/' && location.hash === '')) {
      e.preventDefault();
      route();
    }
  });

  // Drag and drop a local notebook onto the home page.
  document.addEventListener('dragover', e => {
    if (!document.body.classList.contains('is-home')) return;
    e.preventDefault();
    const d = document.getElementById('drop');
    if (d) d.classList.add('over');
  });
  document.addEventListener('dragleave', e => {
    if (e.relatedTarget) return;
    const d = document.getElementById('drop');
    if (d) d.classList.remove('over');
  });
  document.addEventListener('drop', e => {
    if (!document.body.classList.contains('is-home')) return;
    e.preventDefault();
    openLocal(e.dataTransfer.files[0]);
  });

  // Settings: GitHub token
  const dlg = document.getElementById('settings');
  const tokInput = document.getElementById('token-input');

  function openSettings() {
    tokInput.value = store.get('nbv.token') || '';
    dlg.showModal();
    tokInput.focus();
  }

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  tokInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); dlg.close('save'); }
  });
  dlg.addEventListener('close', () => {
    const v = dlg.returnValue;
    if (v === 'save') {
      const t = tokInput.value.trim();
      if (t) store.set('nbv.token', t); else store.del('nbv.token');
    } else if (v === 'clear') {
      store.del('nbv.token');
    } else {
      return;
    }
    if (app.querySelector('.error-box')) route();
  });
  // Theme toggle: follows the system until the user picks one, then remembers it.
  const themeBtn = document.getElementById('theme-btn');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () =>
    document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  function syncThemeBtn() {
    const t = currentTheme();
    const label = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.dataset.current = t;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }

  themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('nbv.theme', next);
    syncThemeBtn();
  });
  systemDark.addEventListener('change', syncThemeBtn);
  syncThemeBtn();
  window.addEventListener('hashchange', route);
  route();
})();