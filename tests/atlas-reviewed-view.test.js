'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createReviewedAtlasHandler } = require('../api/atlas-reviewed.js');
const root = path.join(__dirname, '..');

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error('reviewed view did not reach its expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function page(t, query = '', delay = async () => {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'web/atlas.html'), 'utf8'), {
    url: `http://localhost/atlas.html?layer=reviewed${query}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const errors = [];
  const handler = createReviewedAtlasHandler();
  dom.window.TextEncoder = TextEncoder;
  dom.window.addEventListener('error', event => errors.push(event.message));
  dom.window.fetch = async url => {
    const params = new URL(url, 'http://localhost').searchParams;
    await delay(params);
    const result = handler(params);
    return { ok: result.status === 200, status: result.status, json: async () => result.body };
  };
  for (const script of ['console-ui.js', 'research-model.js', 'temporal-graph.js', 'atlas-model.js', 'atlas-reviewed-view.js', 'atlas-view.js']) {
    dom.window.eval(fs.readFileSync(path.join(root, 'web', script), 'utf8'));
  }
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); handler.close();
    assert.deepEqual(errors, []);
  });
  return dom;
}

test('reviewed focus keeps typed claims, exact premises and explicit identity separate from inventory', async t => {
  const dom = page(t, '&entity=snowflake&neighbor=dbt-labs&cutoff=2022-02-24');
  const document = dom.window.document;
  await waitFor(() => document.querySelectorAll('.atlas-claim').length === 2);
  assert.equal(document.querySelectorAll('.constellation-node').length, 2);
  assert.equal(document.querySelectorAll('.constellation-node.has-label').length, 2);
  assert.match(document.querySelector('#atlas-frame-label').textContent, /source.*2022-02-24.*1 of 1 eligible neighbors/);
  assert.equal(document.querySelector('#atlas-inspector').dataset.frameId,
    document.querySelector('#atlas-frame-label').dataset.frameId);
  const inspector = document.querySelector('#atlas-inspector');
  assert.match(inspector.textContent, /announced partnership with/);
  assert.match(inspector.textContent, /invested in/);
  assert.match(inspector.textContent, /no reviewed inventory candidate mapping/);
  assert.match(inspector.textContent, /64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece/);
  assert.equal(inspector.querySelectorAll('a[href*="dataFamily=topology"]').length, 2);
  document.querySelector('#atlas-list-toggle').click();
  assert.equal(document.querySelector('.constellation-map'), null);
  assert.equal(inspector.querySelectorAll('.atlas-claim').length, 2);
  assert.equal(document.querySelector('#atlas-reviewed-link').getAttribute('aria-current'), 'page');
});

test('reviewed candidate deep links enforce source publication cutoff and opt-in hypotheses', async t => {
  const dom = page(t, '&candidate=4d9ade2bfb2aa6cb4afb&cutoff=2025-02-19');
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.constellation-map'));
  assert.equal(document.querySelectorAll('.atlas-candidate-list button').length, 0);
  const cutoff = document.querySelector('#atlas-cutoff'); cutoff.value = '2025-02-20';
  cutoff.dispatchEvent(new dom.window.Event('change'));
  await waitFor(() => document.querySelectorAll('.atlas-candidate-list button').length === 1);
  const basis = document.querySelector('#atlas-basis'); basis.value = 'all';
  basis.dispatchEvent(new dom.window.Event('change'));
  await waitFor(() => document.querySelectorAll('.atlas-candidate-list button').length === 2);
  document.querySelector('[data-entity="snowflake"]').click();
  await waitFor(() => document.querySelector('.is-hypothesis'));
  assert.match(document.querySelector('.atlas-claim-status').textContent, /^hypothesis$/);
  assert.equal(document.querySelectorAll('.atlas-premise').length, 2);
});

test('publication comparison survives a deep link and never labels a relationship start', async t => {
  const dom = page(t, '&mode=compare&entity=datadog&basis=all&compare_cutoff=2024-12-31&cutoff=2025-02-20');
  const document = dom.window.document;
  await waitFor(() => document.querySelector('#atlas-scene h3'));
  assert.match(document.querySelector('#atlas-scene').textContent, /2 newly eligible claims/);
  assert.match(document.querySelector('#atlas-scene').textContent, /not relationship activity/);
  assert.match(document.querySelector('#atlas-frame-label').textContent, /2 claim changes/);
  document.querySelector('#atlas-scene button').click();
  await waitFor(() => document.querySelectorAll('.atlas-candidate-list button').length === 2);
});

test('late cutoff responses cannot replace the visible frame or its evidence', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '&entity=datadog&neighbor=elastic&cutoff=2025-02-20', async params => {
    if (params.get('mode') === 'focus' && params.get('cutoff') === '2024-03-26') await pending;
  });
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-claim'));
  const frame = document.querySelector('#atlas-frame-label').dataset.frameId;
  document.querySelector('#atlas-previous').click();
  assert.equal(document.querySelector('#atlas-frame-label').dataset.frameId, frame);
  assert.equal(document.querySelectorAll('.atlas-claim').length, 1);
  document.querySelector('#atlas-next').click();
  await waitFor(() => !document.querySelector('#atlas-status').textContent);
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.querySelector('#atlas-frame-label').dataset.frameId, frame);
  assert.match(document.querySelector('#atlas-frame-label').textContent, /2025-02-20/);
});

test('unsupported deep-link clocks and missing immutable builds fail visibly', async t => {
  const dom = page(t, '&entity=datadog&year=2024');
  await waitFor(() => !dom.window.document.querySelector('#atlas-retry').hidden);
  assert.match(dom.window.document.querySelector('#atlas-status').textContent, /do not support year/);
  assert.equal(dom.window.document.querySelector('.constellation-map'), null);
  const missing = page(t, `&entity=datadog&build_id=${'0'.repeat(64)}`);
  await waitFor(() => !missing.window.document.querySelector('#atlas-retry').hidden);
  assert.match(missing.window.document.querySelector('#atlas-status').textContent, /not hosted/);
});

test('saved investigation contains the visible claim page and current-review clock', async t => {
  const dom = page(t, '&entity=snowflake&neighbor=dbt-labs');
  const document = dom.window.document;
  await waitFor(() => document.querySelectorAll('.atlas-claim').length === 2);
  let exported;
  dom.window.Blob = class { constructor(parts) { exported = JSON.parse(parts[0]); } };
  dom.window.URL.createObjectURL = () => 'blob:test';
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  document.querySelector('#atlas-question').value = 'which claims share this pair?';
  document.querySelector('#atlas-export').click();
  assert.equal(exported.question, 'which claims share this pair?');
  assert.equal(exported.review_lens, 'current_accepted_at_build');
  assert.equal(exported.frame_id, exported.selected_premises.frame_id);
  assert.equal(exported.selected_premises.claims.length, 2);
  assert.equal(exported.geometry.historically_eligible_model_input, false);
});

test('disposal cancels discovery and reduced motion suppresses accepted-frame fades', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '', async () => pending);
  dom.window.dispatchEvent(new dom.window.Event('pagehide')); release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(dom.window.document.querySelector('.constellation-map'), null);
  const reduced = page(t);
  let animations = 0;
  reduced.window.matchMedia = () => ({ matches: true });
  reduced.window.Element.prototype.animate = () => { animations += 1; };
  await waitFor(() => reduced.window.document.querySelector('.constellation-map'));
  assert.equal(animations, 0);
});
