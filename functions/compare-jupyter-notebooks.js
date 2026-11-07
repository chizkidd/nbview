/* Landing page for "compare two jupyter notebooks": real HTML, not the app shell. See functions/_lib/landing.mjs. */

import { render } from './_lib/landing.mjs';

const SPEC = {
  path: '/compare-jupyter-notebooks',
  title: 'Compare two Jupyter notebooks in the browser | nbview',
  description: 'Diff two Jupyter notebooks cell by cell in the browser: added code, changed outputs and edited markdown, from two GitHub links, branches, tags or commits.',
  body: `<h1>Compare two Jupyter notebooks</h1>
<p class="lede">nbview shows what changed between two <code>.ipynb</code> files, cell by cell, in the browser. Neither notebook is uploaded: each one is read from GitHub, a gist or a link by the browser that is showing it.</p>

<h2>How to compare</h2>
<ol>
  <li>Open <a href="/#/compare">nbview's compare page</a>, or choose <strong>Compare</strong> in the toolbar of any notebook you already have open.</li>
  <li>Paste a link to each notebook, or pick two <code>.ipynb</code> files from your disk. The two can sit in different repositories, branches or folders.</li>
  <li>Read the diff. Each changed cell is shown with the version it came from, and a swap button above it flips the two sides.</li>
</ol>
<p>A link can carry the comparison itself, so a review comment or a class note can point at it. The <code>#</code> is part of the address: the viewer routes on it, so a link without one lands on the home page.</p>
<pre><code>/#/compare/github/{owner}/{repo}/{older}...{newer}/{path}.ipynb
/#/compare/links/{first-notebook-link}/{second-notebook-link}</code></pre>

<h2>What the diff shows</h2>
<ul>
  <li>Cells that were added, removed or modified, kept in their original order so the story of the notebook still reads top to bottom.</li>
  <li>Line-level changes inside a modified code cell, rather than the whole cell marked as replaced.</li>
  <li>Changed outputs, once <strong>Show output changes</strong> is pressed. A cell whose code is identical but whose printed result, table, chart or traceback differs then shows up as a change, which is often the only evidence that a run went differently.</li>
  <li>Markdown edits, next to the code edits, in the same view.</li>
</ul>

<h2>Private repos, and notebooks on your disk</h2>
<p>Files you choose from your disk are read in the page and never leave the browser. Private repositories work once a fine-grained GitHub token with <strong>Contents: Read-only</strong> is saved: the token stays in this browser and is sent only to <code>api.github.com</code>.</p>

<h2>How this compares with other notebook diffs</h2>
<table class="doc-table">
  <thead><tr><th>Tool</th><th>Where it runs</th><th>What it needs</th></tr></thead>
  <tbody>
    <tr><td>nbdime</td><td>On your machine, as a Python package, CLI or JupyterLab extension</td><td>The notebooks already downloaded, plus a Python install</td></tr>
    <tr><td>ReviewNB</td><td>As a GitHub App, on pull requests</td><td>Install access to the repositories you want to review</td></tr>
    <tr><td>nbview</td><td>In the browser, given two links or two files</td><td>No install or app; public notebooks need nothing, private ones a read-only token</td></tr>
  </tbody>
</table>

<div class="doc-cta">
  <a class="btn primary" href="/#/compare">Compare two notebooks</a>
  <a class="btn" href="/view-ipynb-from-github">View .ipynb files from GitHub</a>
</div>

<p class="doc-foot">nbview is a free, open-source notebook viewer. It is an independent project and is not affiliated with Project Jupyter or nbviewer. <a href="/">Open the viewer</a>, read the <a href="https://github.com/chizkidd/nbview#readme">README</a>, or see <a href="https://github.com/chizkidd/nbview/blob/main/CHANGELOG.md">what changed</a>.</p>`,
};

export const onRequest = ({ request, env }) => render(request, env, SPEC);
