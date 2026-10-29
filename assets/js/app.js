/* nbview: a fully client-side Jupyter notebook viewer for public GitHub repos.
 *
 * Routes (hash-based, so it works on any static host):
 *   #/                                         home
 *   #/github/{owner}                           list a user's or org's repos
 *   #/github/{owner}/{repo}                    resolve default branch, then browse
 *   #/github/{owner}/{repo}/tree/{ref}/{path}  browse a folder
 *   #/github/{owner}/{repo}/blob/{ref}/{path}  render a notebook
 *   #/gist/{id}                               open the first notebook in a gist
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
  let current = null; // the notebook on screen: { name, cells, lang, rendered } for exports

  const pref = {
    get(k) { try { return localStorage.getItem('nbv.' + k) === '1'; } catch { return false; } },
    set(k, v) { try { localStorage.setItem('nbv.' + k, v ? '1' : '0'); } catch { /* storage unavailable */ } },
  };
  const BIG_NB = 10 * 1024 * 1024;
  const bigOk = new Set();

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

  // nbviewer writes /url/host/path (http) and /urls/host/path (https) with no scheme.
  function nbviewerUrl(kind, rest) {
    rest = rest.trim();
    if (/^https?:\/+/i.test(rest)) return rest.replace(/^(https?:)\/+/i, '$1//');
    // Another scheme (data:, javascript:, file:) stays as written so it is refused, not turned into a host name.
    if (/^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(rest)) return rest;
    return (kind.toLowerCase() === 'urls' ? 'https://' : 'http://') + rest;
  }

  // Turns whatever the user pastes into a route.
  function parseInput(input) {
    let s = input.trim();
    if (!s) return null;
    let m;

    if ((m = s.match(/^(?:https?:\/\/)?raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)(?:[?#].*)?$/i))) {
      return hashFor(m[1], m[2], 'blob', m[3], safeDecode(m[4]));
    }
    if ((m = s.match(/^(?:https?:\/\/)?gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]+)(?:[/?#].*)?$/i))) {
      return '#/gist/' + m[1];
    }
    if ((m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i))) {
      s = m[1];
    } else if ((m = s.match(/^(?:https?:\/\/)?nbviewer\.(?:org|jupyter\.org)\/github\/(.+)$/i))) {
      s = m[1];
    } else if ((m = s.match(/^(?:https?:\/\/)?colab\.research\.google\.com\/github\/(.+)$/i))) {
      s = m[1];
    } else if ((m = s.match(/^git@github\.com:(.+)$/i))) {
      s = m[1];
    } else if (/^(?:https?:\/\/)?(?:www\.)?github\.com\/?(?:[?#].*)?$/i.test(s)) {
      return null;
    } else if ((m = s.match(/^(?:https?:\/\/)?nbviewer\.(?:org|jupyter\.org)\/gist\/(?:[^/]+\/)?([0-9a-f]+)(?:[/?#].*)?$/i))) {
      return '#/gist/' + m[1];
    } else if ((m = s.match(/^(?:https?:\/\/)?nbviewer\.(?:org|jupyter\.org)\/(urls?)\/(.+)$/i))) {
      return '#/url/' + encodeURIComponent(nbviewerUrl(m[1], m[2]));
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

  const CACHE_MS = 5 * 60 * 1000;
  const TOKEN_OK = /^[\x21-\x7e]+$/;

  function cacheGet(path) {
    try {
      const v = JSON.parse(sessionStorage.getItem('nbv.c:' + path));
      return v && Date.now() - v.t < CACHE_MS ? v.d : null;
    } catch { return null; }
  }

  function cacheSet(path, d) {
    try { sessionStorage.setItem('nbv.c:' + path, JSON.stringify({ t: Date.now(), d })); } catch { /* storage full or unavailable */ }
  }

  async function gh(path) {
    const cached = cacheGet(path);
    if (cached) return cached;
    const headers = { Accept: 'application/vnd.github+json' };
    const token = store.get('nbv.token');
    if (token && !TOKEN_OK.test(String(token))) {
      throw new ViewError('The saved GitHub token looks wrong', 'It contains a character a token cannot have, often an invisible space picked up when copying. Enter it again.', { token: true });
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(API + path, { headers, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw e && e.name === 'TimeoutError'
        ? new ViewError('GitHub took too long to answer', 'Try again in a moment.')
        : new ViewError("Couldn't reach GitHub", 'The network request failed. Check your connection and try again.');
    }
    if (res.ok) {
      const data = await res.json();
      cacheSet(path, data);
      return data;
    }

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

  // Recents live in localStorage, which anything on this origin can edit, so every read is checked.
  const MAX_RECENT_HASH = 2000;
  const MAX_TOC = 500; // entries in the Contents menu
  const clip = (v, n) => { const t = String(v == null ? '' : v); return t.length > n ? t.slice(0, n - 3) + '...' : t; };

  function getRecents() {
    const list = store.get('nbv.recent', []);
    if (!Array.isArray(list)) return [];
    return list
      .filter(r => r && typeof r === 'object' && typeof r.hash === 'string' && r.hash.startsWith('#/') && r.hash.length <= MAX_RECENT_HASH && typeof r.title === 'string')
      .map(r => ({ kind: r.kind === 'nb' ? 'nb' : 'repo', hash: r.hash, title: clip(r.title, 120), sub: clip(r.sub, 120) }))
      .slice(0, 8);
  }

  function addRecent(entry) {
    if (entry.hash.length > MAX_RECENT_HASH) return; // a huge link would eat the storage quota
    const list = getRecents().filter(r => r.hash !== entry.hash);
    list.unshift({ ...entry, title: clip(entry.title, 120), sub: clip(entry.sub, 120) });
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
        <h1>${esc(title)}</h1>
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
    document.title = 'nbview: Jupyter notebook viewer for GitHub';
    const recents = getRecents();
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
        <p class="hint">Want to see what changed? <a href="#/compare">Compare two notebooks</a>, or use Compare on any GitHub notebook.</p>
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
    let repos = await gh(`/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`);
    if (stale(id)) return;
    if (!Array.isArray(repos)) throw new ViewError('Unexpected answer from GitHub', 'The repository list was not in the expected format. Try again later.');
    repos = repos.filter(r => r && typeof r.name === 'string' && r.owner && typeof r.owner.login === 'string');
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
    let items = await gh(
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

    items = items.filter(it => it && typeof it.name === 'string' && typeof it.type === 'string' && typeof it.path === 'string');
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

  async function viewGist(gistId, id) {
    showLoading('Fetching gist');
    const g = await gh(`/gists/${encodeURIComponent(gistId)}`);
    if (stale(id)) return;
    const files = Object.values(g.files || {});
    const file = files.find(f => isNbName(f.filename));
    if (!file) throw new ViewError('No notebook in this gist', "The gist doesn't contain an .ipynb file.");
    location.replace('#/url/' + encodeURIComponent(file.raw_url));
  }

  function showBigWarning(name, text, onOpen) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([text], { type: 'application/x-ipynb+json' }));
    app.innerHTML = `
      <div class="error-box" role="alert">
        <h1>This notebook is large (${esc(fmtSize(text.length))})</h1>
        <p>Big embedded outputs, such as images and tables, can make this tab slow or freeze it while the notebook renders. You can open it anyway or download the file instead.</p>
        <div class="toolbar">
          <button class="btn primary" id="big-open" type="button">Open anyway</button>
          <a class="btn" id="big-dl" download="${esc(name)}">Download</a>
          <a class="btn" href="#/">Back to start</a>
        </div>
      </div>`;
    document.getElementById('big-dl').href = downloadUrl;
    document.getElementById('big-open').addEventListener('click', onOpen);
  }

  async function viewNotebook(src, id) {
    showLoading('Fetching notebook');
    const isGh = !src.url;
    if (!isGh && !/^https?:\/\//i.test(src.url)) {
      throw new ViewError('Unsupported link', 'Only http and https notebook links can be opened.');
    }
    const url = isGh
      ? `${RAW}/${enc(src.owner)}/${enc(src.repo)}/${enc(src.ref)}/${enc(src.path)}`
      : src.url;

    if (!isGh) {
      let h = '';
      try { h = new URL(src.url).hostname; } catch { /* the fetch below reports it */ }
      if (/^(colab\.research\.google\.com|drive\.google\.com|docs\.google\.com)$/i.test(h)) {
        throw new ViewError("Google Drive and Colab files can't be opened", 'Those links need a Google sign-in, so nbview cannot read them. Download the .ipynb and drop it on the home page, or use a link to the notebook on GitHub.');
      }
    }

    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new ViewError('The server took too long', 'The file did not arrive within a minute. Try again later.');
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

    if (text.length > BIG_NB && !bigOk.has(location.hash)) {
      const name = clip(isGh ? src.path.split('/').pop() : (safeDecode(new URL(url).pathname.split('/').pop()) || 'notebook.ipynb'), 120);
      showBigWarning(name, text, () => { bigOk.add(location.hash); route(); });
      return;
    }

    let nb;
    try { nb = JSON.parse(text); } catch {
      throw new ViewError('Not a readable notebook', "The file isn't valid JSON, so it can't be opened as .ipynb.");
    }

    const host = isGh ? null : new URL(url).host;
    const name = clip(isGh ? src.path.split('/').pop() : (safeDecode(new URL(url).pathname.split('/').pop()) || 'notebook.ipynb'), 120);
    const ghPath = isGh ? `${enc(src.owner)}/${enc(src.repo)}/blob/${enc(src.ref)}/${enc(src.path)}` : null;
    const ctx = isGh
      ? { owner: src.owner, repo: src.repo, ref: src.ref, dir: src.path.split('/').slice(0, -1).join('/'), rawBase: url }
      : { rawBase: url };

    addRecent({ kind: 'nb', hash: location.hash, title: name, sub: isGh ? `${src.owner}/${src.repo}` : host });

    await showNotebook(nb, ctx, {
      name,
      text,
      shareable: true,
      crumbs: isGh
        ? crumbs(src.owner, src.repo, src.ref, src.path)
        : `<a href="#/">Home</a><span class="sep">/</span><span aria-current="page">${esc(host)}</span>`,
      github: isGh ? `https://github.com/${ghPath}` : null,
      colab: isGh ? `https://colab.research.google.com/github/${ghPath}` : null,
      // Binder runs the notebook in standard JupyterLab; a ref with slashes must be encoded as one segment.
      binder: isGh ? `https://mybinder.org/v2/gh/${enc(src.owner)}/${enc(src.repo)}/${encodeURIComponent(src.ref)}?urlpath=${encodeURIComponent('lab/tree/' + src.path)}` : null,
      source: isGh ? null : url,
      compare: isGh ? { owner: src.owner, repo: src.repo, ref: src.ref, path: src.path } : null,
    }, id);
  }

  function openLocal(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = ++routeId;
      document.body.classList.remove('is-home');
      const text = reader.result;
      const open = async () => {
        try {
          let nb;
          try { nb = JSON.parse(text); } catch {
            throw new ViewError('Not a readable notebook', `${file.name} isn't valid JSON, so it can't be opened as .ipynb.`);
          }
          await showNotebook(nb, {}, {
            name: file.name,
            text,
            crumbs: '<a href="#/">Home</a><span class="sep">/</span><span aria-current="page">Local file</span>',
          }, id);
        } catch (e) {
          if (!stale(id)) renderError(e);
        }
      };
      if (text.length > BIG_NB) showBigWarning(file.name, text, open);
      else open();
    };
    reader.readAsText(file);
  }

  /* ---------- notebook rendering ---------- */

  function normalize(nb) {
    if (!nb || typeof nb !== 'object' || Array.isArray(nb)) {
      throw new ViewError('Not a notebook', "The file is valid JSON, but it doesn't look like a Jupyter notebook.");
    }
    if (Array.isArray(nb.cells)) return { cells: nb.cells, meta: nb.metadata || {} };
    if (Array.isArray(nb.worksheets)) {
      // nbformat 3
      const ws = nb.worksheets[0] || {};
      const cells = (Array.isArray(ws.cells) ? ws.cells : []).filter(c => c && typeof c === 'object').map(c => {
        if (c.cell_type === 'code') {
          const outs = (Array.isArray(c.outputs) ? c.outputs : []).filter(o => o && typeof o === 'object');
          return { cell_type: 'code', source: c.input, execution_count: c.prompt_number, outputs: outs.map(v3Output) };
        }
        if (c.cell_type === 'heading') {
          const level = Math.min(6, Math.max(1, Math.trunc(Number(c.level)) || 1));
          return { cell_type: 'markdown', source: '#'.repeat(level) + ' ' + join(c.source) };
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
    mathMs = 0;
    mathCount = 0;
    document.title = `${info.name} | nbview`;
    document.body.classList.remove('hide-code', 'hide-outputs');

    app.innerHTML = `
      <article class="nb">
        <nav class="crumbs">${info.crumbs || ''}</nav>
        <header class="nb-head">
          <h1 class="nb-title">${esc(info.name).replace(/([_.-])/g, '$1<wbr>')}</h1>
          <div class="toolbar">
            <details class="menu menu-left" id="toc-menu" hidden>
              <summary class="btn">Contents</summary>
              <div class="menu-list toc-list" id="toc-list"></div>
            </details>
            <button class="btn" id="toggle-code" type="button" aria-pressed="false">Hide code</button>
            <button class="btn" id="toggle-outputs" type="button" aria-pressed="false">Hide outputs</button>
            <button class="btn" id="toggle-lines" type="button" aria-pressed="false">Line numbers</button>
            <button class="btn" id="toggle-wrap" type="button" aria-pressed="false">Wrap lines</button>
            <a class="btn" id="dl">Download</a>
            <details class="menu" id="export-menu">
              <summary class="btn">Export</summary>
              <div class="menu-list">
                ${lang === 'python' ? '<button type="button" data-export="py">Python script (.py)</button>' : ''}
                <button type="button" data-export="md">Markdown (.md)</button>
                <button type="button" data-export="html">HTML page (.html)</button>
                <button type="button" data-export="print">Print / Save as PDF</button>
              </div>
            </details>
            ${info.compare ? '<button class="btn" id="compare-btn" type="button">Compare</button>' : ''}
            ${info.shareable ? '<button class="btn" id="copy-link" type="button">Copy link</button>' : ''}
            ${info.binder ? `<a class="btn" href="${esc(info.binder)}" target="_blank" rel="noopener">Open in Binder</a>` : ''}
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

    const copy = document.getElementById('copy-link');
    if (copy) {
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(location.href); copy.textContent = 'Copied'; }
        catch { copy.textContent = 'Press Ctrl+C'; window.prompt('Copy this link', location.href); }
        setTimeout(() => { copy.textContent = 'Copy link'; }, 1800);
      });
    }

    const toggle = document.getElementById('toggle-code');
    toggle.addEventListener('click', () => {
      const hidden = document.body.classList.toggle('hide-code');
      toggle.setAttribute('aria-pressed', String(hidden));
      toggle.textContent = hidden ? 'Show code' : 'Hide code';
    });

    const cmpBtn = document.getElementById('compare-btn');
    if (cmpBtn) cmpBtn.addEventListener('click', () => openCompare(info.compare));

    const toggleOut = document.getElementById('toggle-outputs');
    toggleOut.addEventListener('click', () => {
      const hidden = document.body.classList.toggle('hide-outputs');
      toggleOut.setAttribute('aria-pressed', String(hidden));
      toggleOut.textContent = hidden ? 'Show outputs' : 'Hide outputs';
    });

    // Contents menu: filled with the markdown headings as cells render.
    const tocMenu = document.getElementById('toc-menu');
    const tocList = document.getElementById('toc-list');
    let tocCount = 0;
    const addHeadings = el => {
      for (const h of el.querySelectorAll('h1, h2, h3, h4')) {
        const text = clip((h.textContent || '').replace(/\s+/g, ' ').trim(), 80);
        if (!text || tocCount >= MAX_TOC) continue;
        tocCount++;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `toc-item toc-l${h.tagName[1]}`;
        b.textContent = text;
        b.addEventListener('click', () => { tocMenu.open = false; h.scrollIntoView({ block: 'start' }); });
        tocList.append(b);
      }
      if (tocCount) tocMenu.hidden = false;
    };

    for (const [btnId, cls, key] of [['toggle-lines', 'line-numbers', 'lines'], ['toggle-wrap', 'wrap-code', 'wrap']]) {
      const btn = document.getElementById(btnId);
      const apply = on => { document.body.classList.toggle(cls, on); btn.setAttribute('aria-pressed', String(on)); };
      apply(pref.get(key));
      btn.addEventListener('click', () => { const on = !document.body.classList.contains(cls); apply(on); pref.set(key, on); });
    }

    let done;
    current = { name: info.name, cells, lang, rendered: new Promise(r => { done = r; }) };
    document.getElementById('export-menu').addEventListener('click', e => {
      const item = e.target.closest('[data-export]');
      if (!item) return;
      e.currentTarget.open = false;
      runExport(item.dataset.export, current).catch(err => console.error('Export failed', err));
    });

    // Render in batches so huge notebooks stay responsive.
    const host = document.getElementById('cells');
    try {
      let frameStart = performance.now();
      for (let i = 0; i < cells.length; i++) {
        if (stale(id)) return;
        try {
          const el = renderCell(cells[i], ctx, lang);
          if (el) {
            host.append(el);
            if (cells[i].cell_type === 'markdown') addHeadings(el);
          }
        } catch (err) {
          console.error('Cell failed to render', i, err);
          host.append(failedCell(cells[i]));
        }
        if (performance.now() - frameStart > 12) { await nextFrame(); frameStart = performance.now(); }
      }
    } finally { done(); }
  }

  /* ---------- export ---------- */

  function saveFile(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Styles of the page itself (same-origin sheets only), with relative url() paths made absolute.
  function pageCss() {
    let css = '';
    for (const sheet of document.styleSheets) {
      if (!sheet.href || !sheet.href.startsWith(location.origin)) continue;
      const base = sheet.href;
      try {
        for (const rule of sheet.cssRules) {
          css += rule.cssText.replace(/url\((["']?)(?!https?:|data:)([^)"']+)\1\)/g, (m, q, u) => 'url("' + new URL(u, base).href + '")') + '\n';
        }
      } catch { /* unreadable sheet */ }
    }
    return css;
  }

  async function runExport(kind, nbState) {
    if (!nbState) return;
    if (kind === 'print') { await nbState.rendered; window.print(); return; }
    const base = nbState.name.replace(/\.ipynb$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_') || 'notebook';
    if (kind === 'py') return saveFile(base + '.py', window.nbvExport.toPython(nbState.cells, nbState.name), 'text/x-python');
    if (kind === 'md') return saveFile(base + '.md', window.nbvExport.toMarkdown(nbState.cells, nbState.lang), 'text/markdown');
    if (kind === 'html') {
      await nbState.rendered;
      const host = document.getElementById('cells').cloneNode(true);
      for (const big of host.querySelectorAll('.output-big')) {
        const note = document.createElement('div');
        note.className = 'output note';
        note.textContent = 'Large output omitted.';
        big.replaceWith(note);
      }
      const keep = ['hide-code', 'hide-outputs', 'line-numbers', 'wrap-code'].filter(c => document.body.classList.contains(c)).join(' ');
      return saveFile(base + '.html', window.nbvExport.toHtml({ name: nbState.name, cellsHtml: host.innerHTML, css: pageCss(), origin: location.origin, bodyClass: keep }), 'text/html');
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

  // Shown instead of a cell that threw while rendering, with its raw source so nothing is silently lost.
  function failedCell(cell) {
    const sec = document.createElement('section');
    sec.className = 'cell cell-failed';
    const row = makeRow('', '');
    const box = row.lastChild;
    box.classList.add('cell-error');
    box.append(document.createTextNode("This cell couldn't be displayed."));
    let src = '';
    try { src = cell && typeof cell === 'object' ? join(cell.source) : ''; } catch { /* unreadable source */ }
    if (src) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = 'Show raw source';
      const pre = document.createElement('pre');
      pre.textContent = src.length > 20000 ? src.slice(0, 20000) + `\n... (${fmtSize(src.length)} in total, truncated)` : src;
      det.append(sum, pre);
      box.append(det);
    }
    sec.append(row);
    return sec;
  }

  function failedOutput() {
    const d = document.createElement('div');
    d.className = 'output output-failed';
    d.textContent = "This output couldn't be displayed.";
    return d;
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
      pre.tabIndex = 0; // long lines scroll sideways, so keyboard users need to reach it
      const code = document.createElement('code');
      code.className = 'hljs';
      const source = join(cell.source);
      code.innerHTML = highlight(source, lang);
      if (source.length <= MAX_HIGHLIGHT) {
        const gutter = document.createElement('span');
        gutter.className = 'gutter';
        gutter.setAttribute('aria-hidden', 'true');
        gutter.textContent = Array.from({ length: source.replace(/\n$/, '').split('\n').length }, (_, i) => i + 1).join('\n');
        pre.append(gutter);
      }
      pre.append(code);
      input.lastChild.append(pre);
      sec.append(input);

      const outs = Array.isArray(cell.outputs) ? cell.outputs.filter(o => o && typeof o === 'object') : [];
      for (const out of mergeStreams(outs)) {
        let content;
        try { content = renderOutput(out, ctx); } catch (err) {
          console.error('Output failed to render', err);
          content = failedOutput();
        }
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

  // Outputs bigger than this wait behind a button so one heavy cell can't freeze the tab.
  const BIG_OUT = 1024 * 1024;

  function outputSize(out) {
    if (out.output_type === 'stream') return join(out.text).length;
    if (out.output_type === 'error') return join(out.traceback).length;
    let n = 0;
    for (const v of Object.values(out.data || {})) n += typeof v === 'string' || Array.isArray(v) ? join(v).length : JSON.stringify(v).length;
    return n;
  }

  function renderOutput(out, ctx) {
    const size = outputSize(out);
    if (size <= BIG_OUT) return renderOutputNow(out, ctx);
    const wrap = document.createElement('div');
    wrap.className = 'output output-big';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = `Show output (${fmtSize(size)})`;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Rendering...';
      requestAnimationFrame(() => setTimeout(() => {
        const real = renderOutputNow(out, ctx);
        if (real) wrap.replaceWith(real); else wrap.remove();
      }, 0));
    });
    wrap.append(btn);
    return wrap;
  }

  function renderOutputNow(out, ctx) {
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
      const data = out.data && typeof out.data === 'object' && !Array.isArray(out.data) ? out.data : {};
      return renderMime(wrap, data, out.metadata || {}, ctx) ? wrap : null;
    }
    return null;
  }

  const MIME_ORDER = [
    'text/html', 'image/svg+xml', 'image/png', 'image/jpeg', 'image/gif',
    'text/markdown', 'text/latex', 'application/json', 'text/plain',
  ];

  // Reads the pixel size from the first bytes of a PNG, GIF or JPEG so the browser can reserve space.
  function imageSize(type, b64) {
    try {
      const bin = atob(b64.slice(0, type === 'image/jpeg' ? 87380 : 44));
      const u16 = i => (bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1);
      const u32 = i => u16(i) * 65536 + u16(i + 2);
      if (type === 'image/png' && bin.startsWith('\x89PNG')) return [u32(16), u32(20)];
      if (type === 'image/gif' && bin.startsWith('GIF8')) return [bin.charCodeAt(6) | (bin.charCodeAt(7) << 8), bin.charCodeAt(8) | (bin.charCodeAt(9) << 8)];
      if (type === 'image/jpeg' && u16(0) === 0xFFD8) {
        for (let i = 2; i + 9 < bin.length;) {
          if (bin.charCodeAt(i) !== 0xFF) return null;
          const marker = bin.charCodeAt(i + 1);
          if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return [u16(i + 7), u16(i + 5)];
          i += 2 + u16(i + 2);
        }
      }
    } catch { /* unknown size: fine */ }
    return null;
  }

  function renderMime(wrap, data, meta, ctx) {
    let skippedScript = false;

    for (const type of MIME_ORDER) {
      if (!(type in data)) continue;
      const raw = data[type];
      const v = type === 'application/json' ? raw : join(raw);

      if (type === 'text/html') {
        const scope = newScope();
        const clean = sanitizeHtml(v, scope);
        const probe = document.createElement('div');
        probe.innerHTML = clean;
        const visible = probe.textContent.trim() || probe.querySelector('img,svg,table,video,canvas');
        if (!visible) {
          // Typically Plotly/Bokeh/widget output that only works with JavaScript.
          skippedScript = /<script/i.test(v);
          continue;
        }
        const d = document.createElement('div');
        d.className = `html-out ${scope}`;
        d.innerHTML = clean;
        d.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
        wrap.append(d);
        return true;
      }

      if (type.startsWith('image/')) {
        const img = new Image();
        img.alt = 'Cell output';
        img.decoding = 'async';
        const b64 = type === 'image/svg+xml' ? '' : v.replace(/\s/g, '');
        img.src = type === 'image/svg+xml'
          ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(v)
          : `data:${type};base64,${b64}`;
        const m = meta[type] || meta;
        const size = imageSize(type, b64);
        const w = (m && m.width) || (size && size[0]);
        const h = (m && m.height) || (size && size[1]);
        if (w) img.width = w;
        if (h) img.height = h;
        // Lazy loading only when the size is known, so the page doesn't jump as images arrive.
        if (w && h) img.loading = 'lazy';
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
    n.textContent = 'Interactive output that needs JavaScript is not run here. Open in Binder or Colab to run it.';
    return n;
  }

  /* ---------- HTML sanitizing ---------- */

  // Notebook HTML is untrusted. Forms and form controls are removed (no fake sign-in boxes), and author CSS
  // keeps colors, borders and fonts but loses anything that can position, cover or restyle the page.
  const SAFE_HTML = {
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'link', 'meta', 'base'],
    FORBID_ATTR: ['formaction', 'form', 'ping'],
    FORCE_BODY: true, // keep a leading <style> (pandas Styler starts with one) instead of dropping it
  };
  const BAD_PROP = /^(position|z-index|inset(-.*)?|top|left|right|bottom)$/;
  const BAD_VALUE = /url\s*\(|image-set\s*\(|expression\s*\(|@import|javascript:|-moz-binding|behavior\s*:/i;
  let scopeSeq = 0;
  let activeScope = '';

  const newScope = () => `nbv-s${++scopeSeq}`;

  function cleanDecls(style) {
    for (const p of [...style]) {
      if (BAD_PROP.test(p) || BAD_VALUE.test(style.getPropertyValue(p))) style.removeProperty(p);
    }
  }

  // Keeps plain style rules, filters their declarations, and confines every selector to one cell.
  function scopeCss(text, scope) {
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(text); } catch { return ''; }
    let out = '';
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      cleanDecls(rule.style);
      if (rule.style.length) out += `.${scope} :is(${rule.selectorText}) { ${rule.style.cssText} }\n`;
    }
    return out;
  }

  if (window.DOMPurify) {
    DOMPurify.addHook('uponSanitizeElement', (node, data) => {
      if (data.tagName === 'style') node.textContent = scopeCss(node.textContent || '', activeScope);
    });
    DOMPurify.addHook('afterSanitizeAttributes', node => {
      if (!node.hasAttribute || !node.hasAttribute('style') || !node.style) return;
      cleanDecls(node.style);
      if (!node.style.length) node.removeAttribute('style');
    });
  }

  // Returns sanitized HTML; the caller adds the same `scope` class to the element that receives it.
  function sanitizeHtml(html, scope) {
    activeScope = scope;
    return DOMPurify.sanitize(html, SAFE_HTML);
  }

  /* ---------- markdown + math ---------- */

  /* Python highlighter that emits Pygments token classes, so code looks like nbviewer's.
   * highlight.js leaves operators and module names unmarked, which CSS can't recover. */
  const PY_KW = new Set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
  const PY_OPWORD = new Set(['and', 'or', 'not', 'in', 'is']);
  const PY_CONST = new Set(['True', 'False', 'None']);
  const PY_BUILTIN = new Set(('abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex ' +
    'delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int ' +
    'isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr ' +
    'reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip').split(' '));
  const PY_TOKEN = new RegExp([
    /(#[^\n]*)/,
    /((?<!\w)(?:[rRbBuUfF]{1,2})?(?:'''[\s\S]*?(?:'''|(?![\s\S]))|"""[\s\S]*?(?:"""|(?![\s\S]))|'(?:\\[\s\S]|[^'\\\n])*'?|"(?:\\[\s\S]|[^"\\\n])*"?))/,
    /((?<![\w.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?))/,
    /([A-Za-z_]\w*)/,
    /((?<=^[ \t]*)@[\w.]+)/,
    /(\*\*=?|\/\/=?|<<=?|>>=?|->|:=|!=|[<>=+\-*/%&|^@]=?|~)/,
    /(\n)/,
    /([\s\S])/,
  ].map(r => r.source).join('|'), 'gm');

  function pyHighlight(code) {
    let out = '';
    let m;
    let mode = null;      // 'from' or 'mod' while module names follow; 'alias' right after `as`
    let lineStart = true; // only whitespace seen since the last newline
    let after = null;     // 'def' or 'class' when the next identifier names it
    let prevDot = false;
    const span = (cls, t) => `<span class="${cls}">${esc(t)}</span>`;
    const reset = () => { after = null; prevDot = false; };
    while ((m = PY_TOKEN.exec(code))) {
      const t = m[0];
      if (m[1]) { out += span('c1', t); continue; }
      if (m[2]) { out += span('s', t); lineStart = false; reset(); continue; }
      if (m[3]) { out += span('m', t); lineStart = false; reset(); continue; }
      if (m[5]) { out += span('nd', t); lineStart = false; reset(); continue; }
      if (m[7]) { out += t; lineStart = true; mode = null; reset(); continue; }
      if (m[6]) { out += span('o', t); lineStart = false; reset(); continue; }
      if (m[4]) {
        const bol = lineStart;
        lineStart = false;
        if (prevDot && !mode) { out += esc(t); prevDot = false; continue; }
        prevDot = false;
        if (mode === 'alias') { out += esc(t); mode = 'mod'; continue; }
        if (t === 'as' && mode) { out += span('kn', t); mode = 'alias'; continue; }
        if (t === 'import' && (bol || mode === 'from')) { out += span('kn', t); mode = mode === 'from' ? null : 'mod'; continue; }
        if (t === 'from' && bol) { out += span('kn', t); mode = 'from'; continue; }
        if (mode) { out += span('nn', t); continue; }
        if (after) { out += span(after === 'def' ? 'nf' : 'nc', t); after = null; continue; }
        after = (t === 'def' || t === 'class') ? t : null;
        if (PY_OPWORD.has(t)) out += span('ow', t);
        else if (PY_CONST.has(t)) out += span('kc', t);
        else if (PY_KW.has(t)) out += span('k', t);
        else if (PY_BUILTIN.has(t)) out += span('nb', t);
        else if (t === 'self' || t === 'cls') out += span('bp', t);
        else if (/^[A-Z]\w*(Error|Exception|Warning)$/.test(t) || t === 'StopIteration' || t === 'KeyboardInterrupt') out += span('ne', t);
        else out += esc(t);
        continue;
      }
      // whitespace, punctuation
      if (!/\s/.test(t)) lineStart = false;
      prevDot = t === '.';
      if (t === ',' && mode === 'alias') mode = 'mod';
      out += esc(t);
    }
    return out;
  }

  // Above this size, plain text: the highlighter makes about 350 DOM nodes per KB of source.
  const MAX_HIGHLIGHT = 200000;

  function highlight(code, lang) {
    if (code.length > MAX_HIGHLIGHT) return esc(code);
    if (/^(python|python3|ipython3?|py)$/.test(lang || '')) return pyHighlight(code);
    if (window.hljs && lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fall through */ }
    }
    return esc(code);
  }

  if (window.marked) {
    marked.use({
      gfm: true,
      renderer: {
        // Fenced code goes through the same highlighter as code cells.
        code({ text, lang }) {
          const l = ((lang || '').match(/\S*/) || [''])[0].toLowerCase();
          return `<pre><code class="hljs${l ? ' language-' + esc(l) : ''}">${highlight(text, l)}</code></pre>\n`;
        },
      },
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
    const scope = newScope();
    el.classList.add(scope);
    el.innerHTML = sanitizeHtml(html, scope);
    fixLinks(el, ctx);
    typeset(el);
  }

  // Math limits: one huge or deeply nested equation can freeze the tab, so oversize input is shown as text
  // and a notebook gets a fixed time budget for all of its equations.
  const MAX_MATH_CHARS = 4000;
  const MAX_MATH_DEPTH = 40;
  const MATH_BUDGET_MS = 4000;
  const MAX_MATH_COUNT = 2000; // each equation is about 30 DOM nodes, and layout cost is not in the time budget
  let mathMs = 0;       // time spent on equations so far in this notebook
  let mathStart = 0;    // start of the typeset call in progress, 0 when idle
  let mathCount = 0;    // equations rendered so far in this notebook

  function mathTooBig(tex) {
    if (tex.length > MAX_MATH_CHARS) return true;
    let depth = 0;
    for (const c of tex) {
      if (c === '{') { if (++depth > MAX_MATH_DEPTH) return true; } else if (c === '}') depth--;
    }
    return false;
  }

  if (window.katex && katex.render) {
    const render = katex.render.bind(katex);
    katex.render = (tex, el, opts) => {
      const spent = mathMs + (mathStart ? performance.now() - mathStart : 0);
      if (spent > MATH_BUDGET_MS || ++mathCount > MAX_MATH_COUNT || mathTooBig(tex)) {
        el.textContent = tex;
        el.className = 'math-skipped';
        el.title = 'Equation too large to render here';
        return;
      }
      render(tex, el, opts);
    };
  }

  function typeset(el) {
    if (!window.renderMathInElement) return;
    mathStart = performance.now();
    try { typesetNow(el); } finally { mathMs += performance.now() - mathStart; mathStart = 0; }
  }

  function typesetNow(el) {
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

  /* ---------- compare ---------- */

  const compareHash = (owner, repo, base, head, path) =>
    `#/compare/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(base)}...${encodeURIComponent(head)}/${enc(path)}`;
  const shortRef = r => (/^[0-9a-f]{40}$/i.test(r) ? r.slice(0, 7) : r);

  function parseCells(text, label) {
    if (text.length > BIG_NB) throw new ViewError('Too large to compare', `${label} is over ${fmtSize(BIG_NB)}. Open it on its own instead.`);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ViewError('Not a readable notebook', `${label} isn't valid JSON, so it can't be compared.`); }
    return normalize(parsed).cells;
  }

  async function fetchCells(owner, repo, ref, path) {
    let res;
    try {
      res = await fetch(`${RAW}/${enc(owner)}/${enc(repo)}/${enc(ref)}/${enc(path)}`, { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      throw new ViewError("Couldn't load a version", e && e.name === 'TimeoutError' ? 'The server took too long to answer.' : 'The network request failed. Check your connection and try again.');
    }
    if (res.status === 404) {
      throw new ViewError(`Not found at ${shortRef(ref)}`, `The file ${path} doesn't exist at "${ref}", or that branch, tag or commit doesn't exist. Only public repos can be compared.`);
    }
    if (!res.ok) throw new ViewError(`Request failed (${res.status})`, 'The server refused the request. Try again in a moment.');
    return parseCells(await res.text(), shortRef(ref));
  }

  async function viewCompareGh(owner, repo, base, head, path, id) {
    if (!base || !head || !path) throw new ViewError('Incomplete compare link', 'A compare link needs two versions and a notebook path.');
    showLoading('Fetching both versions');
    const [a, b] = await Promise.all([fetchCells(owner, repo, base, path), fetchCells(owner, repo, head, path)]);
    if (stale(id)) return;
    const name = path.split('/').pop();
    renderDiff({
      title: name,
      crumbs: `<a href="#/">Home</a><span class="sep">/</span><a href="${hashFor(owner, repo, 'blob', head, path)}">${esc(name)}</a><span class="sep">/</span><span aria-current="page">Compare</span>`,
      labelA: shortRef(base),
      labelB: shortRef(head),
      entries: nbvDiff.diffCells(a, b),
      links: `<a class="btn" href="${compareHash(owner, repo, head, base, path)}">Swap versions</a>` +
        `<a class="btn" href="${hashFor(owner, repo, 'blob', head, path)}">Back to notebook</a>` +
        `<a class="btn" href="https://github.com/${enc(owner)}/${enc(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}" target="_blank" rel="noopener">Commits on GitHub</a>`,
    });
  }

  const GH_OWNER = /^[A-Za-z0-9-]+$/;
  const GH_REPO = /^[A-Za-z0-9_.-]+$/;
  const rawUrl = (owner, repo, ref, path) => `${RAW}/${enc(owner)}/${enc(repo)}/${enc(ref)}/${enc(path)}`;
  const compareLinksHash = (a, b) => `#/compare/links/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
  const RAW_GH = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;

  // Turns what someone typed (GitHub link, raw link, owner/repo/path.ipynb or any notebook URL) into a fetchable http(s) URL.
  function notebookUrl(input) {
    const text = String(input || '').trim();
    if (!text) throw new ViewError('A link is missing', 'Enter a notebook link, or owner/repo/path/to/notebook.ipynb, for both notebooks.');
    let m = text.match(/^([^/\s:]+)\/([^/\s:]+)\/(.+\.ipynb)$/i);
    if (m && GH_OWNER.test(m[1]) && GH_REPO.test(m[2]) && !/^(blob|tree)\//.test(m[3])) return rawUrl(m[1], m[2], 'HEAD', safeDecode(m[3]));
    if ((/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:/i.test(text)) || /^(javascript|data|file|vbscript):/i.test(text)) {
      throw new ViewError("That link can't be used", `"${clip(text, 80)}" isn't a GitHub notebook link or an http(s) link to an .ipynb file.`);
    }
    const hash = parseInput(text);
    const parts = hash ? hash.replace(/^#\//, '').split('/').map(safeDecode) : [];
    if (parts[0] === 'github') {
      const [, owner, repo, kind, ref, ...rest] = parts;
      const path = rest.join('/');
      if (kind === 'blob' && ref && isNbName(path)) return rawUrl(owner, repo, ref, path);
      throw new ViewError('That is not a notebook link', `"${clip(text, 80)}" points to a repo or folder. Use a link to one .ipynb file, or owner/repo/path/to/notebook.ipynb.`);
    }
    if (parts[0] === 'gist') throw new ViewError("Gists can't be compared yet", 'Use a link to the notebook file on GitHub (raw or blob), or download it and use Two files.');
    if (parts[0] === 'url' && /^https?:\/\//i.test(parts[1] || '')) return parts[1];
    throw new ViewError("That link can't be used", `"${clip(text, 80)}" isn't a GitHub notebook link or an http(s) link to an .ipynb file.`);
  }

  const labelOf = url => {
    const m = url.match(RAW_GH);
    if (m) return `${safeDecode(m[1])}/${safeDecode(m[2])}@${safeDecode(m[3])}`;
    try { const u = new URL(url); return `${u.host}${u.pathname.length > 40 ? '/...' + u.pathname.slice(-30) : u.pathname}`; } catch { return clip(url, 40); }
  };
  const fileNameOf = url => { try { return safeDecode(new URL(url).pathname.split('/').pop()) || 'notebook.ipynb'; } catch { return 'notebook.ipynb'; } };
  const openLinkOf = url => {
    const m = url.match(RAW_GH);
    return m ? hashFor(safeDecode(m[1]), safeDecode(m[2]), 'blob', safeDecode(m[3]), safeDecode(m[4])) : null;
  };

  async function fetchUrlCells(url) {
    const label = labelOf(url);
    if (!/^https?:\/\//i.test(url)) throw new ViewError('Unsupported link', 'Only http and https notebook links can be compared.');
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      throw new ViewError(`Couldn't load ${label}`, e && e.name === 'TimeoutError' ? 'The server took too long to answer.'
        : RAW_GH.test(url) ? 'The network request failed. Check your connection and try again.'
        : "The site hosting this file doesn't let other pages read it (CORS). GitHub, GitLab raw and gist raw links work.");
    }
    if (res.status === 404) throw new ViewError(`Not found: ${label}`, 'Check the link, branch and path. Only public repos can be compared.');
    if (!res.ok) throw new ViewError(`Request failed (${res.status})`, `${label} could not be loaded. Try again in a moment.`);
    return parseCells(await res.text(), label);
  }

  async function viewCompareLinks(urlA, urlB, id) {
    showLoading('Fetching both notebooks');
    const [a, b] = await Promise.all([fetchUrlCells(urlA), fetchUrlCells(urlB)]);
    if (stale(id)) return;
    const nameA = fileNameOf(urlA), nameB = fileNameOf(urlB);
    const open = (url, word) => { const h = openLinkOf(url); return h ? `<a class="btn" href="${h}">Open ${word}</a>` : `<a class="btn" href="#/url/${encodeURIComponent(url)}">Open ${word}</a>`; };
    renderDiff({
      title: nameA === nameB ? nameA : `${nameA} and ${nameB}`,
      crumbs: '<a href="#/">Home</a><span class="sep">/</span><a href="#/compare">Compare</a><span class="sep">/</span><span aria-current="page">Two notebooks</span>',
      labelA: labelOf(urlA),
      labelB: labelOf(urlB),
      entries: nbvDiff.diffCells(a, b),
      links: `<a class="btn" href="${compareLinksHash(urlB, urlA)}">Swap sides</a>${open(urlA, 'original')}${open(urlB, 'modified')}<a class="btn" href="#/compare">New comparison</a>`,
    });
  }

  // Pick two notebooks: local files (never leave the browser) or two links.
  function viewComparePick() {
    document.title = 'Compare notebooks | nbview';
    const picks = { a: null, b: null };
    const slot = (key, label) => `
      <label class="drop compare-slot" id="slot-${key}">
        <strong>${label}</strong>
        <span class="muted" id="name-${key}">Choose or drop an .ipynb file</span>
        <input type="file" id="file-${key}" accept=".ipynb,application/json" hidden>
      </label>`;
    app.innerHTML = `
      <div class="page">
        <nav class="crumbs"><a href="#/">Home</a><span class="sep">/</span><span aria-current="page">Compare</span></nav>
        <header class="page-head"><h1>Compare two notebooks</h1></header>
        <div class="toolbar compare-modes">
          <button class="btn" id="mode-links" type="button" aria-pressed="true">Two links</button>
          <button class="btn" id="mode-files" type="button" aria-pressed="false">Two files</button>
        </div>
        <section id="panel-links">
          <p class="hint">Paste a link to each notebook, or <code>owner/repo/path/to/notebook.ipynb</code>. They can be in different repos or branches. Public repos only.</p>
          <form id="links-form" class="compare-links">
            <label for="link-a">Original</label>
            <input id="link-a" type="text" placeholder="https://github.com/owner/repo/blob/main/notebook.ipynb" autocomplete="off" spellcheck="false">
            <label for="link-b">Modified</label>
            <input id="link-b" type="text" placeholder="owner/other-repo/notebooks/notebook.ipynb" autocomplete="off" spellcheck="false">
            <div class="toolbar compare-go"><button class="btn primary" type="submit">Compare</button></div>
          </form>
        </section>
        <section id="panel-files" hidden>
          <p class="hint">Pick or drop two <code>.ipynb</code> files to see which cells were added, removed or changed. The files stay in your browser.</p>
          <div class="compare-slots">${slot('a', 'Original')}${slot('b', 'Modified')}</div>
          <div class="toolbar compare-go"><button class="btn primary" id="compare-go" type="button" disabled>Compare</button></div>
        </section>
        <p class="hint form-error" id="compare-msg" role="alert" hidden></p>
      </div>`;
    const setMode = mode => {
      document.getElementById('panel-links').hidden = mode !== 'links';
      document.getElementById('panel-files').hidden = mode !== 'files';
      document.getElementById('mode-links').setAttribute('aria-pressed', String(mode === 'links'));
      document.getElementById('mode-files').setAttribute('aria-pressed', String(mode === 'files'));
      document.getElementById('compare-msg').hidden = true;
    };
    document.getElementById('mode-links').addEventListener('click', () => setMode('links'));
    document.getElementById('mode-files').addEventListener('click', () => setMode('files'));
    document.getElementById('links-form').addEventListener('submit', e => {
      e.preventDefault();
      const note = document.getElementById('compare-msg');
      try {
        const a = notebookUrl(document.getElementById('link-a').value), b = notebookUrl(document.getElementById('link-b').value);
        note.hidden = true;
        location.hash = compareLinksHash(a, b);
      } catch (err) {
        note.textContent = err.detail || err.message;
        note.hidden = false;
      }
    });
    const go = document.getElementById('compare-go');
    const msg = document.getElementById('compare-msg');
    const take = (key, file) => {
      if (!file) return;
      picks[key] = file;
      document.getElementById(`name-${key}`).textContent = `${file.name} (${fmtSize(file.size)})`;
      go.disabled = !(picks.a && picks.b);
    };
    for (const key of ['a', 'b']) {
      const slotEl = document.getElementById(`slot-${key}`);
      document.getElementById(`file-${key}`).addEventListener('change', e => take(key, e.target.files[0]));
      slotEl.addEventListener('dragover', e => { e.preventDefault(); slotEl.classList.add('over'); });
      slotEl.addEventListener('dragleave', () => slotEl.classList.remove('over'));
      slotEl.addEventListener('drop', e => { e.preventDefault(); slotEl.classList.remove('over'); take(key, e.dataTransfer.files[0]); });
    }
    go.addEventListener('click', async () => {
      msg.hidden = true;
      try {
        const [a, b] = await Promise.all([picks.a.text(), picks.b.text()]);
        const cellsA = parseCells(a, picks.a.name), cellsB = parseCells(b, picks.b.name);
        renderDiff({
          title: `${picks.a.name} and ${picks.b.name}`,
          crumbs: '<a href="#/">Home</a><span class="sep">/</span><span aria-current="page">Compare</span>',
          labelA: picks.a.name,
          labelB: picks.b.name,
          entries: nbvDiff.diffCells(cellsA, cellsB),
          links: '<a class="btn" href="#/compare">New comparison</a>',
        });
      } catch (e) {
        msg.textContent = e.detail || e.message;
        msg.hidden = false;
      }
    });
  }

  /* diff rendering: every piece of notebook text goes in with textContent, never as HTML */

  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const KIND_LABEL = { added: 'Added', removed: 'Removed', modified: 'Modified', same: 'Output changed' };
  const TYPE_LABEL = { code: 'Code cell', markdown: 'Markdown cell', raw: 'Raw cell' };
  const FOLD_AFTER = 8; // equal lines in a row before the middle is folded away
  const FOLD_KEEP = 3;

  // Gives each line its number in the old (o) and new (n) text, like GitHub's diff gutters.
  function numberLines(lines) {
    let o = 0, n = 0;
    for (const l of lines) {
      l.o = l.t === 'add' ? 0 : ++o;
      l.n = l.t === 'del' ? 0 : ++n;
    }
    return lines;
  }

  // where: 'u' = one column (both numbers), 'l' / 'r' = left or right side of the side-by-side view.
  function diffLine(line, where) {
    const row = mk('div', `dline ${line.t}`);
    const num = where === 'l' ? line.o : where === 'r' ? line.n : null;
    if (where === 'u') {
      row.append(mk('span', 'dnum', line.o || ''), mk('span', 'dnum', line.n || ''));
    } else {
      row.append(mk('span', 'dnum', num || ''));
    }
    for (const n of row.querySelectorAll('.dnum')) n.setAttribute('aria-hidden', 'true');
    row.append(mk('span', 'dsign', line.t === 'add' ? '+' : line.t === 'del' ? '-' : ' '));
    if (line.t !== 'eq') row.lastChild.setAttribute('aria-hidden', 'true');
    if (line.t !== 'eq') row.append(mk('span', 'sr-only', line.t === 'add' ? 'added: ' : 'removed: '));
    row.append(mk('span', 'dtext', line.text === '' ? ' ' : line.text));
    return row;
  }

  // Lines for one-column view; long runs of unchanged lines fold into a button.
  function unifiedBody(lines) {
    const box = mk('div', 'dunified');
    for (let i = 0; i < lines.length;) {
      let j = i;
      if (lines[i].t === 'eq') {
        while (j < lines.length && lines[j].t === 'eq') j++;
        const run = lines.slice(i, j);
        if (run.length > FOLD_AFTER) {
          run.slice(0, FOLD_KEEP).forEach(l => box.append(diffLine(l, 'u')));
          const hidden = run.slice(FOLD_KEEP, run.length - FOLD_KEEP);
          const btn = mk('button', 'dfold', `Show ${hidden.length} unchanged lines`);
          btn.type = 'button';
          btn.addEventListener('click', () => { btn.replaceWith(...hidden.map(l => diffLine(l, 'u'))); });
          box.append(btn);
          run.slice(run.length - FOLD_KEEP).forEach(l => box.append(diffLine(l, 'u')));
        } else run.forEach(l => box.append(diffLine(l, 'u')));
      } else {
        while (j < lines.length && lines[j].t !== 'eq') j++;
        lines.slice(i, j).forEach(l => box.append(diffLine(l, 'u')));
      }
      i = j;
    }
    return box;
  }

  // Pairs removed and added lines side by side.
  function splitRows(lines) {
    const rows = [];
    for (let i = 0; i < lines.length;) {
      if (lines[i].t === 'eq') { rows.push({ l: lines[i], r: lines[i] }); i++; continue; }
      const dels = [], adds = [];
      while (i < lines.length && lines[i].t === 'del') dels.push(lines[i++]);
      while (i < lines.length && lines[i].t === 'add') adds.push(lines[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ l: dels[k] || null, r: adds[k] || null });
    }
    return rows;
  }

  function splitBody(lines) {
    const box = mk('div', 'dsplit');
    const cell = (line, side) => (line ? diffLine(line, side) : mk('div', `dline empty ${side}`));
    const put = row => { box.append(cell(row.l, 'l'), cell(row.r, 'r')); };
    const all = splitRows(lines);
    for (let i = 0; i < all.length;) {
      let j = i;
      if (all[i].l && all[i].l === all[i].r) {
        while (j < all.length && all[j].l && all[j].l === all[j].r) j++;
        const run = all.slice(i, j);
        if (run.length > FOLD_AFTER) {
          run.slice(0, FOLD_KEEP).forEach(put);
          const hidden = run.slice(FOLD_KEEP, run.length - FOLD_KEEP);
          const btn = mk('button', 'dfold', `Show ${hidden.length} unchanged lines`);
          btn.type = 'button';
          btn.addEventListener('click', () => {
            const frag = document.createDocumentFragment();
            for (const row of hidden) frag.append(cell(row.l, 'l'), cell(row.r, 'r'));
            btn.replaceWith(frag);
          });
          box.append(btn);
          run.slice(run.length - FOLD_KEEP).forEach(put);
        } else run.forEach(put);
      } else {
        while (j < all.length && !(all[j].l && all[j].l === all[j].r)) j++;
        all.slice(i, j).forEach(put);
      }
      i = j;
    }
    return box;
  }

  const textLines = (text, t) => (text === '' ? [] : numberLines(text.split('\n').map(x => ({ t, text: x }))));

  function renderDiff(d) {
    const entries = d.entries;
    const sum = nbvDiff.summarize(entries);
    const saved = store.get('nbv.diffLayout');
    const state = { layout: saved === 'split' ? 'split' : 'unified', outputs: false };

    document.title = `Compare ${d.title} | nbview`;
    app.innerHTML = `
      <article class="nb diffview">
        <nav class="crumbs">${d.crumbs}</nav>
        <header class="nb-head">
          <h1 class="nb-title">${esc(d.title).replace(/([_.-])/g, '$1<wbr>')}</h1>
          <div class="toolbar">
            <button class="btn" id="d-unified" type="button" aria-pressed="false">Unified</button>
            <button class="btn" id="d-split" type="button" aria-pressed="false">Side by side</button>
            <button class="btn" id="d-outputs" type="button" aria-pressed="false">Show output changes</button>
            <button class="btn" id="d-expand" type="button">Expand unchanged</button>
            <button class="btn" id="d-prev" type="button">Previous change</button>
            <button class="btn" id="d-next" type="button">Next change</button>
            ${d.links || ''}
          </div>
          <p class="nb-meta"><span class="dlabels"></span><span id="d-summary"></span><span id="d-pos" aria-live="polite"></span></p>
        </header>
        <div id="d-body" class="diff"></div>
      </article>`;
    const labels = app.querySelector('.dlabels');
    labels.append(mk('span', 'dl-del', d.labelA), document.createTextNode(' to '), mk('span', 'dl-add', d.labelB));

    const body = document.getElementById('d-body');
    let changes = [], at = -1;

    const isChange = e => e.kind !== 'same' || (state.outputs && e.outputsChanged);

    const sourceLines = e => (e.kind === 'added' ? textLines(e.b.text, 'add') : e.kind === 'removed' ? textLines(e.a.text, 'del') : e.kind === 'modified' ? e.lines : []);
    const outputLinesOf = e => {
      if (e.kind === 'added') return textLines(e.b.outputs, 'add');
      if (e.kind === 'removed') return textLines(e.a.outputs, 'del');
      return e.outputsChanged ? e.outputLines : [];
    };
    const draw = lines => (state.layout === 'split' ? splitBody(numberLines(lines)) : unifiedBody(numberLines(lines)));

    const changeBox = e => {
      const box = mk('section', `dcell dcell-${e.kind}`);
      box.dataset.change = '1';
      box.tabIndex = -1;
      const head = mk('header', 'dcell-head');
      const badge = e.kind === 'same' ? KIND_LABEL.same : KIND_LABEL[e.kind];
      head.append(mk('span', `dbadge ${e.kind}`, badge), mk('span', 'dtype', TYPE_LABEL[(e.b || e.a).type] || 'Cell'));
      const where = e.kind === 'added' ? `new cell ${e.b.index + 1}` : e.kind === 'removed' ? `old cell ${e.a.index + 1}` : e.a.index === e.b.index ? `cell ${e.a.index + 1}` : `cell ${e.a.index + 1} to ${e.b.index + 1}`;
      head.append(mk('span', 'muted', where));
      box.append(head);
      const src = sourceLines(e);
      if (src.length) box.append(draw(src));
      if (state.outputs) {
        const out = outputLinesOf(e);
        if (out.length) { box.append(mk('div', 'dout-label', 'Output')); box.append(draw(out)); }
      }
      return box;
    };

    const groupBox = run => {
      const det = mk('details', 'dgroup');
      det.append(mk('summary', null, `${run.length} unchanged cell${run.length === 1 ? '' : 's'}`));
      let built = false;
      det.addEventListener('toggle', () => {
        if (!det.open || built) return;
        built = true;
        for (const e of run) {
          const c = mk('div', 'dsame');
          c.append(mk('div', 'muted dsame-head', `${TYPE_LABEL[e.b.type] || 'Cell'}, cell ${e.b.index + 1}`));
          c.append(mk('pre', 'dsame-text', e.b.text.length > 20000 ? e.b.text.slice(0, 20000) + '\n...' : e.b.text));
          det.append(c);
        }
      });
      return det;
    };

    const paint = () => {
      body.replaceChildren();
      let run = [];
      const flush = () => { if (run.length) { body.append(groupBox(run)); run = []; } };
      for (const e of entries) {
        if (isChange(e)) { flush(); body.append(changeBox(e)); } else run.push(e);
      }
      flush();
      changes = [...body.querySelectorAll('[data-change]')];
      at = -1;
      document.getElementById('d-pos').textContent = '';
      app.querySelector('.diffview').classList.toggle('is-split', state.layout === 'split');
      document.getElementById('d-split').setAttribute('aria-pressed', String(state.layout === 'split'));
      document.getElementById('d-unified').setAttribute('aria-pressed', String(state.layout === 'unified'));
      document.getElementById('d-outputs').setAttribute('aria-pressed', String(state.outputs));
      const parts = [];
      if (sum.modified) parts.push(`${sum.modified} modified`);
      if (sum.added) parts.push(`${sum.added} added`);
      if (sum.removed) parts.push(`${sum.removed} removed`);
      let text = parts.length ? parts.join(', ') + ` (${sum.same} unchanged)` : `No differences in cell source (${sum.same} cells)`;
      if (!state.outputs && sum.outputsChanged) text += `. Outputs differ in ${sum.outputsChanged} cell${sum.outputsChanged === 1 ? '' : 's'}; use Show output changes to see them`;
      document.getElementById('d-summary').textContent = text;
      if (!entries.length) body.append(mk('p', 'empty', 'Both notebooks are empty.'));
    };

    const go = step => {
      if (!changes.length) return;
      at = (at + step + changes.length) % changes.length;
      const target = changes[at];
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
      document.getElementById('d-pos').textContent = `Change ${at + 1} of ${changes.length}`;
    };

    const setLayout = l => { state.layout = l; store.set('nbv.diffLayout', l); paint(); };
    document.getElementById('d-split').addEventListener('click', () => setLayout('split'));
    document.getElementById('d-unified').addEventListener('click', () => setLayout('unified'));
    document.getElementById('d-outputs').addEventListener('click', () => { state.outputs = !state.outputs; paint(); });
    document.getElementById('d-expand').addEventListener('click', () => body.querySelectorAll('details.dgroup').forEach(x => { x.open = true; }));
    document.getElementById('d-prev').addEventListener('click', () => go(-1));
    document.getElementById('d-next').addEventListener('click', () => go(1));
    paint();
  }

  /* ---------- router ---------- */

  async function route() {
    const id = ++routeId;
    const raw = location.hash.replace(/^#/, '');
    const parts = raw.split('/').filter(Boolean).map(safeDecode);
    document.body.classList.toggle('is-home', parts.length === 0);
    window.scrollTo(0, 0);

    if (!window.marked || !window.DOMPurify) {
      renderError(new ViewError("Couldn't load the rendering libraries", 'A script failed to load. Reload the page, or check for content blockers.'));
      return;
    }

    try {
      if (!parts.length) return renderHome();

      if ((parts[0] === 'url' || parts[0] === 'urls') && parts[1]) {
        return await viewNotebook({ url: nbviewerUrl(parts[0], parts.slice(1).join('/')) }, id);
      }

      if (parts[0] === 'gist' && parts[1]) return await viewGist(parts[1], id);

      if (parts[0] === 'compare') {
        if (!parts[1]) return viewComparePick();
        if (parts[1] === 'links' && parts[2] && parts[3]) return await viewCompareLinks(parts[2], parts[3], id);
        if (parts[1] === 'github' && parts[2] && parts[3] && parts[4]) {
          const cut = parts[4].indexOf('...');
          return await viewCompareGh(parts[2], parts[3], cut < 0 ? '' : parts[4].slice(0, cut), cut < 0 ? '' : parts[4].slice(cut + 3), parts.slice(5).join('/'), id);
        }
      }

      if (parts[0] === 'github' && parts[1]) {
        const [, owner, repo, kind, ref, ...rest] = parts;
        const path = rest.join('/');
        if (!repo) return await viewUser(owner, id);
        if (!kind || !ref) {
          showLoading('Finding the default branch');
          const info = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
          if (!info || typeof info.default_branch !== 'string' || !info.default_branch) {
            throw new ViewError("Couldn't find the default branch", 'GitHub gave an unexpected answer for this repo. Try again later.');
          }
          if (!stale(id)) location.replace(hashFor(owner, repo, 'tree', info.default_branch, ''));
          return;
        }
        if (kind === 'tree') return await viewTree(owner, repo, ref, path, id);
        if (kind === 'blob') {
          // A link to some other file (README.md, a script) shows its folder instead of a JSON error.
          if (!isNbName(path)) { location.replace(hashFor(owner, repo, 'tree', ref, path.split('/').slice(0, -1).join('/'))); return; }
          return await viewNotebook({ owner, repo, ref, path }, id);
        }
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

  const tokError = document.getElementById('token-error');
  const saveBtn = dlg.querySelector('button[value="save"]');

  function openSettings() {
    tokInput.value = store.get('nbv.token') || '';
    tokError.hidden = true;
    dlg.showModal();
    tokInput.focus();
  }

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  saveBtn.addEventListener('click', e => {
    const t = tokInput.value.trim();
    if (!t || TOKEN_OK.test(t)) { tokError.hidden = true; return; }
    e.preventDefault(); // keep the dialog open and say why
    tokError.hidden = false;
    tokInput.focus();
  });
  tokInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
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
  // Compare dialog: choose the version to compare the open notebook with.
  const cmpDlg = document.getElementById('compare-dialog');
  const cmpBase = document.getElementById('compare-base');
  const cmpOther = document.getElementById('compare-other');
  const cmpList = document.getElementById('compare-commits');
  const cmpErr = document.getElementById('compare-error');
  let cmpCtx = null;

  function openCompare(c) {
    cmpCtx = c;
    document.getElementById('compare-file').textContent = c.path;
    document.getElementById('compare-head').textContent = shortRef(c.ref);
    cmpBase.value = '';
    cmpOther.value = '';
    cmpList.replaceChildren();
    cmpErr.hidden = true;
    document.getElementById('compare-load').disabled = false;
    cmpDlg.showModal();
    cmpBase.focus();
  }

  document.getElementById('compare-load').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    cmpErr.hidden = true;
    cmpList.textContent = 'Loading...';
    try {
      const { owner, repo, ref, path } = cmpCtx;
      const items = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=30`);
      if (!Array.isArray(items)) throw new ViewError('Unexpected answer from GitHub', 'The commit list was not in the expected format.');
      cmpList.replaceChildren();
      for (const it of items) {
        if (!it || typeof it.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(it.sha)) continue;
        const c = it.commit || {};
        const when = c.author && typeof c.author.date === 'string' ? c.author.date.slice(0, 10) : '';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'commit-item';
        b.textContent = `${it.sha.slice(0, 7)}  ${clip(String(c.message || '').split('\n')[0], 70)}  ${when}`;
        b.addEventListener('click', () => { cmpBase.value = it.sha; cmpBase.focus(); });
        cmpList.append(b);
      }
      if (!cmpList.children.length) cmpList.textContent = 'No earlier commits found for this file.';
    } catch (err) {
      cmpList.replaceChildren();
      cmpErr.textContent = err.detail || err.message || 'Could not load commits.';
      cmpErr.hidden = false;
      btn.disabled = false;
    }
  });

  document.getElementById('compare-form').addEventListener('submit', e => {
    e.preventDefault();
    const base = cmpBase.value.trim();
    const other = cmpOther.value.trim();
    const fail = (msg, field) => { cmpErr.textContent = msg; cmpErr.hidden = false; field.focus(); };
    if (base && other) return fail('Fill in only one of the two fields.', cmpOther);
    if (other) {
      try {
        const url = notebookUrl(other);
        cmpDlg.close();
        location.hash = compareLinksHash(url, rawUrl(cmpCtx.owner, cmpCtx.repo, cmpCtx.ref, cmpCtx.path));
      } catch (err) { fail(err.detail || err.message, cmpOther); }
      return;
    }
    if (!base || /\s|\.\./.test(base)) return fail('Enter a branch, tag or commit with no spaces, or another notebook.', cmpBase);
    cmpDlg.close();
    location.hash = compareHash(cmpCtx.owner, cmpCtx.repo, base, cmpCtx.ref, cmpCtx.path);
  });
  document.getElementById('compare-cancel').addEventListener('click', () => cmpDlg.close());

  // The toolbar menus (Contents, Export) close on an outside click or Escape.
  document.addEventListener('click', e => {
    for (const m of document.querySelectorAll('.menu[open]')) if (!m.contains(e.target)) m.open = false;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    for (const m of document.querySelectorAll('.menu[open]')) { m.open = false; m.querySelector('summary').focus(); }
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