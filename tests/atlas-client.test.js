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
