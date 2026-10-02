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
    const requestUrl = new URL(url, 'http://localhost');
    const params = requestUrl.searchParams;
    if (['/dashboard.json', '/data/index.json'].includes(requestUrl.pathname)) {
      await delay(params, requestUrl.pathname);
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(
        path.join(root, 'web', requestUrl.pathname.slice(1)), 'utf8')) };
    }
    await delay(params);
    const result = handleAtlas(params);
    return { ok: result.status === 200, status: result.status, json: async () => result.body };
  };
  for (const script of ['console-ui.js', 'research-model.js', 'temporal-graph.js', 'atlas-model.js', 'atlas-client.js', 'atlas-relationships.js', 'atlas-company.js', 'atlas-view.js']) {
    dom.window.eval(fs.readFileSync(path.join(root, 'web', script), 'utf8'));
  }
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); assert.deepEqual(errors, []); });
  return dom;
}

test('startup controls wait for discovery and the initial frame before accepting input', async t => {
  let releaseDiscovery;
  let releaseFrame;
  const discovery = new Promise(resolve => { releaseDiscovery = resolve; });
  const initialFrame = new Promise(resolve => { releaseFrame = resolve; });
  const dom = page(t, '', async params => {
    if (params.get('mode') === 'discover') await discovery;
    if (params.get('mode') === 'focus') await initialFrame;
  });
  const document = dom.window.document;
  const browse = document.getElementById('atlas-regions');
  assert.equal(browse.disabled, true, 'an early click must not be silently discarded');
  releaseDiscovery();
  await waitFor(() => document.querySelector('#atlas-revision option'));
  assert.equal(browse.disabled, true, 'initial focus must not overwrite a user navigation');
  releaseFrame();
  await waitFor(() => !browse.disabled);
  browse.click();
  await waitFor(() => document.querySelector('.atlas-region'));
  assert.equal(new URLSearchParams(dom.window.location.search).get('mode'), 'regions');
});

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

test('top 100 requests and renders the complete ranked page while lower limits stay exact', async t => {
  const dom = page(t, '?candidate=4d9ade2bfb2aa6cb4afb&source=cncf&year=2024&top_k=100');
  const document = dom.window.document;
  await waitFor(() => document.querySelectorAll('.atlas-candidate-list button').length === 100);
  assert.match(document.getElementById('atlas-frame-label').textContent, /100 of 145.*top 100/);
  assert.equal(document.querySelectorAll('.constellation-node').length, 101);

  const topK = document.getElementById('atlas-top-k');
  topK.value = '7';
  topK.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.atlas-candidate-list button').length === 7);
  assert.match(document.getElementById('atlas-frame-label').textContent, /7 of 145.*top 7/);
  assert.equal(document.querySelectorAll('.constellation-node').length, 8);
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
  await waitFor(() => dom.window.document.querySelector('.constellation-map'));
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
  await waitFor(() => dom.window.document.querySelector('.constellation-map'));
  assert.equal(animations, 0);
});

test('empty entry opens a bounded example while explicit source scope keeps its own frame', async t => {
  const example = page(t);
  await waitFor(() => example.window.document.querySelector('.constellation-map'));
  assert.match(example.window.document.querySelector('#atlas-inspector h3').textContent, /GitLab/);
  assert.match(example.window.document.querySelector('#atlas-frame-label').textContent, /top 24 by shared placements/);
  const scoped = page(t, '?source=lfai&year=2024');
  await waitFor(() => scoped.window.document.querySelector('.atlas-region'));
  assert.match(scoped.window.document.querySelector('#atlas-frame-label').textContent, /lfai.*2024/);
  assert.equal(scoped.window.document.querySelector('.constellation-map'), null);
});

test('empty search gives a scoped next action without drawing an empty graph', async t => {
  const dom = page(t, '?source=lfai&year=2024&mode=search&query=no-such-candidate-logpose-check');
  const document = dom.window.document;
  await waitFor(() => document.querySelector('#atlas-scene h3'));
  assert.match(document.querySelector('#atlas-scene').textContent, /no matching candidates.*LFAI 2024/s);
  assert.equal(document.querySelector('.constellation-map'), null);
  document.querySelector('#atlas-scene button').click();
  await waitFor(() => document.querySelector('.atlas-region'));
});

