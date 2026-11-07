/* Identifier-free counters for the two things a page-view counter cannot see: a notebook was opened, and a
 * comparison was shown. The viewer routes on the address fragment, so Cloudflare's beacon only ever counts the
 * document that arrived: a reader opening ten notebooks in one tab is one page view.
 *
 * One word from a fixed list is all this endpoint takes. Nothing else is read from the request, and nothing about
 * the visitor is stored: no address, no user agent, no notebook or repository name, no cookie, no per-visit row.
 * The totals are a single number per event, in the KV binding COUNTS (key "counts:<event>").
 *
 * Without that binding the endpoint still answers 204 and records nothing, so a deployment that has not opted in
 * is unaffected. GET /count prints the totals as an ordinary public page, inside the app's shell like the guides;
 * the same numbers are available as JSON at /count?format=json for anything that has to read them.
 */

import { render } from '../_lib/landing.mjs';

const EVENTS = ['open', 'compare', 'embed'];

// What each word means, in the order a reader is most likely to care about.
const MEANING = {
  open: 'a notebook is rendered in the viewer',
  compare: 'a comparison between two notebooks is shown',
  embed: 'a notebook is opened inside an embed',
};

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...HEADERS },
});
const empty = (status = 204) => new Response(null, { status, headers: HEADERS });

const figure = n => new Intl.NumberFormat('en-US').format(n);

// One read and one write. KV has no atomic increment, so two opens in the same instant can land as one: this is a
// floor on the truth, which is all it is asked to be.
async function bump(kv, name) {
  const key = 'counts:' + name;
  const next = (Number(await kv.get(key)) || 0) + 1;
  await kv.put(key, String(next));
  return next;
}

function page(enabled, totals) {
  const rows = EVENTS.map(e =>
    `    <tr><td><code>${e}</code></td><td>${figure(totals[e])}</td><td>${MEANING[e]}</td></tr>`).join('\n');
  const off = enabled ? '' : `
<p><strong>Counters are not configured on this deployment.</strong> The viewer still sends its one word and this endpoint answers, but it records nothing, so every total here is zero.</p>`;
  return `<h1>nbview counters</h1>
<p class="lede">How many notebooks have been opened, how many comparisons shown, and how many embeds loaded on this deployment. One number per event, and nothing kept per visit.</p>${off}

<table class="doc-table">
  <thead><tr><th>Event</th><th>Count</th><th>Sent when</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>

<p>Each count is one request from one viewer, and that is everything it holds: no address, no user agent, no notebook, no repository, no cookie, no timestamp. Counter storage has no atomic increment, so two events in the same instant can land as one, and these totals are a floor rather than an exact tally.</p>
<p>A browser that sends Do Not Track or Global Privacy Control is not counted at all, and a notebook opened with JavaScript off sends nothing. <a href="/privacy">The privacy note</a> covers the rest of what the site keeps and what it sends.</p>
<p>To read the same numbers from a script, ask for JSON: <code>/count?format=json</code> returns <code>{"enabled":true,"totals":{"open":0,"compare":0,"embed":0}}</code> with the real figures.</p>`;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const name = url.pathname.replace(/^\/count\/?/, '').split('/')[0];

  if (!name) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return empty(405);
    const totals = {};
    for (const event of EVENTS) {
      totals[event] = env.COUNTS ? (Number(await env.COUNTS.get('counts:' + event)) || 0) : 0;
    }
    const accept = (request.headers.get('accept') || '').toLowerCase();
    if (url.searchParams.get('format') === 'json' || accept.includes('application/json')) {
      return json({ enabled: Boolean(env.COUNTS), totals });
    }
    const res = await render(request, env, {
      path: '/count',
      title: 'Counters: notebooks opened and compared | nbview',
      description: 'Public totals for nbview: notebooks opened, comparisons shown and embeds loaded. One number per event, nothing stored per visitor, no account needed.',
      body: page(Boolean(env.COUNTS), totals),
    });
    // The guides may be cached; a page of live numbers may not.
    const headers = new Headers(res.headers);
    headers.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  }

  if (!EVENTS.includes(name)) return empty(404);
  // A link, a prefetch or an image tag must not be able to add to a counter.
  if (request.method !== 'POST') return empty(405);
  // Another site cannot inflate the totals by posting at them; a same-origin beacon may omit Origin entirely.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return empty(403);

  if (env.COUNTS) {
    try { await bump(env.COUNTS, name); } catch { /* a counter must never fail the page that sent it */ }
  }
  return empty(204);
}
