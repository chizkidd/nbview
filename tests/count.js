// Tests for the counters: a fixed list of event names, one number per event, nothing about the visitor, and a
// deployment without counter storage is unaffected. No browser and no network.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://nbview.org';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, detail) => {
  if (!cond) throw new Error(detail === undefined ? 'assertion failed' : typeof detail === 'string' ? detail : JSON.stringify(detail));
};

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Stands in for the KV binding: enough to see keys written and values read back.
function kv(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async put(k, v) { data.set(k, String(v)); },
  };
}

const post = (fn, p, env, headers = {}) => fn.onRequest({ request: new Request(ORIGIN + p, { method: 'POST', headers }), env });
const get = (fn, p, env) => fn.onRequest({ request: new Request(ORIGIN + p), env });

(async () => {
  const fn = await import(pathToFileURL(path.join(ROOT, 'functions', 'count', '[[path]].js')).href);

  test('a notebook open and a comparison each add one to their own counter', async () => {
    const store = kv();
    assert((await post(fn, '/count/open', { COUNTS: store })).status === 204, 'an open was not accepted');
    await post(fn, '/count/open', { COUNTS: store });
    await post(fn, '/count/compare', { COUNTS: store });
    assert(store.data.get('counts:open') === '2', `open is ${store.data.get('counts:open')}, expected 2`);
    assert(store.data.get('counts:compare') === '1', `compare is ${store.data.get('counts:compare')}, expected 1`);
  });

  test('nothing about the visitor is written: only one counter key per event', async () => {
    const store = kv();
    await post(fn, '/count/open', { COUNTS: store }, {
      origin: ORIGIN,
      referer: ORIGIN + '/#/github/o/r/blob/main/t.ipynb',
      'user-agent': 'Mozilla/5.0 (some browser)',
      'cf-connecting-ip': '203.0.113.7',
    });
    assert(store.data.size === 1, `wrote ${[...store.data.keys()].join(', ')}`);
    assert(store.data.get('counts:open') === '1', 'counter value');
    assert([...store.data.keys()].every(k => /^counts:(open|compare|embed)$/.test(k)), [...store.data.keys()].join(', '));
  });

  test('an event the list does not contain is refused and writes nothing', async () => {
    const store = kv();
    const res = await post(fn, '/count/owner%2Frepo%2Fnotebook.ipynb', { COUNTS: store });
    assert(res.status === 404, `status ${res.status}`);
    assert(store.data.size === 0, 'a refused event still wrote something');
  });

  test('another origin cannot add to the totals', async () => {
    const store = kv();
    const res = await post(fn, '/count/open', { COUNTS: store }, { origin: 'https://evil.example' });
    assert(res.status === 403, `status ${res.status}`);
    assert(store.data.size === 0, 'a foreign origin wrote something');
  });

  test('GET on an event path is refused, so a link or a prefetch cannot inflate it', async () => {
    const store = kv();
    const res = await get(fn, '/count/open', { COUNTS: store });
    assert(res.status === 405, `status ${res.status}`);
    assert(store.data.size === 0, 'a GET wrote something');
  });

  test('GET /count reports the totals, uncached, and says so when nothing is configured', async () => {
    const on = await get(fn, '/count', { COUNTS: kv({ 'counts:open': '7', 'counts:embed': '2' }) });
    const body = await on.json();
    assert(body.enabled === true, JSON.stringify(body));
    assert(body.totals.open === 7 && body.totals.embed === 2 && body.totals.compare === 0, JSON.stringify(body.totals));
    assert(on.headers.get('cache-control') === 'no-store', 'the totals are cacheable');
    const off = await (await get(fn, '/count', {})).json();
    assert(off.enabled === false && off.totals.open === 0, JSON.stringify(off));
  });

  test('a deployment without counter storage still answers 204, and sets no cookie', async () => {
    const res = await post(fn, '/count/open', {});
    assert(res.status === 204, `status ${res.status}`);
    for (const r of [res, await get(fn, '/count', {})]) {
      assert(!r.headers.get('set-cookie'), 'a cookie was set');
      assert(r.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
    }
  });

  test('the page sends only names the endpoint accepts, once per view, and honours a tracking opt-out', () => {
    const app = read('assets', 'js', 'app.js');
    const sent = [...app.matchAll(/count\('([a-z]+)'\)/g)].map(m => m[1]);
    assert(sent.includes('open') && sent.includes('compare'), `the page counts ${sent.join(', ') || 'nothing'}`);
    assert(sent.length === new Set(sent).size, `one of ${sent.join(', ')} is counted twice`);
    const allowed = JSON.parse(/const EVENTS = (\[[^\]]*\])/.exec(read('functions', 'count', '[[path]].js'))[1].replace(/'/g, '"'));
    for (const name of sent) assert(allowed.includes(name), `the page sends '${name}', which the endpoint refuses`);
    assert(/sendBeacon\('\/count\/' \+ name\)/.test(app), 'the beacon is not same-origin');
    assert(/navigator\.doNotTrack === '1'/.test(app), 'no Do Not Track check');
    assert(/globalPrivacyControl/.test(app), 'no Global Privacy Control check');
  });

  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS  ' + t.name); }
    catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + e.message.slice(0, 400)); }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FAIL  harness\n      ' + (e && e.message)); process.exit(1); });