test('GitLab relationship hover reads exact categories from the displayed frame', async t => {
  const requests = [];
  const dom = page(t, '', async params => { requests.push(Object.fromEntries(params)); });
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.constellation-edge-hit'));
  const edge = document.querySelector('.constellation-edge-hit');
  assert.match(edge.querySelector('title').textContent, /GitLab and .*co-listed/);
  edge.dispatchEvent(new dom.window.MouseEvent('pointerenter'));
  await waitFor(() => /co-listed in “/.test(document.querySelector('.constellation-relationship').textContent));
  assert.match(document.querySelector('.constellation-relationship').textContent, /Continuous Integration & Delivery.*CNCF 2024/);
  const request = requests.find(item => item.mode === 'explain' && item.limit === '3');
  assert.equal(request.candidate, 'db7244f000eedc7a99c9');
  assert.equal(request.neighbor, edge.dataset.neighbor);
  assert.equal(request.source, 'cncf');
  assert.equal(request.year, '2024');
  assert(request.build_id);
  assert.equal(document.querySelectorAll('.atlas-premise').length, 0, 'hover must not select the evidence inspector');
  edge.dispatchEvent(new dom.window.MouseEvent('pointerleave'));
  assert.match(document.querySelector('.constellation-relationship').textContent, /^Hover or focus/);
});

test('mapped company facts are visible on the graph and node selection stays there', async t => {
  const dom = page(t, '?candidate=db7244f000eedc7a99c9&source=cncf&year=2023');
  const document = dom.window.document;
  await waitFor(() => document.querySelectorAll('.atlas-company-stat strong').length === 3);
  assert.deepEqual([...document.querySelectorAll('.atlas-company-stat strong')].map(node => node.textContent),
    ['$579.9m', '+36.7%', '−73.1%']);
  assert.match(document.querySelector('.atlas-company-summary').textContent, /periods ending 2024.*2023-02-01 to 2024-01-31.*independent of the graph/s);
  assert.equal(new URL(dom.window.location.href).searchParams.get('year'), '2023');
  assert.equal(document.querySelectorAll('.atlas-stat-sources a').length, 5);
  assert.equal(document.querySelector('.atlas-company-filed').textContent.trim(), 'filed 2024-03-26');
  assert.match(document.querySelector('.atlas-company-time-note').textContent, /independent of the graph/);
  for (const anchor of document.querySelectorAll('.atlas-stat-sources a')) {
    assert.equal(new URL(anchor.href).searchParams.get('dataCompany'), 'gitlab');
    assert(new URL(anchor.href).searchParams.get('dataBuild'));
  }
  const unmapped = document.querySelector('.constellation-node[aria-label*="candidate context"]');
  assert(unmapped);
  const id = unmapped.dataset.candidate;
  unmapped.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await waitFor(() => new URL(dom.window.location.href).searchParams.get('candidate') === id);
  assert.equal(dom.window.location.pathname, '/atlas.html');
  assert.equal(document.querySelector('.atlas-company-summary'), null);
  assert.match(document.querySelector('.atlas-identity-gap').textContent, /not mapped/);
});

test('a delayed company load cannot repopulate an inspector after browsing away', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '', async (_params, pathname) => { if (pathname === '/dashboard.json') await pending; });
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-company-loading'));
  document.querySelector('#atlas-regions').click();
  await waitFor(() => document.querySelector('.atlas-region'));
  release();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(document.querySelector('.atlas-company-summary'), null);
  assert.match(document.querySelector('#atlas-inspector').textContent, /start with a source/);
});

