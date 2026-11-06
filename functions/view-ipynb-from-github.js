/* Landing page for "view ipynb from github": real HTML, not the app shell. See functions/_lib/landing.mjs. */

import { page, respond } from './_lib/landing.mjs';

const HTML = page({
  path: '/view-ipynb-from-github',
  title: 'View .ipynb files from GitHub in the browser | nbview',
  description: 'Open a .ipynb file from GitHub, a gist or any link in your browser. Saved outputs, math and images render as written. No upload, no install, no token for public repos.',
  body: `<h1>View .ipynb files from GitHub</h1>
<p class="lede">nbview opens a Jupyter notebook from a GitHub repo, a gist or a direct link and draws it in your browser, with the outputs that were saved into the file. Nothing is uploaded, and nothing has to be installed.</p>

<h2>Three ways to open a notebook</h2>
<ul>
  <li>Paste a GitHub link, or <code>owner/repo</code>, or a path ending in <code>.ipynb</code> into the box on <a href="/">the home page</a>.</li>
  <li>Change <code>nbviewer.org</code> to <code>nbview.org</code> in a link you already have. The <code>/github/...</code>, <code>/gist/...</code> and <code>/url/...</code> paths all work the same way.</li>
  <li>Link directly. A GitHub notebook is
<pre><code>/github/{owner}/{repo}/blob/{branch}/{path}.ipynb</code></pre>
and <code>?cell=N</code> opens it scrolled to cell N.</li>
</ul>

<h2>What renders</h2>
<ul>
  <li>Markdown cells, including LaTeX math and inline HTML that the notebook already contains.</li>
  <li>Code with syntax highlighting, optional line numbers and wrapped lines.</li>
  <li>Saved output: printed text, tables, images and attachments, charts, and error output with its traceback.</li>
  <li>A link that keeps pointing at the right version: <strong>Copy link</strong> names the commit the notebook was read at, so a link still shows the same notebook after the branch moves on.</li>
</ul>

<h2>What GitHub's own file view does not do</h2>
<p>GitHub can display many notebooks in its web interface. nbview adds the things a review, a paper or a blog post usually needs:</p>
<ul>
  <li>a diff against another version of the same file, or against a different notebook</li>
  <li>an embeddable frame at <code>/embed/{owner}/{repo}/blob/{branch}/{path}.ipynb</code> that other sites may frame</li>
  <li>exports: a clean <code>.ipynb</code> without outputs, a <code>.py</code> script, Markdown, a standalone HTML page, and print or Save as PDF</li>
  <li>notebooks from private repos without installing a GitHub App, using a read-only token you create</li>
  <li>an installable app that reopens the last notebook offline, with light and dark themes</li>
</ul>

<h2>What it cannot do</h2>
<ul>
  <li>Run code. nbview has no kernel; it shows the outputs that were saved into the file.</li>
  <li>Invent outputs that were never saved. A notebook committed with cleared outputs shows its code only.</li>
  <li>Play interactive widgets. Widget output appears as the static state that was saved.</li>
</ul>

<h2>What it does with your notebook</h2>
<p>Public files are fetched from <code>raw.githubusercontent.com</code> by your browser, and private files from <code>api.github.com</code> with a token kept in this browser's storage. There is no nbview server holding a copy. Remote images inside a notebook are held behind a button that names their host, so opening a notebook does not contact the sites it embeds until you ask it to.</p>

<div class="doc-cta">
  <a class="btn primary" href="/">Open a notebook</a>
  <a class="btn" href="/compare-jupyter-notebooks">Compare two notebooks</a>
</div>

<p class="doc-foot">nbview is a free, open-source notebook viewer. It is an independent project and is not affiliated with Project Jupyter or nbviewer. Read the <a href="https://github.com/chizkidd/nbview#readme">README</a>, or see <a href="https://github.com/chizkidd/nbview/blob/main/CHANGELOG.md">what changed</a>.</p>`,
});

export const onRequest = ({ request }) => respond(request, HTML);
