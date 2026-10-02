'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadClient() {
  const context = vm.createContext({ URLSearchParams, TextEncoder });
  for (const name of ['atlas-model.js', 'atlas-client.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../web/${name}`), 'utf8'), context,
      { filename: name });
  }
  return { model: context.LogPoseAtlasModel, create: context.LogPoseAtlasClient.create };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function client(fetchImpl, options = {}) {
  const loaded = loadClient();
  return loaded.create({
    cache: loaded.model.createCache(),
    fetchImpl,
    fallbackMessage: status => `request failed (${status})`,
    buildMismatchMessage: 'build changed',
    ...options
  });
}

test('atlas document loads the client before either view can request data', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/atlas.html'), 'utf8');
  const clientIndex = html.indexOf('src="./atlas-client.js"');
  assert(clientIndex > html.indexOf('src="./atlas-model.js"'));
  assert(clientIndex < html.indexOf('src="./atlas-view.js"'));
});

test('successful requests reuse the byte cache and isolate query frames', async () => {
  const calls = [];
  const atlas = client(async (url, options) => {
    calls.push({ url, options });
    const params = new URL(url, 'https://example.test').searchParams;
    return response({ build_id: params.get('build_id'), query: params.get('query') });
  });
  const first = await atlas.request({ mode: 'search', build_id: 'build-a', query: 'data' });
  const cached = await atlas.request({ mode: 'search', build_id: 'build-a', query: 'data' });
  const otherQuery = await atlas.request({ mode: 'search', build_id: 'build-a', query: 'cloud' });
  const otherFrame = await atlas.request({ mode: 'search', build_id: 'build-b', query: 'data' });

  assert.equal(calls.length, 3);
  assert.strictEqual(cached, first);
  assert.equal(otherQuery.query, 'cloud');
  assert.equal(otherFrame.build_id, 'build-b');
  assert.equal(calls[0].options.headers.accept, 'application/json');
  atlas.clear();
  await atlas.request({ mode: 'search', build_id: 'build-a', query: 'data' });
  assert.equal(calls.length, 4);
});

test('network, JSON, HTTP, and build failures never enter the cache', async () => {
  for (const firstFailure of ['network', 'json']) {
    let calls = 0;
    const transport = client(async () => {
      calls += 1;
      if (calls === 1 && firstFailure === 'network') throw new TypeError('offline');
      if (calls === 1) return { ok: true, status: 200,
        json: async () => { throw new SyntaxError('invalid JSON'); } };
      return response({ build_id: 'build-a', value: 'recovered' });
    });
    await assert.rejects(transport.request({ mode: 'focus', build_id: 'build-a' }));
    assert.equal((await transport.request({ mode: 'focus', build_id: 'build-a' })).value,
      'recovered');
    assert.equal(calls, 2);
  }

  let errorCalls = 0;
  const errors = client(async () => {
    errorCalls += 1;
    return errorCalls === 1 ? response({ error: 'unavailable' }, 503)
      : response({ build_id: 'build-a', value: 'recovered' });
  });
  await assert.rejects(errors.request({ mode: 'focus', build_id: 'build-a' }),
    { message: 'unavailable' });
  assert.equal((await errors.request({ mode: 'focus', build_id: 'build-a' })).value, 'recovered');
  assert.equal(errorCalls, 2);

  let mismatchCalls = 0;
  const mismatch = client(async () => {
    mismatchCalls += 1;
    return response({ build_id: mismatchCalls === 1 ? 'other-build' : 'build-a' });
  });
  await assert.rejects(mismatch.request({ mode: 'focus', build_id: 'build-a' }),
    { message: 'build changed' });
  assert.equal((await mismatch.request({ mode: 'focus', build_id: 'build-a' })).build_id, 'build-a');
  assert.equal(mismatchCalls, 2);
});

test('fallback errors retain provider wording and signals reach fetch unchanged', async () => {
  const fallback = client(async () => response({}, 502), {
    fallbackMessage: () => 'reviewed claims are unavailable'
  });
  await assert.rejects(fallback.request({ mode: 'discover' }),
    { message: 'reviewed claims are unavailable' });

  const controller = new AbortController();
  let observedSignal;
  const pending = client((_url, options) => {
    observedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  }).request({ mode: 'discover' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.strictEqual(observedSignal, controller.signal);
});

test('co-listing tiers are discrete counts and never mutate evidence or imply confidence', () => {
  const { model } = loadClient();
  for (const [count, key] of [[1, 'one'], [2, 'few'], [3, 'few'], [4, 'many'], [40, 'many'],
    [0, 'unknown'], [null, 'unknown'], [1.5, 'unknown']]) {
    assert.equal(model.placementTier(count).key, key);
  }
  const source = { operation: 'focus', versions: { layout: 'layout-a' },
    selection: { source: 'cncf', year: 2024, temporal_mode: 'snapshot' },
    focus: { id: 'company', name: 'Company' }, position: { x: .2, y: .3 }, focus_status: 'observed',
    edges: [{ candidate_id: 'neighbor', supporting_placements: 3,
      candidate: { id: 'neighbor', name: 'Neighbor' }, position: { x: .6, y: .7 } }] };
  const original = JSON.stringify(source);
  const frame = model.graphFrame(source);
  assert.equal(frame.edges[0].support_tier, 'few');
  assert.match(frame.nodes[0].connection_label, /3 shared placements/);
  assert.match(frame.semantics.edgeNote, /not economic strength, confidence or independent corroboration/);
  assert.equal(JSON.stringify(source), original);
});

test('company snapshot routes require an explicit reviewed pilot identity', () => {
  const { model } = loadClient();
  assert.equal(model.companyRoute({ id: 'lead', name: 'Unreviewed', identity_review: null }, 2024), null);
  assert.equal(model.companyRoute({ id: 'lead', name: 'Provider', identity_review: { id: 'review-1' } }, 2024), null);
  const route = new URL(model.companyRoute({ name: 'Datadog',
    identity_review: { id: 'review-12', pilot_slug: 'datadog' } }, 2024), 'https://example.test/');
  assert.equal(route.searchParams.get('company'), 'datadog');
  assert.equal(route.searchParams.get('year'), '2024');
  assert.equal(route.searchParams.get('view'), 'explore');
  assert.equal(route.hash, '#company-detail');
});

test('relationship descriptions distinguish dated co-listing evidence from business ties', () => {
  const { model } = loadClient();
  const result = { focus: { name: 'GitLab' }, selection: { source: 'cncf', year: 2024, temporal_mode: 'snapshot' } };
  const edge = { candidate: { name: 'Semaphore' }, supporting_placements: 1 };
  const initial = model.connectionDescription(result, edge);
  assert.match(initial, /GitLab and Semaphore are co-listed in the same source categories in CNCF inventory 2024/);
  assert.match(initial, /Evidence: 1 shared placement/);
  assert.match(initial, /does not establish competition, partnership or adoption/);
  const evidence = { premises: [{ placement: { category: 'App Definition and Development / Continuous Integration & Delivery',
    source: 'cncf', inventory_year: 2024 } }], next_cursor: 'more' };
  const before = JSON.stringify(evidence);
  const exact = model.connectionDescription(result, edge, evidence);
  assert.match(exact, /co-listed in “App Definition and Development \/ Continuous Integration & Delivery” \(CNCF 2024\)/);
  assert.match(exact, /more source placements are available/);
  assert.equal(JSON.stringify(evidence), before);
  assert.match(model.connectionDescription({ ...result, selection: { ...result.selection, temporal_mode: 'accumulated' } },
    { ...edge, supporting_placements: null }), /placement count unavailable in CNCF inventories through 2024/);
});