test('company summary refuses unmapped names and mismatched source facts', async t => {
  const dom = new JSDOM('<!doctype html><body><aside></aside></body>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const pilot = JSON.parse(fs.readFileSync(path.join(root, 'web/dashboard.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'web/data/index.json'), 'utf8'));
  catalog.sec.find(item => item.company_slug === 'gitlab' && item.year === 2024 && item.concept_group === 'revenue' && item.selected).value = '1';
  let requests = 0;
  dom.window.fetch = async url => { requests += 1; return { ok: true, json: async () => JSON.parse(JSON.stringify(url.includes('dashboard') ? pilot : catalog)) }; };
  for (const script of ['console-ui.js', 'research-model.js', 'atlas-model.js', 'atlas-company.js'])
    dom.window.eval(fs.readFileSync(path.join(root, 'web', script), 'utf8'));
  const inspector = dom.window.document.querySelector('aside');
  dom.window.LogPoseAtlasCompany.show({ name: 'GitLab' }, inspector, () => true);
  assert.equal(requests, 0);
  dom.window.LogPoseAtlasCompany.show({ name: 'GitLab', identity_review: { pilot_slug: 'gitlab' } }, inspector, () => true);
  await waitFor(() => inspector.textContent.includes('metric and retained source disagree'));
  assert.equal(inspector.querySelector('.atlas-company-stat'), null);
  catalog.sec.find(item => item.company_slug === 'gitlab' && item.year === 2024 && item.concept_group === 'revenue' && item.selected).value =
    pilot.financials.cells.find(item => item.slug === 'gitlab' && item.year === 2024 && item.concept === 'revenue').selected.value;
  inspector.querySelector('button').click();
  await waitFor(() => inspector.querySelectorAll('.atlas-company-stat').length === 3);
  assert.equal(requests, 4, 'an explicit retry must reload both retained files');
  assert.equal(inspector.querySelector('.atlas-company-stat strong').textContent, '$579.9m');
});

test('list and density rerenders leave connection inspection in a loadable company-summary state', async t => {
  const dom = page(t);
  const document = dom.window.document;
  await waitFor(() => document.querySelector('.atlas-candidate-list button'));
  document.querySelector('.atlas-candidate-list button').click();
  await waitFor(() => document.querySelector('.atlas-premise'));
  assert(new URL(dom.window.location.href).searchParams.has('neighbor'));
  document.querySelector('#atlas-list-toggle').click();
  await waitFor(() => document.querySelector('.atlas-company-stat'));
  assert.equal(new URL(dom.window.location.href).searchParams.has('neighbor'), false);
  assert.equal(document.querySelector('.atlas-premise'), null);
  document.querySelector('.atlas-candidate-list button').click();
  await waitFor(() => document.querySelector('.atlas-premise'));
  const density = document.querySelector('#atlas-density');
  density.value = '12'; density.dispatchEvent(new dom.window.Event('input'));
  await waitFor(() => document.querySelector('.atlas-company-stat'));
  assert.equal(new URL(dom.window.location.href).searchParams.has('neighbor'), false);
  assert.equal(document.querySelector('.atlas-company-loading'), null);
});

const gitlabCandidate = 'db7244f000eedc7a99c9';
function ready(dom, predicate = () => true) {
  const document = dom.window.document;
  return waitFor(() => document.getElementById('atlas-controls').getAttribute('aria-busy') === 'false'
    && !document.getElementById('atlas-status').textContent && predicate());
}
function clickNode(dom, id) {
  dom.window.document.querySelector(`.constellation-node[data-candidate="${id}"]`)
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}
function clickEdge(dom, id) {
  dom.window.document.querySelector(`.constellation-edge-hit[data-neighbor="${id}"]`)
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

test('company and edge navigation push distinct entries and Back/Forward restore their exact inspector', async t => {
  const dom = page(t);
  const document = dom.window.document;
  await ready(dom, () => document.querySelector('.atlas-company-stat'));
  const original = dom.window.location.search;
  const originalLength = dom.window.history.length;
  const neighbor = document.querySelector('.constellation-edge-hit').dataset.neighbor;
  clickEdge(dom, neighbor);
  await ready(dom, () => document.querySelector('.atlas-premise'));
  const edgeUrl = dom.window.location.search;
  assert.equal(dom.window.history.length, originalLength + 1);
  clickNode(dom, gitlabCandidate);
  await ready(dom, () => !document.querySelector('.atlas-premise'));
  assert.equal(dom.window.history.length, originalLength + 2);
  assert.equal(dom.window.location.search, original);
  clickNode(dom, gitlabCandidate);
  await ready(dom);
  assert.equal(dom.window.history.length, originalLength + 2, 'reselecting the same company must not add duplicate history');
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === edgeUrl && document.querySelector('.atlas-premise'));
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === original && !document.querySelector('.atlas-premise'));
  dom.window.history.forward();
  await ready(dom, () => dom.window.location.search === edgeUrl && document.querySelector('.atlas-premise'));
  dom.window.history.forward();
  await ready(dom, () => dom.window.location.search === original && !document.querySelector('.atlas-premise'));
});

