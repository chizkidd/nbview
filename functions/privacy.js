/* The privacy note: what stays in the browser, what goes to GitHub, and what the site records.
 * Same shell as the two guides, so it carries the viewer's top bar. See functions/_lib/landing.mjs. */

import { render } from './_lib/landing.mjs';

const SPEC = {
  path: '/privacy',
  title: 'Privacy: what nbview stores in your browser | nbview',
  description: 'nbview keeps a GitHub token, your recently opened list and your theme in this browser, sends notebook traffic to GitHub, and records page views without cookies, and counts notebook opens with one word and no identifiers. No accounts, no uploads.',
  body: `<h1>Privacy</h1>
<p class="lede">nbview renders notebooks in your browser. There is no nbview server that receives them, nothing to sign up for, and no cookie banner, because there is nothing to consent to.</p>

<h2>What stays in this browser</h2>
<p>These are kept in your browser's local storage and are never sent to nbview:</p>
<ul>
  <li><strong>A GitHub token</strong>, if you saved one. It is sent only to <code>api.github.com</code>, and only to read the repositories you point nbview at. It never goes to <code>raw.githubusercontent.com</code>, and never to a host that a notebook loads something from.</li>
  <li><strong>Your recently opened list</strong>, and your GitHub account name once you sign in, so the next visit can show them without asking GitHub again.</li>
  <li><strong>Your light or dark choice</strong>, applied before the first paint.</li>
</ul>
<p>Folder listings are also cached for five minutes per tab, so going back to a folder you just viewed does not spend GitHub's hourly limit. That cache goes away with the tab.</p>
<p>To drop the token, open <strong>Private repos</strong> in the top bar and choose <strong>Remove token</strong>. To drop everything, clear site data for nbview.org in your browser: there is no copy anywhere else.</p>

<h2>What leaves the browser, and where it goes</h2>
<ul>
  <li><strong>GitHub.</strong> Folder listings and private notebooks go to <code>api.github.com</code>; public notebook files come from <code>raw.githubusercontent.com</code>. GitHub sees your IP address and, on API calls, your token.</li>
  <li><strong>Images inside a notebook</strong> are held back unless they come from GitHub's own file hosts. Anything else is shown as <em>Image from example.com — Show</em> and is fetched only when you click it, without a Referer, so that host learns neither your address nor which notebook you are reading.</li>
  <li><strong>Interactive Plotly charts</strong> run in a frame the browser isolates from this page: no access to your token, storage or cookies, and no network.</li>
</ul>
<p>Files you choose from your disk are read in the page and never uploaded anywhere.</p>

<h2>What nbview.org records</h2>
<p>nbview has no server of its own: the site is static files served by Cloudflare. Cloudflare's privacy-focused analytics count page views, with no cookies.</p>
<p>The only cookie nbview sets is a sign-in cookie, limited to <code>/auth</code>, that lasts ten minutes and is removed when GitHub sends you back. If you never sign in, nbview sets no cookie at all.</p>

<h2>What nbview counts</h2>
<p>The viewer routes on the address fragment, so a page-view counter cannot see a notebook being opened: ten notebooks read in one tab are one page view. To answer that, the page sends one word to this site's own <code>/count</code> endpoint — <code>open</code> when a notebook is rendered, <code>compare</code> when a comparison is shown, <code>embed</code> when a notebook is opened inside an embed. Nothing goes with it: no notebook, no repository, no address, no user agent, no timestamp.</p>
<p>Those requests move a single number per event, and that number is all nbview stores: no row per visit, no cookie, nothing that could follow you between pages, notebooks or visits. Cloudflare serves the request the way it serves any other request to this site. Counting is skipped entirely when your browser sends Do Not Track or Global Privacy Control.</p>
<p>On a deployment with no counter storage configured, the endpoint answers and records nothing.</p>

<h2>Signing in with GitHub</h2>
<p>Signing in asks GitHub for a token. The one step that touches a server is swapping GitHub's one-time code for that token; the token is then stored in your browser, not on a server. Signing out revokes it with GitHub.</p>

<h2>Questions, and security reports</h2>
<p>Security problems: see <a href="/.well-known/security.txt">security.txt</a>. Anything else: open an issue on <a href="https://github.com/chizkidd/nbview/issues">GitHub</a>.</p>

<p class="doc-foot">Written to be read, not to be survived. <a href="/">Open the viewer</a>, read the two guides on <a href="/view-ipynb-from-github">opening a notebook from GitHub</a> and <a href="/compare-jupyter-notebooks">comparing two notebooks</a>, or see <a href="https://github.com/chizkidd/nbview/blob/main/CHANGELOG.md">what changed</a>.</p>`,
};

export const onRequest = ({ request, env }) => render(request, env, SPEC);
