/* Identifier-free counters for the two things a page-view counter cannot see: a notebook was opened, and a
 * comparison was shown. The viewer routes on the address fragment, so Cloudflare's beacon only ever counts the
 * document that arrived: a reader opening ten notebooks in one tab is one page view.
 *
 * One word from a fixed list is all this endpoint takes. Nothing else is read from the request, and nothing about
 * the visitor is stored: no address, no user agent, no notebook or repository name, no cookie, no per-visit row.
 * The totals are a single number per event, in the KV binding COUNTS (key "counts:<event>").
 *
 * Without that binding the endpoint still answers 204 and records nothing, so a deployment that has not opted in
 * is unaffected. GET /count returns the totals it holds.
 */

const EVENTS = ['open', 'compare', 'embed'];

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...HEADERS },
});
const empty = (status = 204) => new Response(null, { status, headers: HEADERS });

// One read and one write. KV has no atomic increment, so two opens in the same instant can land as one: this is a
// floor on the truth, which is all it is asked to be.
async function bump(kv, name) {
  const key = 'counts:' + name;
  const next = (Number(await kv.get(key)) || 0) + 1;
  await kv.put(key, String(next));
  return next;
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
    return json({ enabled: Boolean(env.COUNTS), totals });
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