test('search and year are navigable while density replaces only the current entry', async t => {
  const dom = page(t);
  const document = dom.window.document;
  await ready(dom);
  const length = dom.window.history.length;
  const topK = document.getElementById('atlas-top-k');
  topK.value = '7'; topK.dispatchEvent(new dom.window.Event('change'));
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('top_k') === '7');
  assert.equal(dom.window.history.length, length);
  document.getElementById('atlas-query').value = 'GitHub';
  document.getElementById('atlas-controls').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('mode') === 'search');
  const searchUrl = dom.window.location.search;
  assert.equal(new URLSearchParams(searchUrl).get('query'), 'GitHub');
  assert.equal(dom.window.history.length, length + 1);
  document.getElementById('atlas-previous').click();
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('year') === '2023');
  assert.equal(new URLSearchParams(dom.window.location.search).get('query'), 'GitHub');
  assert.equal(new URLSearchParams(dom.window.location.search).get('mode'), 'search');
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === searchUrl);
  assert.equal(document.getElementById('atlas-query').value, 'GitHub');
  const selected = document.querySelector('.atlas-candidate-list button');
  const selectedId = selected.dataset.candidate;
  selected.click();
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('candidate') === selectedId);
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === searchUrl && document.querySelector('.atlas-candidate-list button'));
});

test('long legacy edge links and compact reloads resolve the same pinned evidence', async t => {
  const manifest = handleAtlas(new URLSearchParams('mode=discover&limit=100')).body;
  const artifact = manifest.artifacts.find(item => item.source === 'cncf' && item.inventory_year === 2024);
  const fields = { mode: 'focus', build_id: manifest.build_id, source: 'cncf', year: '2024',
    temporal_mode: 'snapshot', artifact: artifact.artifact_id, candidate: gitlabCandidate, top_k: '5', limit: '5' };
  const frame = handleAtlas(new URLSearchParams(fields)).body;
  const neighbor = frame.edges[0].candidate_id;
  const dom = page(t, `?${new URLSearchParams({ ...fields, neighbor })}`);
  await ready(dom, () => dom.window.document.querySelector('.atlas-premise'));
  const compact = new URLSearchParams(dom.window.location.search);
  assert.equal(compact.get('build_id'), manifest.build_id);
  assert.equal(compact.get('neighbor'), neighbor);
  assert.equal(compact.get('top_k'), '5');
  for (const key of ['mode', 'source', 'temporal_mode', 'artifact', 'limit']) assert.equal(compact.has(key), false);
  const reloaded = page(t, dom.window.location.search);
  await ready(reloaded, () => reloaded.window.document.querySelector('.atlas-premise'));
  assert.equal(reloaded.window.document.getElementById('atlas-frame-label').dataset.frameId, frame.frame_id);
  assert.equal(reloaded.window.document.getElementById('atlas-inspector').textContent,
    dom.window.document.getElementById('atlas-inspector').textContent);
});

test('comparison links restore the same two exact revisions after compact reload', async t => {
  const dom = page(t);
  const document = dom.window.document;
  await ready(dom, () => document.querySelector('.atlas-company-stat'));
  [...document.querySelectorAll('#atlas-inspector button')]
    .find(button => button.textContent === 'compare with previous retained year').click();
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('mode') === 'compare');
  const frame = document.getElementById('atlas-frame-label').dataset.frameId;
  const route = dom.window.location.search;
  assert.equal(new URLSearchParams(route).get('compare_year'), '2023');
  assert.equal(new URLSearchParams(route).has('compare_artifact'), false);
  const reloaded = page(t, route);
  await ready(reloaded, () => reloaded.window.document.querySelector('#atlas-scene h3')?.textContent === 'compare 2023 → 2024');
  assert.equal(reloaded.window.document.getElementById('atlas-frame-label').dataset.frameId, frame);
  assert.equal(reloaded.window.document.getElementById('atlas-scene').textContent, document.getElementById('atlas-scene').textContent);
});

