'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { handleAtlas } = require('../api/atlas.js');
const { createReviewedAtlasHandler } = require('../api/atlas-reviewed.js');
const root = path.join(__dirname, '..');
const datadog = '4d9ade2bfb2aa6cb4afb';
const elastic = '0b53be52084e857862ac';

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error('contextual relationship evidence did not reach its expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function page(t, query, delay = async () => {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'web/atlas.html'), 'utf8'), {
    url: `http://localhost/atlas.html?${query}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const reviewed = createReviewedAtlasHandler();
  const requests = [];
  const errors = [];
  dom.window.TextEncoder = TextEncoder;
  dom.window.performance.getEntriesByType = () => [];
  dom.window.addEventListener('error', event => errors.push(event.message));
  dom.window.fetch = async url => {
    const params = new URL(url, 'http://localhost').searchParams;
    requests.push(new URLSearchParams(params));
    await delay(params);
    const result = params.get('layer') === 'reviewed' ? reviewed(params) : handleAtlas(params);
    return { ok: result.status === 200, status: result.status, json: async () => result.body };
  };
  for (const script of ['console-ui.js', 'research-model.js', 'temporal-graph.js', 'atlas-model.js',
    'atlas-client.js', 'atlas-relationships.js', 'atlas-view.js']) {
    dom.window.eval(fs.readFileSync(path.join(root, 'web', script), 'utf8'));
  }
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close(); reviewed.close();
    assert.deepEqual(errors, []);
  });
  return { dom, requests };
}

test('mapped focus shows bounded relationship choices without a second graph', async t => {
  const { dom, requests } = page(t, `candidate=${datadog}&source=cncf&year=2024`);
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-relationship-choices button'));
  assert.equal(document.querySelectorAll('.constellation-map').length, 1);
  assert.equal(document.querySelectorAll('.atlas-claim').length, 0);
  assert.match(document.querySelector('.atlas-relationship-body').textContent, /limited selected-pilot coverage.*1 eligible claim/);
  assert(requests.some(query => query.get('layer') === 'reviewed' && query.get('mode') === 'focus'));
  assert(!requests.some(query => query.get('layer') === 'reviewed' && query.get('mode') === 'explain'));
  const elasticButton = [...document.querySelectorAll('.atlas-relationship-choices button')]
    .find(button => button.textContent.includes('Elastic'));
  assert(elasticButton);
  elasticButton.click();
  await waitFor(() => document.querySelector('.atlas-claim'));
  const card = document.querySelector('.atlas-claim');
  assert.match(card.textContent, /named competitor of/);
  assert.match(card.textContent, /published 2025-02-20/);
  assert(card.querySelector('a[href*="dataFamily=topology"][href*="dataRecord="]'));
  assert.match(card.querySelector('.atlas-claim-audit').textContent,
    /711ee14f238f3e12597a03d889b7d8c29785eee865e1cecd8e20e0578a67facf/);
});

test('selected inventory pair reveals claims for both explicit candidate links', async t => {
  const { dom, requests } = page(t, `candidate=${datadog}&neighbor=${elastic}&source=cncf&year=2024`);
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-premise') && document.querySelector('.atlas-claim'));
  assert.match(document.querySelector('#atlas-inspector').textContent, /unreviewed co-listing/);
  assert.equal(document.querySelectorAll('.atlas-claim').length, 1);
  assert(requests.some(query => query.get('layer') === 'reviewed' && query.get('mode') === 'explain'
    && query.get('neighbor') === 'elastic' && query.get('candidate') === datadog));
  assert.equal(document.querySelector('#atlas-inspector').dataset.frameId,
    document.querySelector('#atlas-frame-label').dataset.frameId);
  assert(!document.querySelector('#atlas-reviewed-link'));
});

test('an unreviewed selected pair does not inherit the focal candidate claim count', async t => {
  const { dom } = page(t, `candidate=${datadog}&neighbor=008f15fb016e197095c7&source=cncf&year=2024`);
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-relationship-body')?.textContent.includes('no eligible reviewed claim'));
  assert.doesNotMatch(document.querySelector('.atlas-relationship-body').textContent, /\d+ eligible claims?/);
  assert.equal(document.querySelectorAll('.atlas-claim').length, 0);
});

test('publication cutoff changes eligibility without changing inventory frame', async t => {
  const { dom } = page(t, `candidate=${datadog}&neighbor=${elastic}&source=cncf&year=2024&reviewed_cutoff=2025-02-19`);
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-relationship-body')?.textContent.includes('published through 2025-02-19'));
  const inventoryFrame = document.querySelector('#atlas-frame-label').dataset.frameId;
  assert.equal(document.querySelectorAll('.atlas-claim').length, 0);
  assert.match(document.querySelector('.atlas-relationship-body').textContent, /no eligible reviewed claim/);
  assert.doesNotMatch(document.querySelector('.atlas-relationship-body').textContent, /\d+ eligible claims?/);
  assert.equal(document.querySelector('#atlas-frame-label').dataset.frameId, inventoryFrame);
});

test('unmapped inventory candidate does not request reviewed claims', async t => {
  const { dom, requests } = page(t, 'candidate=004c9f6b7ecc1c48c8e4&source=cncf&year=2024');
  await waitFor(() => dom.window.document.querySelector('.constellation-map'));
  assert.equal(requests.filter(query => query.get('layer') === 'reviewed').length, 0);
  assert.equal(dom.window.document.querySelector('.atlas-relationships'), null);
});

test('late reviewed pair detail cannot overwrite a newer inventory frame', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { dom } = page(t, `candidate=${datadog}&neighbor=${elastic}&source=cncf&year=2024`,
    async params => {
      if (params.get('layer') === 'reviewed' && params.get('mode') === 'explain') await pending;
    });
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-premise') && document.querySelector('.atlas-relationships'));
  document.querySelector('#atlas-previous').click();
  await waitFor(() => document.querySelector('#atlas-frame-label').textContent.includes('2023')
    && !document.querySelector('#atlas-status').textContent);
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(document.querySelectorAll('.atlas-claim').length, 0);
  assert.match(document.querySelector('#atlas-frame-label').textContent, /2023/);
});

test('legacy reviewed candidate link keeps its independent build and cutoff', async t => {
  const { dom, requests } = page(t, `layer=reviewed&candidate=${datadog}&neighbor=elastic&cutoff=2025-02-20&basis=documented`);
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-claim'));
  const route = new URLSearchParams(dom.window.location.search);
  assert.equal(route.get('layer'), null);
  assert.equal(route.get('reviewed_cutoff'), '2025-02-20');
  assert.equal(route.get('reviewed_neighbor'), 'elastic');
  assert.equal(route.get('reviewed_build_id')?.length, 64);
  assert(requests.some(query => query.get('layer') === 'reviewed' && query.get('build_id') === route.get('reviewed_build_id')));
  assert(!requests.some(query => query.get('layer') !== 'reviewed'
    && query.get('build_id') === route.get('reviewed_build_id')));
});

test('legacy mapped entity and external neighbor keep their exact reviewed scope in one atlas', async t => {
  const { dom } = page(t, 'layer=reviewed&entity=snowflake&neighbor=dbt-labs&cutoff=2022-02-24&basis=documented');
  const document = dom.window.document;
  await waitFor(() => document.querySelectorAll('.atlas-claim').length === 3);
  const route = new URLSearchParams(dom.window.location.search);
  assert.equal(route.get('candidate'), '9129ab18dfd8c1058038');
  assert.equal(route.get('reviewed_neighbor'), 'dbt-labs');
  assert.equal(route.get('reviewed_cutoff'), '2022-02-24');
  assert.equal(document.querySelectorAll('.constellation-map').length, 1);
  assert.match(document.querySelector('.atlas-claim-audit').textContent,
    /64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece/);
});
