'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { handleAtlas } = require('../api/atlas.js');
const root = path.join(__dirname, '..');

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error('view did not reach its expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function page(t, query = '', delay = async () => {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'web/atlas.html'), 'utf8'), {
    url: `http://localhost/atlas.html${query}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const errors = [];
  dom.window.TextEncoder = TextEncoder;
  // jsdom has no Resource Timing implementation; real measurements use the browser.
  dom.window.performance.getEntriesByType = () => [];
  dom.window.addEventListener('error', event => errors.push(event.message));
  dom.window.fetch = async url => {
    const params = new URL(url, 'http://localhost').searchParams;
    await delay(params);
    const result = handleAtlas(params);
    return { ok: result.status === 200, status: result.status, json: async () => result.body };
  };
  for (const script of ['console-ui.js', 'temporal-graph.js', 'atlas-model.js', 'atlas-view.js']) {
    dom.window.eval(fs.readFileSync(path.join(root, 'web', script), 'utf8'));
  }
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); assert.deepEqual(errors, []); });
  return dom;
}

test('regions, focused top-k, exact row inspection and list fallback share one frame', async t => {
  const dom = page(t, '?candidate=004c9f6b7ecc1c48c8e4&source=cncf&year=2024&top_k=2');
  const document = dom.window.document;
  await waitFor(() => document.querySelectorAll('.atlas-candidate-list button').length === 2);
  assert.match(document.getElementById('atlas-frame-label').textContent, /top 2 by shared placements/);
  assert.equal(document.querySelectorAll('.constellation-node').length, 3);
  document.querySelector('.atlas-candidate-list button').click();
  await waitFor(() => document.querySelector('.atlas-premise'));
  assert.equal(document.querySelector('#atlas-inspector').dataset.frameId,
    document.querySelector('#atlas-frame-label').dataset.frameId);
  assert.equal(document.querySelectorAll('.atlas-premise a').length, 3);
  document.getElementById('atlas-list-toggle').click();
  assert.equal(document.querySelector('.constellation-map'), null);
  assert.equal(document.querySelectorAll('.atlas-candidate-list button').length, 2);
});

test('pending and late responses cannot move the committed graph under a different year', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '?candidate=004c9f6b7ecc1c48c8e4&source=cncf&year=2024', async params => {
    if (params.get('mode') === 'focus' && params.get('year') === '2023') await pending;
  });
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.constellation-map'));
  const frame = document.getElementById('atlas-frame-label').dataset.frameId;
  document.getElementById('atlas-previous').click();
  assert.match(document.getElementById('atlas-frame-label').textContent, /2024/);
  assert.equal(document.getElementById('atlas-frame-label').dataset.frameId, frame);
  document.getElementById('atlas-next').click();
  await waitFor(() => !document.getElementById('atlas-status').textContent);
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.getElementById('atlas-frame-label').dataset.frameId, frame);
  assert.match(document.getElementById('atlas-frame-label').textContent, /2024/);
});

test('byte-bounded cache evicts old entries and disposal prevents a pending paint', async t => {
  const dom = page(t);
  await waitFor(() => dom.window.document.querySelector('.atlas-region'));
  const cache = dom.window.LogPoseAtlasModel.createCache(60);
  cache.put('a', { text: 'a'.repeat(20) });
  cache.put('b', { text: 'b'.repeat(20) });
  assert.equal(cache.get('a'), null);
  assert(cache.usage().bytes <= 60);
  cache.clear(); assert.equal(cache.usage().bytes, 0);
  const before = dom.window.document.getElementById('atlas-frame-label').textContent;
  dom.window.document.getElementById('atlas-next').click();
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(dom.window.document.getElementById('atlas-frame-label').textContent, before);
});

test('disposal also cancels initial discovery and cannot append revision controls later', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '', async params => { if (params.get('mode') === 'discover') await pending; });
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  release();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(dom.window.document.querySelectorAll('#atlas-revision option').length, 0);
  assert.equal(dom.window.document.querySelectorAll('.atlas-region').length, 0);
});

test('reduced motion skips accepted-frame fades', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '', async () => pending);
  let animations = 0;
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.Element.prototype.animate = () => { animations += 1; };
  release();
  await waitFor(() => dom.window.document.querySelector('.atlas-region'));
  assert.equal(animations, 0);
});