for (const pendingKind of ['focus', 'explain']) test(`Back cancels a pending ${pendingKind} request without rewriting the returned history entry`, async t => {
  let delayedId;
  let release;
  let requested = false;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '', async params => {
    if (params.get('mode') === pendingKind && params.get(pendingKind === 'focus' ? 'candidate' : 'neighbor') === delayedId) {
      requested = true; await pending;
    }
  });
  const document = dom.window.document;
  await ready(dom, () => document.querySelector('.atlas-company-stat'));
  const original = dom.window.location.search;
  const next = document.querySelector('.constellation-edge-hit').dataset.neighbor;
  clickNode(dom, next);
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('candidate') === next);
  const second = dom.window.location.search;
  delayedId = [...document.querySelectorAll('.constellation-edge-hit')]
    .map(edge => edge.dataset.neighbor).find(id => id !== gitlabCandidate);
  assert(delayedId);
  if (pendingKind === 'focus') clickNode(dom, delayedId);
  else clickEdge(dom, delayedId);
  await waitFor(() => requested);
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === original && document.querySelector('#atlas-inspector h3')?.textContent === 'GitLab');
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(dom.window.location.search, original);
  assert.equal(document.querySelector('#atlas-inspector h3').textContent, 'GitLab');
  dom.window.history.forward();
  await ready(dom, () => dom.window.location.search === second && !document.querySelector('.atlas-premise'));
});

test('revision changes leave revision-bound categories and return to the new year’s categories', async t => {
  const dom = page(t, '?source=cncf&year=2024');
  const document = dom.window.document;
  await ready(dom, () => document.querySelector('.atlas-region'));
  document.querySelector('.atlas-region').click();
  await ready(dom, () => new URLSearchParams(dom.window.location.search).has('placement'));
  const categoryUrl = dom.window.location.search;
  document.getElementById('atlas-previous').click();
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('year') === '2023'
    && document.querySelector('.atlas-region'));
  assert.equal(new URLSearchParams(dom.window.location.search).has('placement'), false);
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === categoryUrl && document.querySelector('.atlas-candidate-list'));
});

test('presentation toggle cannot rewrite a history destination while a different build is restoring', async t => {
  const current = handleAtlas(new URLSearchParams('mode=discover')).body.build_id;
  const older = fs.readdirSync(path.join(root, 'api/data/atlas'))
    .find(name => /^[a-f0-9]{64}\.json$/.test(name) && name !== `${current}.json`).replace('.json', '');
  let release;
  let requested = false;
  let hold = true;
  const pending = new Promise(resolve => { release = resolve; });
  const dom = page(t, '', async params => {
    if (hold && params.get('mode') === 'discover' && params.get('build_id') === older) {
      requested = true; await pending;
    }
  });
  const document = dom.window.document;
  await ready(dom, () => document.querySelector('.atlas-company-stat'));
  clickEdge(dom, document.querySelector('.constellation-edge-hit').dataset.neighbor);
  await ready(dom, () => document.querySelector('.atlas-premise'));
  const edgeUrl = dom.window.location.search;
  const olderUrl = `?build_id=${older}&year=2024&candidate=${gitlabCandidate}`;
  dom.window.history.pushState(null, '', olderUrl);
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  await waitFor(() => requested);
  const toggle = document.getElementById('atlas-list-toggle');
  assert.equal(toggle.disabled, true);
  toggle.click();
  assert.equal(dom.window.location.search, olderUrl);
  dom.window.history.back();
  await ready(dom, () => dom.window.location.search === edgeUrl && document.querySelector('.atlas-premise'));
  hold = false; release();
  await new Promise(resolve => setTimeout(resolve, 30));
  dom.window.history.forward();
  await ready(dom, () => new URLSearchParams(dom.window.location.search).get('build_id') === older);
  assert.equal(new URLSearchParams(dom.window.location.search).get('candidate'), gitlabCandidate);
});
