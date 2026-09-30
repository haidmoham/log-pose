const test = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const topologyOracle = require('./fixtures/discovery-topology-oracle.js');
const marketFieldApi = require('../api/market-field.js');

const web = path.resolve(__dirname, '../web');
const topologyPayload = JSON.parse(fsSync.readFileSync(
  path.join(web, 'data/topology-discovery.json'), 'utf8'));
const topology = topologyOracle.prepare(topologyPayload);
const testBuildId = 'route-test-build-1';
const reviewPairs = new Set(topologyPayload.edges.map(edge =>
  [edge.subject_candidate_id, edge.object_candidate_id].sort().join(':')));

function minimalCandidate(candidate) {
  return { id: candidate.id, name: candidate.name,
    candidate_tags: candidate.candidate_tags,
    observed_years: candidate.observed_years,
    identity_review: Boolean(candidate.identity_review) };
}

function filteredObservation(observation, filters) {
  return (filters.source === 'all' || observation.source === filters.source)
    && (filters.year === 'all' || observation.year === Number(filters.year))
    && (filters.category === 'all' || observation.source_category === filters.category);
}

function mockMarketField(params, buildId = testBuildId) {
  if (params.mode === 'summary') {
    return { schema_version: '1.0', build_id: buildId,
      counts: topologyPayload.counts,
      facets: {
        sources: [...new Set(topologyPayload.artifacts.map(item => item.source))],
        years: [...new Set(topologyPayload.artifacts.map(item => item.year))],
        categories: [...new Set(topologyPayload.nodes.flatMap(candidate =>
          candidate.observations.map(item => item.source_category)))]
      },
      candidates: [...topology.nodes.values()].map(minimalCandidate),
      status: 'unreviewed_inventory_overlap' };
  }

  const filters = { query: params.query || '', source: params.source || 'all',
    year: params.year || 'all', tag: params.tag || 'all',
    category: params.category || 'all', identity: params.identity || 'all' };
  if (params.mode === 'query') {
    const candidates = topologyOracle.matchingCandidates(topology, filters);
    const candidateIds = candidates.map(candidate => candidate.id);
    const pairs = topologyOracle.matchingPairs(topology, candidateIds, filters);
    const tagFlows = new Map();
    const primaryTag = candidate => topologyOracle.TAG_ORDER.find(tag =>
      candidate.candidate_tags.includes(tag)) || topologyOracle.TAG_ORDER[0];
    for (const pair of pairs) {
      const left = primaryTag(topology.nodes.get(pair.left));
      const right = primaryTag(topology.nodes.get(pair.right));
      const key = [left, right].sort().join(':');
      tagFlows.set(key, (tagFlows.get(key) || 0) + 1);
    }
    const [offset, limit] = [Number(params.offset || 0), Number(params.limit || 80)];
    const page = candidates.slice(offset, offset + limit).map(minimalCandidate);
    const candidateId = params.candidate;
    const allNeighbors = candidateId
      ? topologyOracle.matchingNeighbors(topology, candidateId, candidateIds, filters) : [];
    const neighborOffset = Number(params.neighbor_offset || 0);
    const neighborLimit = Number(params.neighbor_limit || 500);
    const neighbors = allNeighbors.slice(neighborOffset, neighborOffset + neighborLimit)
      .map(item => ({ candidate: minimalCandidate(item.candidate),
        keys: item.keys.map(key => JSON.parse(key)) }));
    const nextNeighborOffset = neighborOffset + neighbors.length < allNeighbors.length
      ? neighborOffset + neighbors.length : null;
    return { build_id: buildId, total_candidates: candidates.length,
      candidate_ids: candidateIds, candidates: page, offset, limit,
      next_offset: offset + page.length < candidates.length ? offset + page.length : null,
      observation_count: candidates.reduce((count, candidate) => count
        + candidate.observations.filter(item => filteredObservation(item, filters)).length, 0),
      pair_count: pairs.length,
      tag_flows: [...tagFlows].map(([key, count]) => {
        const [left, right] = key.split(':');
        return { left, right, count };
      }),
      neighbors, neighbor_count: allNeighbors.length,
      neighbor_offset: neighborOffset, neighbor_limit: neighborLimit,
      next_neighbor_offset: nextNeighborOffset };
  }

  if (params.mode === 'detail') {
    const candidate = topology.nodes.get(params.candidate);
    const neighbor = params.neighbor ? topology.nodes.get(params.neighbor) : null;
    const pairId = neighbor
      ? [candidate.id, neighbor.id].sort().join(':') : null;
    const pair = pairId ? topology.pairs.get(pairId) : null;
    const sharedObservations = pair ? pair.keys.map(key => {
      const [source, year, sourceCategory] = JSON.parse(key);
      const subject = topology.observationsByNode.get(candidate.id).get(key);
      const object = topology.observationsByNode.get(neighbor.id).get(key);
      return { source, year, source_category: sourceCategory,
        artifact_sha256: subject[0].artifact_sha256,
        subject_occurrence_ids: subject.flatMap(item => item.occurrence_ids),
        object_occurrence_ids: object.flatMap(item => item.occurrence_ids),
        subject_rows: subject.flatMap(item => item.rows),
        object_rows: object.flatMap(item => item.rows) };
    }) : [];
    return { build_id: buildId, candidate,
      neighbor: pair ? neighbor : null,
      shared_observations: sharedObservations,
      in_review_worklist: Boolean(pairId && reviewPairs.has(pairId)),
      review_pair: pairId && reviewPairs.has(pairId)
        ? topologyPayload.edges.find(edge => [edge.subject_candidate_id,
          edge.object_candidate_id].sort().join(':') === pairId) : null };
  }
  throw new Error(`unexpected market field mode ${params.mode}`);
}

class LocalResources extends ResourceLoader {
  fetch(url) {
    if (!url.startsWith('https://logpose.test/')) return null;
    return fs.readFile(path.join(web, new URL(url).pathname));
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('market route did not reach expected state');
}

async function page(route = '/', failOncePath = null, mockWebgl = false, apiOptions = {}) {
  const errors = [];
  const apiRequests = [];
  let failed = false;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const html = await fs.readFile(path.join(web, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://logpose.test' + route,
    runScripts: 'dangerously',
    resources: new LocalResources(),
    virtualConsole,
    beforeParse(window) {
      window.__routeErrors = errors;
      if (apiOptions.captureDownloads) {
        window.URL.createObjectURL = blob => { window.__downloadBlob = blob; return 'blob:test'; };
        window.URL.revokeObjectURL = () => {};
        window.HTMLAnchorElement.prototype.click = function click() {};
      }
      if (apiOptions.storage) Object.defineProperty(window, 'localStorage', { value: apiOptions.storage });
      if (apiOptions.decisionDraft) window.localStorage.setItem(
        'log-pose.decision-brief.v1', apiOptions.decisionDraft);
      if (apiOptions.blockStorage) Object.defineProperty(window, 'localStorage', {
        get() { throw new Error('storage unavailable'); }
      });
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      window.__marketFieldRequests = apiRequests;
      if (mockWebgl) {
        const bufferUploads = [];
        window.__mockWebglBufferUploads = bufferUploads;
        const constants = {
          VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ARRAY_BUFFER: 4,
          FLOAT: 5, BLEND: 6, SRC_ALPHA: 7, ONE_MINUS_SRC_ALPHA: 8,
          COLOR_BUFFER_BIT: 9, DYNAMIC_DRAW: 10, LINES: 11, POINTS: 12
        };
        const gl = new Proxy({
          ...constants,
          createShader: () => ({}),
          createProgram: () => ({}),
          createBuffer: () => ({}),
          getProgramParameter: () => true,
          getAttribLocation: (_program, name) => ({ position: 0, color: 1, pointSize: 2 })[name],
          getExtension: () => ({ loseContext() {} }),
          bufferData: (_target, data) => bufferUploads.push(data.length)
        }, { get(target, property) {
          if (property in target) return target[property];
          return () => {};
        } });
        window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
          return kind === 'webgl' ? gl : null;
        };
      }
      window.fetch = async (url, fetchOptions = {}) => {
        const pathname = new URL(url, window.location.href).pathname;
        if (pathname === '/api/market-field') {
          const params = Object.fromEntries(new URL(url, window.location.href).searchParams);
          const request = { params, options: fetchOptions };
          apiRequests.push(request);
          try {
            const response = apiOptions.temporal
              ? await apiOptions.temporal(params, { request, requests: apiRequests, window })
              : apiOptions.handler
              ? await apiOptions.handler(params, { request, requests: apiRequests,
                window, defaultHandler: mockMarketField })
              : { body: mockMarketField(params), status: 200 };
            const status = response.status || 200;
            return { ok: status >= 200 && status < 300, status,
              json: async () => response.body };
          } catch (failure) {
            return { ok: false, status: 500,
              json: async () => ({ error: failure.message }) };
          }
        }
        if (pathname === failOncePath && !failed) {
          failed = true;
          return { ok: false, status: 503, json: async () => ({ error: 'simulated failure' }) };
        }
        const file = path.join(web, pathname);
        try {
          const body = await fs.readFile(file, 'utf8');
          return { ok: true, json: async () => JSON.parse(body) };
        } catch {
          return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
        }
      };
    }
  });
  await waitFor(() => dom.window.document.querySelector('#view')?.getAttribute('aria-busy') === 'false');
  assert.deepEqual(errors, []);
  return dom;
}

test('company evidence, exact relationship, close, and browser history remain coherent', async () => {
  const dom = await page('/index.html?view=overview&year=2024&company=datadog');
  try {
    const { document, history } = dom.window;
    const inspect = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'inspect dated evidence →');
    inspect.click();
    assert.match(document.querySelector('#company-detail h3').textContent, /Datadog/);
    assert.equal(new URL(dom.window.location.href).searchParams.get('view'), 'explore');
    const claim = document.querySelector('[data-claim]');
    const claimId = claim.dataset.claim;
    claim.click();
    assert.equal(new URL(dom.window.location.href).searchParams.get('dataRecord'), claimId);
    assert.match(document.querySelector('.data-inspector').textContent, /scope.*log management/i);
    history.back();
    await waitFor(() => document.querySelector('#company-detail'));
    document.querySelector('#company-detail .detail-head button').click();
    assert.equal(document.querySelector('#company-detail'), null);
    assert.equal(new URL(dom.window.location.href).searchParams.has('company'), false);
    history.back();
    await waitFor(() => document.querySelector('#company-detail'));
    history.forward();
    await waitFor(() => !document.querySelector('#company-detail'));
    assert.deepEqual(dom.window.__routeErrors, []);
  } finally { dom.window.close(); }
});

test('empty comparison is discoverable and source-list pins expose capacity', async () => {
  const dom = await page('/index.html?view=explore&type=pilot');
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector('[data-view="compare"]').hidden, false);
    for (let index = 0; index < 4; index += 1) {
      const next = document.querySelector('[data-compare][aria-pressed="false"]');
      assert(next && !next.disabled);
      next.click();
    }
    assert.equal(document.querySelector('#pin-count').textContent, '4');
    assert.equal(document.querySelector('[data-compare][aria-pressed="false"]').disabled, true);
    document.querySelector('[data-view="compare"]').click();
    assert.match(document.querySelector('#view h2').textContent, /compare companies/);
    assert.equal(new URL(dom.window.location.href).searchParams.get('pinned').split(',').length, 4);
    assert.deepEqual(dom.window.__routeErrors, []);
  } finally { dom.window.close(); }
});

test('direct empty page and SEC filters explain missing results without an inventory request', async () => {
  for (const family of ['pages', 'sec']) {
    const dom = await page(`/index.html?view=data&dataFamily=${family}&dataQuery=no-such-company`);
    try {
      assert.match(dom.window.document.querySelector('.empty-state').textContent, /No retained records/);
      assert.match(dom.window.document.querySelector('.data-controls').textContent, /do not freeze what was knowable/);
    } finally { dom.window.close(); }
  }
});

test('canonical route searches retained evidence and opens a full page record', async () => {
  const dom = await page('/?view=data');
  const { document, Event } = dom.window;
  assert.match(document.querySelector('#view h2').textContent, /research the record/i);
  assert.match(document.querySelector('.data-coverage').textContent, /18,076/);
  await waitFor(() => document.querySelector('.data-results-head')?.textContent.includes('18,543 matching records')
    && !document.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  const family = document.querySelector('[aria-label="Record family"]');
  family.value = 'pages';
  family.dispatchEvent(new Event('change', { bubbles: true }));
  assert.match(document.querySelector('.data-results-head').textContent, /89 matching records/);
  document.querySelector('.data-result').click();
  await waitFor(() => document.querySelector('.data-inspector .data-reading')?.textContent.length > 500);
  assert.match(document.querySelector('.data-inspector').textContent, /captured text/i);
  assert.equal(new URL(dom.window.location.href).searchParams.get('dataFamily'), 'pages');
  const reloaded = await page(dom.window.location.pathname + dom.window.location.search);
  await waitFor(() => reloaded.window.document.querySelector('.data-inspector .data-reading')?.textContent.length > 500);
  dom.window.close();
  reloaded.window.close();
});

test('research desk drills from untagged inventory and SEC candidates into retained detail', async () => {
  const inventory = await page('/?view=data&dataFamily=inventory&dataQuery=Airship');
  const inventoryDocument = inventory.window.document;
  await waitFor(() => inventoryDocument.querySelector('.data-results-head')?.textContent.includes('matching records')
    && !inventoryDocument.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  assert.match(inventoryDocument.querySelector('.data-results').textContent, /Airship/);
  inventoryDocument.querySelector('.data-result').click();
  await waitFor(() => inventoryDocument.querySelector('.data-inspector-body .data-facts'));
  assert.match(inventoryDocument.querySelector('.data-inspector').textContent, /unmapped_category/);
  assert.match(inventoryDocument.querySelector('.data-inspector').textContent, /No candidate tag or reviewed company link/);
  inventory.window.close();

  const navigation = await page('/?view=data&dataFamily=inventory&dataQuery=ClickHouse');
  const navigationDocument = navigation.window.document;
  await waitFor(() => !navigationDocument.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  navigationDocument.querySelector('.data-result').click();
  await waitFor(() => navigationDocument.querySelector('.data-inspector-body')?.textContent.includes('identity status'));
  assert.match(navigationDocument.querySelector('.data-inspector').textContent, /Navigation match.*unreviewed.*navigation_match_unreviewed/i);
  assert.doesNotMatch(navigationDocument.querySelector('.data-inspector').textContent, /Reviewed relationship to ClickHouse/);
  navigation.window.close();

  const sec = await page('/?view=data&dataFamily=sec&dataCompany=palantir&dataYear=2021');
  const secDocument = sec.window.document;
  assert.match(secDocument.querySelector('.data-results-head').textContent, /matching records/);
  secDocument.querySelector('.data-result').click();
  await waitFor(() => secDocument.querySelector('.data-inspector-body')?.textContent.includes('Selection policy'));
  assert.match(secDocument.querySelector('.data-inspector').textContent, /accession/i);
  assert(secDocument.querySelectorAll('.data-alternative').length > 0);
  sec.window.close();
});

test('research desk market point opens participant detail and topology shows review history', async () => {
  const market = await page('/?view=data&dataFamily=market&dataQuery=FINRA');
  const marketDocument = market.window.document;
  assert.match(marketDocument.querySelector('.data-results-head').textContent, /4 matching records/);
  marketDocument.querySelector('.data-result').click();
  await waitFor(() => marketDocument.querySelector('.data-market-chart svg'));
  assert.match(marketDocument.querySelector('.data-market-day').textContent, /participant/i);
  marketDocument.querySelector('.data-participant-button').click();
  assert.match(marketDocument.querySelector('.data-participant-breakdown').textContent, /tape a shares/i);
  const marketRoute = market.window.location.pathname + market.window.location.search;
  const reopenedMarket = await page(marketRoute);
  await waitFor(() => reopenedMarket.window.document.querySelector('.data-participant-breakdown'));
  assert.match(reopenedMarket.window.document.querySelector('.data-participant-breakdown').textContent,
    /tape a shares/i);
  market.window.close();
  reopenedMarket.window.close();

  const topology = await page('/?view=data&dataFamily=topology');
  const topologyDocument = topology.window.document;
  topologyDocument.querySelector('.data-result').click();
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /review history/i);
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /source/i);
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /reviewed_at|reviewer|review history/i);
  topology.window.close();
});

test('temporal atlas opens the retained overview and a selected evidence edge survives a deep link', async () => {
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const route = '/?view=topology&topologyLayer=temporal&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024';
  const overview = await page(route, null, true, { temporal });
  const overviewDocument = overview.window.document;
  assert(overviewDocument.querySelector('.temporal-workspace'));
  assert(overviewDocument.querySelectorAll('.constellation-node').length > 100);
  assert.match(overviewDocument.querySelector('.temporal-frame-summary').textContent,
    /peer connections shown/);
  const target = overviewDocument.querySelector('[data-candidate="00a2fb1597f507022279"]');
  assert(target);
  target.dispatchEvent(new overview.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => new URL(overview.window.location.href).searchParams.has('temporalCandidate'));
  await waitFor(() => overviewDocument.querySelector('.temporal-graph-panel .constellation-map'));
  assert.match(overviewDocument.querySelector('.temporal-inspector').textContent,
    /select a connected edge/i);
  await waitFor(() => overviewDocument.querySelector('.temporal-change'));
  const firstChange = overviewDocument.querySelector('.temporal-change');
  assert(firstChange);
  firstChange.click();
  await waitFor(() => overviewDocument.querySelector('.temporal-evidence-card'));
  const linkedRoute = overview.window.location.pathname + overview.window.location.search;
  const inspectorText = overviewDocument.querySelector('.temporal-inspector').textContent;
  assert.match(inspectorText, /retained row/);
  assert.match(inspectorText, /artifact SHA-256/);
  assert(overviewDocument.querySelector('.temporal-evidence-card a[href^="https://"]'));
  const reopened = await page(linkedRoute, null, true, { temporal });
  await waitFor(() => reopened.window.document.querySelector('.temporal-evidence-card'));
  assert.equal(new URL(reopened.window.location.href).searchParams.get('temporalNeighbor'),
    new URL(overview.window.location.href).searchParams.get('temporalNeighbor'));
  assert.match(reopened.window.document.querySelector('.temporal-inspector').textContent,
    /artifact SHA-256/);
  overview.window.close();
  reopened.window.close();
});

test('temporal inventory gaps stay explicit and late frames cannot replace the selected stop', async () => {
  const temporal = async (params, context) => {
    if (params.mode === 'frame' && params.year === '2023') {
      await new Promise(resolve => setTimeout(resolve, 140));
    }
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const missing = await page('/?view=topology&topologyLayer=temporal&temporalSource=lfai&temporalMode=snapshot&temporalYear=2019',
    null, true, { temporal });
  assert.match(missing.window.document.querySelector('.temporal-missing').textContent,
    /does not show that any candidate or relationship ended/i);
  missing.window.close();

  const stale = await page('/?view=topology&topologyLayer=temporal&temporalSource=lfai&temporalMode=snapshot&temporalYear=2023',
    null, true, { temporal });
  const requests = stale.window.__marketFieldRequests;
  assert(requests.some(request => request.params.mode === 'frame' && request.params.year === '2023'));
  const slider = stale.window.document.querySelector('[aria-label="Scrub retained inventory year"]');
  slider.value = '5';
  slider.dispatchEvent(new stale.window.Event('input', { bubbles: true }));
  await waitFor(() => new URL(stale.window.location.href).searchParams.get('temporalYear') === '2025');
  await waitFor(() => stale.window.document.querySelector('.temporal-frame-id')?.textContent.startsWith('frame ')
    && !stale.window.document.querySelector('.temporal-loading'));
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(new URL(stale.window.location.href).searchParams.get('temporalYear'), '2025');
  assert(stale.window.document.querySelector('.temporal-stop-detail')?.textContent.includes('2025'));
  stale.window.close();
});

test('temporal graph selection focuses its inspector without scrolling the workspace', async () => {
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024',
    null, true, { temporal });
  const { document, MouseEvent, HTMLElement } = dom.window;
  const focusRequests = [];
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focus(options) {
    focusRequests.push({ id: this.id, preventScroll: options?.preventScroll });
    originalFocus.call(this, options);
  };
  const candidate = document.querySelector('[data-candidate="00a2fb1597f507022279"]');
  const candidateId = candidate.dataset.candidate;
  candidate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(focusRequests.at(-1), { id: 'temporal-inspector', preventScroll: true });
  await waitFor(() => document.querySelector('.constellation-node.is-focus')?.dataset.candidate === candidateId);
  const neighbor = document.querySelector('.constellation-node:not(.is-focus)');
  assert(neighbor, 'the focused fixture must have a selectable neighbor');
  neighbor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(focusRequests.at(-1), { id: 'temporal-inspector', preventScroll: true });
  await waitFor(() => document.querySelector('.constellation-node.is-selected')?.dataset.candidate === neighbor.dataset.candidate);
  dom.window.close();
});

test('graph dimensions preserve evidence selection and survive temporal updates', async () => {
  const candidateId = '00a2fb1597f507022279';
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page(`/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024&temporalCandidate=${candidateId}`,
    null, true, { temporal });
  const { document, Event, MouseEvent, KeyboardEvent } = dom.window;
  const switchMode = mode => document.querySelector(`[aria-label="${mode} graph"]`).click();
  const selectedMode = mode => document.querySelector(`[aria-label="${mode} graph"]`)?.getAttribute('aria-pressed');
  const originalUrl = dom.window.location.href;
  switchMode('3d');
  assert.equal(selectedMode('3d'), 'true');
  assert.equal(dom.window.location.href, originalUrl);
  const neighbor = document.querySelector('.constellation-node:not(.is-focus):not(.is-absent)');
  assert(neighbor, 'the fixture must include a current neighbor');
  const neighborId = neighbor.dataset.candidate;
  neighbor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await waitFor(() => document.querySelector('.constellation-node.is-selected')?.dataset.candidate === neighborId);
  assert.equal(selectedMode('3d'), 'true');
  const evidence = document.querySelector('.temporal-evidence-card').textContent;
  const map = document.querySelector('.constellation-map');
  const selectedNode = document.querySelector('.constellation-node.is-selected');
  const beforeOrbit = selectedNode.getAttribute('transform');
  map.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.notEqual(selectedNode.getAttribute('transform'), beforeOrbit);
  assert.equal(document.querySelector('.temporal-evidence-card').textContent, evidence);
  switchMode('2d');
  assert.equal(document.querySelector('.temporal-evidence-card').textContent, evidence);
  assert.equal(new URL(dom.window.location.href).searchParams.get('temporalNeighbor'), neighborId);
  switchMode('3d');
  const range = document.querySelector('[aria-label="Scrub retained inventory year"]');
  const previousFrameId = document.querySelector('.temporal-frame-id').textContent;
  range.value = '5';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => new URL(dom.window.location.href).searchParams.get('temporalYear') === '2025'
    && document.querySelector('.temporal-frame-id')?.textContent !== previousFrameId);
  assert.equal(selectedMode('3d'), 'true');
  assert.equal(new URL(dom.window.location.href).searchParams.get('temporalCandidate'), candidateId);
  dom.window.close();
});

test('scrubbing keeps the range and dated evidence mounted until the latest frame is ready', async () => {
  const focus = '00a2fb1597f507022279';
  const timeline = marketFieldApi.handleMarketField(new URLSearchParams('mode=timeline'));
  const focused = marketFieldApi.handleMarketField(new URLSearchParams({
    mode: 'frame', build_id: timeline.body.build_id, source: 'lfai', year: '2024', candidate: focus
  }));
  const neighbor = focused.body.edges[0].candidate_id;
  let release2025;
  const delayed2025 = new Promise(resolve => { release2025 = resolve; });
  const temporal = async params => {
    if (params.mode === 'frame' && params.year === '2025') await delayed2025;
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page(`/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024&temporalCandidate=${focus}`
    + `&temporalNeighbor=${neighbor}`, null, true, { temporal });
  const { document, Event } = dom.window;
  const range = document.querySelector('[aria-label="Scrub retained inventory year"]');
  range.focus();
  const displayedGraph = document.querySelector('.temporal-graph-panel');
  const displayedFrameId = document.querySelector('.temporal-frame-id').textContent;
  const displayedEvidence = document.querySelector('.temporal-evidence-card').textContent;

  range.value = '5';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(document.activeElement, range);
  assert.equal(document.querySelector('[aria-label="Scrub retained inventory year"]'), range);
  assert.equal(document.querySelector('.temporal-graph-panel'), displayedGraph);
  assert.equal(document.querySelector('.temporal-frame-id').textContent, displayedFrameId);
  assert.equal(document.querySelector('.temporal-evidence-card').textContent, displayedEvidence);
  assert.match(document.querySelector('.temporal-transition-status').textContent,
    /Loading LFAI 2025 · showing LFAI 2024/);
  assert.equal(document.querySelector('.temporal-transition-status').dataset.state, 'pending');
  assert.match(document.querySelector('.temporal-stop-detail').textContent, /2025/);

  range.value = '3';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => document.querySelector('.temporal-transition-status').dataset.state === 'ready'
    && document.querySelector('.temporal-frame-id').textContent !== displayedFrameId);
  const latestFrameId = document.querySelector('.temporal-frame-id').textContent;
  assert.match(document.querySelector('.temporal-transition-status').textContent, /Showing LFAI 2023/);
  assert.equal(document.querySelector('[aria-label="Scrub retained inventory year"]'), range);
  assert.equal(document.activeElement, range);
  release2025();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(document.querySelector('.temporal-frame-id').textContent, latestFrameId);
  assert.match(document.querySelector('.temporal-transition-status').textContent, /Showing LFAI 2023/);
  range.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await waitFor(() => document.querySelector('.temporal-transition-status').dataset.state === 'ready'
    && document.querySelector('.temporal-frame-id').textContent === displayedFrameId);
  assert.equal(document.activeElement, range);
  assert.equal(document.querySelector('[aria-label="Scrub retained inventory year"]'), range);
  dom.window.close();
});

test('a newly selected missing stop replaces the dated graph with an explicit coverage gap', async () => {
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024', null, false, { temporal });
  const { document, history, Event } = dom.window;
  assert(document.querySelector('.temporal-graph-panel'));
  history.pushState(null, '', '/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2019');
  dom.window.dispatchEvent(new Event('popstate'));
  await waitFor(() => document.querySelector('.temporal-transition-status')?.dataset.state === 'missing');
  assert.equal(document.querySelector('.temporal-graph-panel'), null);
  assert.match(document.querySelector('.temporal-missing').textContent,
    /does not show that any candidate or relationship ended/i);
  dom.window.close();
});

test('a failed target retains the last dated frame and a retry can replace it', async () => {
  let fail2025 = true;
  const temporal = async params => {
    if (params.mode === 'frame' && params.year === '2025' && fail2025) {
      return { status: 503, body: { error: 'temporary frame failure' } };
    }
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024', null, false, { temporal });
  const { document, Event } = dom.window;
  const range = document.querySelector('[aria-label="Scrub retained inventory year"]');
  const previousFrameId = document.querySelector('.temporal-frame-id').textContent;
  range.value = '5';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => document.querySelector('.temporal-transition-status').dataset.state === 'error');
  assert.match(document.querySelector('.temporal-transition-status').textContent,
    /Could not load LFAI 2025.*Showing LFAI 2024/);
  assert.equal(document.querySelector('.temporal-frame-id').textContent, previousFrameId);
  assert.equal(document.querySelector('[aria-label="Scrub retained inventory year"]'), range);
  fail2025 = false;
  document.querySelector('.temporal-transition-status button').click();
  await waitFor(() => document.querySelector('.temporal-transition-status').dataset.state === 'ready'
    && document.querySelector('.temporal-frame-id').textContent !== previousFrameId);
  assert.match(document.querySelector('.temporal-transition-status').textContent, /Showing LFAI 2025/);
  dom.window.close();
});

test('a failed timeline clears busy state and its retry restores the controls', async () => {
  let failTimeline = true;
  const temporal = async params => {
    if (params.mode === 'timeline' && failTimeline) {
      return { status: 503, body: { error: 'temporary timeline failure' } };
    }
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024', null, false, { temporal });
  const { document } = dom.window;
  assert.equal(document.querySelector('#view').getAttribute('aria-busy'), 'false');
  assert.match(document.querySelector('.temporal-transition-status').textContent,
    /temporary timeline failure/);
  failTimeline = false;
  document.querySelector('.temporal-transition-status button').click();
  await waitFor(() => document.querySelector('.temporal-transition-status').dataset.state === 'ready');
  assert(document.querySelector('[aria-label="Scrub retained inventory year"]'));
  dom.window.close();
});

test('a build refresh disables old timeline controls until new stops arrive', async () => {
  let timelineRequests = 0;
  let releaseRefresh;
  const delayedRefresh = new Promise(resolve => { releaseRefresh = resolve; });
  const temporal = async params => {
    if (params.mode === 'timeline') {
      timelineRequests += 1;
      if (timelineRequests === 2) await delayedRefresh;
    }
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    if (params.mode === 'frame' && timelineRequests === 1) {
      return { status: 200, body: { ...result.body, build_id: 'changed-build' } };
    }
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=data', null, false, { temporal });
  const { document } = dom.window;
  dom.window.history.pushState(null, '', '/?view=topology');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  await waitFor(() => timelineRequests === 2);
  assert.equal(document.querySelector('.temporal-controls').hidden, true);
  releaseRefresh();
  await waitFor(() => document.querySelector('.temporal-transition-status').dataset.state === 'ready');
  assert.equal(document.querySelector('.temporal-controls').hidden, false);
  dom.window.close();
});

test('temporal route restores search state and discards a neighbor without a focus', async () => {
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology&temporalQuery=Vespa&temporalNeighbor=orphan',
    null, false, { temporal });
  const { document, location } = dom.window;
  await waitFor(() => document.querySelector('.temporal-search input'));
  assert.equal(document.querySelector('.temporal-search input').value, 'Vespa');
  assert.equal(new URL(location.href).searchParams.has('temporalNeighbor'), false);
  await waitFor(() => document.querySelector('.temporal-inspector h3'));
  assert.match(document.querySelector('.temporal-inspector h3').textContent, /choose a candidate/i);
  dom.window.close();
});

test('temporal inspector identifies a frame with no comparison selected', async () => {
  const focus = '00a2fb1597f507022279';
  const timeline = marketFieldApi.handleMarketField(new URLSearchParams('mode=timeline'));
  const focused = marketFieldApi.handleMarketField(new URLSearchParams({
    mode: 'frame', build_id: timeline.body.build_id, source: 'lfai', year: '2024',
    candidate: focus, compare_year: 'none'
  }));
  const neighbor = focused.body.edges[0].candidate_id;
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page(`/?view=topology&temporalSource=lfai&temporalMode=snapshot&temporalCandidate=${focus}`
    + `&temporalNeighbor=${neighbor}&temporalCompareYear=none`, null, false, { temporal });
  await waitFor(() => dom.window.document.querySelector('.temporal-evidence-card'));
  assert.match(dom.window.document.querySelector('.temporal-inspector').textContent,
    /No comparison is selected for this frame/);
  dom.window.close();
});

test('leaving the temporal route stops playback and ignores a late frame paint', async () => {
  const temporal = async params => {
    if (params.mode === 'frame') await new Promise(resolve => setTimeout(resolve, 140));
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology', null, false, { temporal });
  const { document } = dom.window;
  await waitFor(() => dom.window.__marketFieldRequests.some(request => request.params.mode === 'frame'));
  document.querySelector('[data-view="data"]').click();
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(document.querySelector('.temporal-view-state'), null);
  assert(document.querySelector('.data-coverage'));

  dom.window.close();
  const playback = await page('/?view=topology', null, false, { temporal });
  const playbackDocument = playback.window.document;
  await waitFor(() => playbackDocument.querySelector('.temporal-play'));
  let clearedTimer = null;
  playback.window.setInterval = () => 8675;
  playback.window.clearInterval = timer => { clearedTimer = timer; };
  playbackDocument.querySelector('.temporal-play').click();
  playbackDocument.querySelector('[data-view="data"]').click();
  assert.equal(clearedTimer, 8675);
  await new Promise(resolve => setTimeout(resolve, 180));
  playback.window.close();
});

test('legacy reviewed-map claim link opens its exact retained evidence with scope warning', async () => {
  const claim = 'dbt-labs-announced-partnership-snowflake-2022';
  const dom = await page(`/?view=topology&topologyLayer=reviewed&selectedClaim=${claim}`);
  const { document } = dom.window;
  await waitFor(() => document.querySelector('#data-inspector .data-inspector-body'));
  assert.equal(new URL(dom.window.location.href).searchParams.get('dataRecord'), claim);
  assert.match(document.querySelector('#view').textContent, /former snapshot, date, filters and page cursor are not applied/);
  assert.match(document.querySelector('#data-inspector').textContent, /deepening their partnership/);
  assert.equal(document.querySelector('.topology-map'), null);
  dom.window.close();
});

test('source inventory route exposes 2020–2026 raw rows and keeps company years separate', async () => {
  const dom = await page('/?view=explore');
  const { document, Event } = dom.window;
  assert.match(document.querySelector('#view h2').textContent, /explore software sources/i);
  assert.match(document.querySelector('#view').textContent, /2020–2026/);
  assert.equal(document.querySelector('[aria-label="Select period-end year"]'), null);
  const source = document.querySelector('[aria-label="Pinned source and year"]');
  assert.equal(source.value, 'cncf-2026');
  await waitFor(() => document.querySelectorAll('.full-inventory-row').length > 0);

  source.value = 'lfai-2020';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  source.value = 'cncf-2026';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('.full-inventory [role="status"]')
    ?.textContent.includes('in this pinned source'));
  const newest = JSON.parse(await fs.readFile(path.join(web, 'discovery-inventory/cncf-2026.json')));
  assert(document.querySelector('.full-inventory [role="status"]').textContent
    .includes(newest.rows.length.toLocaleString()));

  source.value = 'cncf-2020';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('.full-inventory [role="status"]')?.textContent.includes('in this pinned source'));
  assert.equal(new URL(dom.window.location.href).searchParams.get('inventory'), 'cncf-2020');
  const partition = JSON.parse(await fs.readFile(path.join(web, 'discovery-inventory/cncf-2020.json')));
  const untagged = partition.rows.find(row => row.mapping_status === 'unmapped_category'
    && row.name.length > 5);
  assert(untagged);
  const query = document.querySelector('[aria-label="Search all rows in selected source snapshot"]');
  query.value = untagged.name;
  query.dispatchEvent(new Event('input', { bubbles: true }));
  assert(document.querySelector('.full-inventory-results').textContent.includes(untagged.name));
  assert(document.querySelector('.full-inventory-results').textContent.includes('untagged row'));
  assert(document.querySelector('.full-inventory-results a[href]'));

  const year = document.querySelector('[aria-label="Record year"]');
  year.value = '2020';
  year.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(new URL(dom.window.location.href).searchParams.get('recordYear'), '2020');
  assert.equal(new URL(dom.window.location.href).searchParams.get('year'), null);
  dom.window.history.back();
  await waitFor(() => document.querySelector('[aria-label="Record year"]').value === 'all');
  assert.equal(document.querySelector('[aria-label="Pinned source and year"]').value, 'cncf-2020');
  dom.window.history.forward();
  await waitFor(() => document.querySelector('[aria-label="Record year"]').value === '2020');
  const reloaded = await page(dom.window.location.pathname + dom.window.location.search);
  assert.equal(reloaded.window.document.querySelector('[aria-label="Record year"]').value, '2020');
  assert.equal(reloaded.window.document.querySelector('[aria-label="Pinned source and year"]').value, 'cncf-2020');
  assert.equal(reloaded.window.document.querySelector('[aria-label="Search all rows in selected source snapshot"]').value,
    untagged.name);
  await waitFor(() => reloaded.window.document.querySelector('.full-inventory [role="status"]')
    ?.textContent.includes('in this pinned source'));

  document.querySelector('[data-view="overview"]').click();
  assert.equal(document.querySelector('[aria-label="Select period-end year"]').value, '2024');
  assert.match(document.querySelector('#view').textContent, /2021–2024/);
  assert.equal(new URL(dom.window.location.href).searchParams.get('view'), 'overview');
  dom.window.close();
  reloaded.window.close();
});

test('a failed raw partition offers a working retry', async () => {
  const dom = await page('/?view=explore', '/discovery-inventory/cncf-2026.json');
  const { document } = dom.window;
  await waitFor(() => document.querySelector('.full-inventory [role="status"]')
    ?.textContent.includes('Could not load'));
  document.querySelector('.full-inventory-results button').click();
  await waitFor(() => document.querySelectorAll('.full-inventory-row').length > 0);
  dom.window.close();
});

test('compare navigation stays discoverable and empty direct compare offers a company action', async () => {
  const dom = await page('/?view=compare');
  const { document } = dom.window;
  assert.match(document.querySelector('#view').textContent, /pin two or more companies/);
  document.querySelector('#view button.quiet-button:last-child').click();
  assert.equal(new URL(dom.window.location.href).searchParams.get('view'), 'overview');
  assert.equal(document.querySelector('[data-view="compare"]').hidden, false);
  document.querySelector('[data-pin]').click();
  assert.equal(document.querySelector('[data-view="compare"]').hidden, false);
  assert.equal(document.querySelector('#pin-count').textContent, '1');
  document.querySelector('[data-view="compare"]').click();
  assert.match(document.querySelector('#view').textContent, /missing evidence is shown as missing/);
  document.querySelector('.compare-picker-disclosure').open = true;
  const selectedPin = document.querySelector('.compare-picker-disclosure [aria-pressed="true"]');
  assert(selectedPin);
  selectedPin.click();
  assert.match(document.querySelector('#view').textContent, /pin two or more companies/);
  document.querySelector('#view button.quiet-button:last-child').click();
  assert.equal(document.querySelector('[data-view="compare"]').hidden, false);
  dom.window.close();
});

test('source field starts with all retained candidates and drills into exact source rows', async () => {
  const dom = await page('/?view=topology&topologyLayer=field');
  const { document, Event } = dom.window;
  await waitFor(() => document.querySelector('.field-coverage')?.textContent.includes('47,288'));
  assert.match(document.querySelector('.field-coverage').textContent, /1,240/);
  assert.equal(document.querySelectorAll('.field-dot').length, 1240);
  document.querySelector('.field-index-row').click();
  await waitFor(() => document.querySelector('.field-observation .field-row-button'));
  assert(document.querySelector('.field-index').textContent.includes('neighbors'));
  const candidateId = new URL(dom.window.location.href).searchParams.get('fieldCandidate');
  assert(candidateId);
  document.querySelector('.field-observation .field-row-button').click();
  await waitFor(() => document.querySelector('.data-inspector .data-facts'));
  assert.equal(document.querySelector('[aria-label="Record family"]').value, 'inventory');
  const reopened = await page(`/?view=topology&fieldCandidate=${candidateId}`);
  await waitFor(() => reopened.window.document.querySelector('.field-observation'));
  assert.equal(new URL(reopened.window.location.href).searchParams.get('fieldCandidate'), candidateId);
  reopened.window.close();
  dom.window.close();
});

test('source field filters all source candidates and preserves the selected filter in the URL', async () => {
  const dom = await page('/?view=topology&topologyLayer=field');
  const { document, Event } = dom.window;
  await waitFor(() => document.querySelector('.field-coverage')?.textContent.includes('47,288'));
  const source = document.querySelector('#field-source');
  source.value = 'lfai';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('#view')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.field-coverage'));
  assert.equal(new URL(dom.window.location.href).searchParams.get('fieldSource'), 'lfai');
  const filtered = Number(document.querySelector('.field-coverage-card strong').textContent.replaceAll(',', ''));
  assert(filtered > 0 && filtered < 1240);
  dom.window.close();
});

test('late filter responses cannot replace the latest market field result', async () => {
  const apiOptions = { holdQueries: false, pendingQueries: [] };
  apiOptions.handler = (params, { defaultHandler }) => {
    if (apiOptions.holdQueries && params.mode === 'query') {
      return new Promise(resolve => apiOptions.pendingQueries.push({ params,
        resolve: () => resolve({ body: defaultHandler(params), status: 200 }) }));
    }
    return { body: defaultHandler(params), status: 200 };
  };
  const dom = await page('/?view=topology&topologyLayer=field', null, false, apiOptions);
  const { document, Event } = dom.window;
  apiOptions.holdQueries = true;

  const year = document.querySelector('#field-year');
  year.value = '2020';
  year.dispatchEvent(new Event('change', { bubbles: true }));
  const source = document.querySelector('#field-source');
  source.value = 'lfai';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => apiOptions.pendingQueries.length === 2);

  const older = apiOptions.pendingQueries.find(item => item.params.year === '2020');
  const newer = apiOptions.pendingQueries.find(item => item.params.source === 'lfai');
  const expected = mockMarketField(newer.params).total_candidates;
  newer.resolve();
  await waitFor(() => document.querySelector('#view')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.field-coverage'));
  assert.equal(Number(document.querySelector('.field-coverage-card strong').textContent
    .replaceAll(',', '')), expected);

  older.resolve();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(Number(document.querySelector('.field-coverage-card strong').textContent
    .replaceAll(',', '')), expected);
  assert.equal(new URL(dom.window.location.href).searchParams.get('fieldSource'), 'lfai');
  dom.window.close();
});

test('late candidate detail cannot replace a newer selected neighbor detail', async () => {
  const apiOptions = { holdDetails: false, pendingDetails: [] };
  apiOptions.handler = (params, { defaultHandler }) => {
    if (apiOptions.holdDetails && params.mode === 'detail') {
      return new Promise(resolve => apiOptions.pendingDetails.push({ params,
        resolve: () => resolve({ body: defaultHandler(params), status: 200 }) }));
    }
    return { body: defaultHandler(params), status: 200 };
  };
  const dom = await page('/?view=topology&topologyLayer=field', null, false, apiOptions);
  const { document } = dom.window;
  apiOptions.holdDetails = true;
  document.querySelector('.field-index-row').click();
  await waitFor(() => apiOptions.pendingDetails.length === 1
    && document.querySelectorAll('.field-index-row').length > 1);
  const subjectId = apiOptions.pendingDetails[0].params.candidate;
  document.querySelector('.field-index-row').click();
  await waitFor(() => apiOptions.pendingDetails.length === 2);

  const current = apiOptions.pendingDetails.find(item => item.params.neighbor);
  const stale = apiOptions.pendingDetails.find(item => !item.params.neighbor);
  assert(current);
  current.resolve();
  await waitFor(() => document.querySelector('.field-shared-placement'));
  assert.match([...document.querySelectorAll('.field-inspector h4')].at(-1).textContent, /\//);
  stale.resolve();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert(document.querySelector('.field-shared-placement'));
  assert.equal(new URL(dom.window.location.href).searchParams.get('fieldCandidate'), subjectId);
  assert(new URL(dom.window.location.href).searchParams.get('fieldNeighbor'));
  dom.window.close();
});

test('a build mismatch refreshes the summary once and retries against its new build', async () => {
  const apiOptions = { summaryCount: 0, queryCount: 0 };
  apiOptions.handler = (params, { defaultHandler }) => {
    if (params.mode === 'summary') {
      apiOptions.summaryCount += 1;
      const buildId = apiOptions.summaryCount === 1 ? 'old-build' : 'new-build';
      return { body: mockMarketField(params, buildId), status: 200 };
    }
    if (params.mode === 'query') {
      apiOptions.queryCount += 1;
      const buildId = 'new-build';
      return { body: defaultHandler(params, buildId), status: 200 };
    }
    return { body: defaultHandler(params, 'new-build'), status: 200 };
  };
  const dom = await page('/?view=topology&topologyLayer=field', null, false, apiOptions);
  await waitFor(() => apiOptions.summaryCount === 2
    && dom.window.document.querySelector('.field-coverage'));
  assert.equal(apiOptions.summaryCount, 2);
  assert.equal(apiOptions.queryCount, 2);
  const summaryRequests = dom.window.__marketFieldRequests.filter(request =>
    request.params.mode === 'summary');
  assert.equal(summaryRequests.length, 2);
  assert(summaryRequests[1].params.refresh);
  assert.equal(dom.window.__marketFieldRequests.every(request =>
    request.options.cache === 'no-store'), true);
  assert.match(dom.window.document.querySelector('.field-coverage').textContent, /47,288/);
  dom.window.close();
});

test('repeated build mismatches stop after one automatic refresh', async () => {
  const apiOptions = { summaryCount: 0, queryCount: 0 };
  apiOptions.handler = (params, { defaultHandler }) => {
    if (params.mode === 'summary') {
      apiOptions.summaryCount += 1;
      return { body: mockMarketField(params, 'current-build'), status: 200 };
    }
    if (params.mode === 'query') {
      apiOptions.queryCount += 1;
      return { body: defaultHandler(params, 'older-build'), status: 200 };
    }
    return { body: defaultHandler(params, 'current-build'), status: 200 };
  };
  const dom = await page('/?view=topology&topologyLayer=field', null, false, apiOptions);
  assert.equal(apiOptions.summaryCount, 2);
  assert.equal(apiOptions.queryCount, 2);
  assert.match(dom.window.document.querySelector('.error').textContent,
    /changed again while loading/i);
  dom.window.close();
});

test('successful query responses cannot reset a repeated detail mismatch loop', async () => {
  const apiOptions = { summaryCount: 0, detailCount: 0 };
  apiOptions.handler = (params, { defaultHandler }) => {
    if (params.mode === 'summary') apiOptions.summaryCount += 1;
    if (params.mode === 'detail') {
      apiOptions.detailCount += 1;
      // Cap the fixture itself so a broken client cannot spin without a bound.
      if (apiOptions.detailCount > 3) return { status: 503, body: { error: 'fixture request cap' } };
      return { status: 409, body: { error: 'build_version_mismatch' } };
    }
    return { status: 200, body: defaultHandler(params) };
  };
  const candidate = topologyPayload.nodes[0].id;
  const dom = await page(`/?view=topology&fieldCandidate=${candidate}`, null, false, apiOptions);
  await waitFor(() => dom.window.document.querySelector('.error'));
  try {
    assert.equal(apiOptions.summaryCount, 2);
    assert.equal(apiOptions.detailCount, 2);
    assert.match(dom.window.document.querySelector('.error').textContent, /changed again/i);
  } finally { dom.window.close(); }
});

test('query errors can retry and a no-result filter has an explicit empty state', async () => {
  const apiOptions = { failed: false };
  apiOptions.handler = (params, { defaultHandler }) => {
    if (params.mode === 'query' && !apiOptions.failed) {
      apiOptions.failed = true;
      return { status: 503, body: { error: 'temporary field outage' } };
    }
    return { body: defaultHandler(params), status: 200 };
  };
  const dom = await page('/?view=topology&topologyLayer=field', null, false, apiOptions);
  const { document, Event } = dom.window;
  assert.match(document.querySelector('.error').textContent, /temporary field outage/);
  document.querySelector('button.quiet-button').click();
  await waitFor(() => document.querySelector('.field-coverage'));

  const search = document.querySelector('#field-search');
  search.value = 'no-candidate-can-match-this-phrase';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => document.querySelector('#view')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.empty-state')?.textContent.includes('No candidates'));
  assert.equal(document.querySelectorAll('.field-dot').length, 0);
  assert.equal(document.querySelector('.field-coverage-card strong').textContent, '0');
  dom.window.close();
});

test('candidate and neighbor deep links open the exact source inspector', async () => {
  const edge = topologyPayload.edges[0];
  const route = `/?view=topology&fieldCandidate=${edge.subject_candidate_id}`
    + `&fieldNeighbor=${edge.object_candidate_id}`;
  const dom = await page(route);
  const { document } = dom.window;
  await waitFor(() => document.querySelector('.field-shared-placement'));
  assert.match([...document.querySelectorAll('.field-inspector h4')].at(-1).textContent, /\//);
  const provenance = document.querySelector('.field-shared-placement');
  assert.match(provenance.textContent, /shared artifact [a-f0-9]{12}/i);
  assert(provenance.querySelectorAll('.field-row-button').length >= 2);
  assert.match(provenance.textContent, new RegExp(edge.observations[0].subject_rows[0].name));
  assert.match(provenance.textContent, new RegExp(edge.observations[0].object_rows[0].name));
  dom.window.close();
});

test('candidate and neighbor lists request bounded follow-up pages', async () => {
  const dom = await page('/?view=topology&topologyLayer=field');
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('.field-index-row').length, 80);
  document.querySelector('.field-show-more').click();
  await waitFor(() => document.querySelectorAll('.field-index-row').length === 160);
  const nextCandidateRequest = dom.window.__marketFieldRequests.find(request =>
    request.params.mode === 'query' && request.params.offset === '80');
  assert(nextCandidateRequest);
  assert.equal(nextCandidateRequest.params.limit, '80');

  const [candidate, neighborMap] = [...topology.neighbors.entries()]
    .find(([, neighbors]) => neighbors.size > 1);
  const allNeighborIds = [...neighborMap.keys()].sort();
  const apiOptions = { candidate, allNeighborIds };
  apiOptions.handler = (params, { defaultHandler }) => {
    const response = defaultHandler(params);
    if (params.mode !== 'query' || params.candidate !== candidate) {
      return { body: response, status: 200 };
    }
    const allNeighbors = response.neighbors;
    if (Number(params.neighbor_offset || 0) === 0) {
      response.neighbors = allNeighbors.slice(0, 1);
      response.next_neighbor_offset = 1;
    } else {
      response.neighbors = allNeighbors.slice(1, 2);
      response.next_neighbor_offset = null;
    }
    return { body: response, status: 200 };
  };
  const focused = await page(`/?view=topology&fieldCandidate=${candidate}`, null, false, apiOptions);
  const focusedDocument = focused.window.document;
  await waitFor(() => focusedDocument.querySelector('.field-show-more-neighbors'));
  const firstPageNeighbor = focusedDocument.querySelector('.field-index-row strong').textContent;
  focusedDocument.querySelector('.field-show-more-neighbors').click();
  await waitFor(() => focusedDocument.querySelectorAll('.field-index-row').length === 2);
  const neighborRequest = focused.window.__marketFieldRequests.find(request =>
    request.params.candidate === candidate && request.params.neighbor_offset === '1');
  assert(neighborRequest);
  assert.equal(neighborRequest.params.neighbor_limit, '500');
  assert.notEqual(focusedDocument.querySelectorAll('.field-index-row strong')[1].textContent,
    firstPageNeighbor);
  const neighbor = allNeighborIds[1];
  const directLink = await page(`/?view=topology&fieldCandidate=${candidate}&fieldNeighbor=${neighbor}`,
    null, false, apiOptions);
  await waitFor(() => directLink.window.document.querySelector('.field-shared-placement'));
  assert(directLink.window.__marketFieldRequests.some(request => request.params.mode === 'detail'
    && request.params.candidate === candidate && request.params.neighbor === neighbor));
  directLink.window.close();
  focused.window.close();
  dom.window.close();
});

test('reduced motion advances one retained stop without starting playback', async () => {
  const temporal = async params => marketFieldApi.handleMarketField(new URLSearchParams(params));
  const dom = await page('/?view=topology&topologyLayer=temporal&temporalSource=lfai&temporalMode=snapshot&temporalYear=2024',
    null, false, { temporal });
  await waitFor(() => dom.window.document.querySelector('.temporal-play'));
  let playbackTimers = 0;
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.setInterval = () => { playbackTimers += 1; return 1; };
  dom.window.document.querySelector('.temporal-play').click();
  await waitFor(() => dom.window.document.querySelector('.constellation-eyebrow')?.textContent.includes('2025'));
  assert.equal(playbackTimers, 0);
  assert.equal(new URL(dom.window.location.href).searchParams.get('temporalYear'), '2025');
  dom.window.close();
});


test('the home route requests the broader accumulated CNCF field', async () => {
  const requests = [];
  const temporal = async params => {
    requests.push(params);
    return marketFieldApi.handleMarketField(new URLSearchParams(params));
  };
  const dom = await page('/', null, true, { temporal });
  try {
    await waitFor(() => dom.window.document.querySelector('.temporal-transition-status')?.dataset.state === 'ready');
    const request = requests.find(item => item.mode === 'frame');
    assert.equal(request.source, 'cncf');
    assert.equal(request.temporal_mode, 'accumulated');
    assert.match(dom.window.document.querySelector('.temporal-frame-summary').textContent, /observed through 2024/);
  } finally { dom.window.close(); }
});


test('visible overview top-k controls update the graph, persist through time, and reset', async () => {
  const temporal = async params => {
    const result = marketFieldApi.handleMarketField(new URLSearchParams(params));
    return { status: result.status, body: result.body };
  };
  const dom = await page('/?view=topology&temporalSource=cncf&temporalYear=2024', null, true, { temporal });
  try {
    const document = dom.window.document;
    const nodes = document.querySelector('[aria-label="top-k nodes"]');
    const edges = document.querySelector('[aria-label="top-k connections"]');
    assert.equal(nodes.value, '150');
    assert.equal(edges.value, '500');
    assert.equal(document.querySelectorAll('.constellation-node').length, 150);
    assert.match(document.querySelector('.temporal-frame-summary').textContent, /150 of 852 nodes shown/);
    nodes.value = '50';
    nodes.dispatchEvent(new dom.window.Event('change'));
    await waitFor(() => document.querySelectorAll('.constellation-node').length === 50);
    edges.value = '100';
    edges.dispatchEvent(new dom.window.Event('change'));
    await waitFor(() => document.querySelectorAll('.constellation-context line').length === 100);
    assert.equal(new URL(dom.window.location.href).searchParams.get('temporalNodeLimit'), '50');
    assert.equal(new URL(dom.window.location.href).searchParams.get('temporalEdgeLimit'), '100');
    const previousFrame = document.querySelector('.temporal-frame-id').textContent;
    document.querySelector('.temporal-rail .temporal-step:last-child').click();
    await waitFor(() => document.querySelector('.temporal-frame-id').textContent !== previousFrame);
    assert.equal(nodes.value, '50');
    assert.equal(edges.value, '100');
    assert.equal(document.querySelectorAll('.constellation-node').length, 50);
    document.querySelector('.temporal-density button').click();
    await waitFor(() => document.querySelectorAll('.constellation-node').length === 150);
    assert.equal(nodes.value, '150');
    assert.equal(edges.value, '500');
  } finally { dom.window.close(); }
});

test('investor question, company notes and exact citations survive research navigation and reload', async () => {
  const dom = await page('/index.html?view=compare&pinned=datadog,weights-and-biases');
  let restored;
  try {
    const { document, Event, history } = dom.window;
    const question = document.querySelector('#decision-question');
    question.value = 'Which developer-first company deserves more diligence?';
    question.dispatchEvent(new Event('input', { bubbles: true }));
    const why = document.querySelector('#decision-datadog-why');
    why.value = 'Test a recurring-use hypothesis.';
    why.dispatchEvent(new Event('input', { bubbles: true }));
    const cite = document.querySelector('.decision-evidence select');
    cite.value = 'supports';
    cite.dispatchEvent(new Event('change', { bubbles: true }));
    assert.match(document.querySelector('.decision-evidence summary').textContent, /1 cited/);
    const saved = dom.window.localStorage.getItem('log-pose.decision-brief.v1');
    assert.match(saved, /Which developer-first/);
    assert.doesNotMatch(dom.window.location.href, /Which|recurring-use|supports/);
    document.querySelector('.decision-evidence button').click();
    assert.equal(new URL(dom.window.location.href).searchParams.get('view'), 'data');
    await waitFor(() => document.querySelector('.data-inspector .data-reading'));
    history.back();
    await waitFor(() => document.querySelector('#decision-question'));
    assert.equal(document.querySelector('#decision-question').value, question.value);
    assert.equal(document.querySelector('#decision-datadog-why').value, why.value);
    assert.equal(document.querySelector('.decision-evidence select').value, 'supports');
    restored = await page('/index.html?view=compare&pinned=datadog', null, false, { decisionDraft: saved });
    assert.equal(restored.window.document.querySelector('#decision-question').value, question.value);
    assert.equal(restored.window.document.querySelector('#decision-datadog-why').value, why.value);
    assert.deepEqual(dom.window.__routeErrors, []);
  } finally { dom.window.close(); restored?.window.close(); }
});

test('invalid or blocked browser storage does not overwrite saved notes or prevent a session draft', async () => {
  for (const options of [{ decisionDraft: '{invalid' }, { blockStorage: true }]) {
    const dom = await page('/index.html?view=compare&pinned=datadog', null, false, options);
    try {
      const { document, Event } = dom.window;
      assert.match(document.querySelector('.decision-storage').textContent, /has not been overwritten/);
      const question = document.querySelector('#decision-question');
      question.value = 'Session-only question';
      question.dispatchEvent(new Event('input', { bubbles: true }));
      assert.equal(document.querySelector('.decision-actions button').disabled, false);
      if (options.decisionDraft) assert.equal(dom.window.localStorage.getItem('log-pose.decision-brief.v1'), '{invalid');
      assert.deepEqual(dom.window.__routeErrors, []);
    } finally { dom.window.close(); }
  }
});

test('decision brief begins with an explicit question and no fabricated recommendations', async () => {
  const dom = await page('/index.html?view=compare&pinned=weights-and-biases');
  try {
    const document = dom.window.document;
    assert.equal(document.querySelector('.decision-actions button').disabled, true);
    assert.equal(document.querySelector('#decision-question').value, '');
    assert.equal(document.querySelector('.decision-company select').value, 'undecided');
    assert.match(document.querySelector('.decision-brief').textContent, /does not filter or verify company eligibility/);
    assert.equal(document.querySelectorAll('.decision-evidence select').length > 0, true);
    assert.deepEqual(dom.window.__routeErrors, []);
  } finally { dom.window.close(); }
});

test('record search preserves a middle-of-query caret and unrelated source errors do not hide empty states', async () => {
  const dom = await page('/index.html?view=data', '/data/inventory-search.json');
  try {
    const { document, Event } = dom.window;
    await waitFor(() => document.querySelector('#view .error'));
    const family = document.querySelector('[aria-label="Record family"]');
    family.value = 'pages';
    family.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(document.querySelector('#view .error'), null);
    const query = document.querySelector('#data-query');
    query.value = 'no-such-company';
    query.setSelectionRange(3, 3);
    query.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(document.querySelector('#data-query').selectionStart, 3);
    assert.match(document.querySelector('.empty-state').textContent, /No retained records/);
    assert.deepEqual(dom.window.__routeErrors, []);
  } finally { dom.window.close(); }
});

test('a stale second tab cannot silently overwrite a newer saved investor draft', async () => {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const first = await page('/index.html?view=compare&pinned=datadog', null, false, { storage });
  const second = await page('/index.html?view=compare&pinned=datadog', null, false, { storage, captureDownloads: true });
  try {
    const question = first.window.document.querySelector('#decision-question');
    question.value = 'First tab question';
    question.dispatchEvent(new first.window.Event('input', { bubbles: true }));
    const why = first.window.document.querySelector('#decision-datadog-why');
    why.value = 'First tab reasoning';
    why.dispatchEvent(new first.window.Event('input', { bubbles: true }));
    const firstSaved = saved;
    const scope = second.window.document.querySelector('#decision-scope');
    scope.value = 'Second tab scope';
    scope.dispatchEvent(new second.window.Event('input', { bubbles: true }));
    assert.equal(saved, firstSaved);
    assert.match(second.window.document.querySelector('.decision-storage').textContent, /another tab changed/);
    assert.equal(scope.value, 'Second tab scope');
    const secondQuestion = second.window.document.querySelector('#decision-question');
    secondQuestion.value = 'Second tab question';
    secondQuestion.dispatchEvent(new second.window.Event('input', { bubbles: true }));
    second.window.document.querySelector('.decision-actions button').click();
    const exported = await new Promise((resolve, reject) => {
      const reader = new second.window.FileReader();
      reader.onload = () => resolve(JSON.parse(reader.result));
      reader.onerror = reject;
      reader.readAsText(second.window.__downloadBlob);
    });
    assert.equal(exported.investor_question, 'Second tab question');
    assert.equal(exported.investor_scope, 'Second tab scope');
    assert.equal(JSON.parse(saved).question, 'First tab question');
    assert.equal(JSON.parse(saved).notes[0].why, 'First tab reasoning');
    first.window.dispatchEvent(new first.window.StorageEvent('storage', {
      key: 'log-pose.decision-brief.v1', newValue: 'another saved revision'
    }));
    assert.match(first.window.document.querySelector('.decision-storage').textContent, /another tab changed/);
  } finally { first.window.close(); second.window.close(); }
});

test('saved citation links enforce catalog build identity before displaying any evidence', async () => {
  const index = JSON.parse(await fs.readFile(path.join(web, 'data/index.json'), 'utf8'));
  const record = index.pages[0];
  for (const build of ['0'.repeat(64), 'malformed-build']) {
    const dom = await page(`/index.html?view=data&dataFamily=pages&dataRecord=${record.id}&dataBuild=${build}`);
    try {
      const document = dom.window.document;
      assert.match(document.querySelector('#view h2').textContent, /saved evidence build unavailable/);
      assert.equal(document.querySelector('.data-inspector'), null);
      document.querySelector('#view button').click();
      assert.equal(new URL(dom.window.location.href).searchParams.has('dataRecord'), false);
      assert.equal(new URL(dom.window.location.href).searchParams.has('dataBuild'), false);
      assert.match(document.querySelector('#data-inspector').textContent, /Select a record/);
      dom.window.history.back();
      await waitFor(() => document.querySelector('#view h2')?.textContent === 'saved evidence build unavailable');
      assert.equal(document.querySelector('.data-inspector'), null);
      dom.window.history.forward();
      await waitFor(() => document.querySelector('#data-inspector'));
    } finally { dom.window.close(); }
  }
  const matching = await page(`/index.html?view=data&dataFamily=pages&dataRecord=${record.id}&dataBuild=${index.build_id}`);
  try {
    await waitFor(() => matching.window.document.querySelector('.data-inspector .data-reading'));
    assert.equal(new URL(matching.window.location.href).searchParams.get('dataBuild'), index.build_id);
    const reloaded = await page(matching.window.location.pathname + matching.window.location.search);
    try {
      await waitFor(() => reloaded.window.document.querySelector('.data-inspector .data-reading'));
      assert.equal(new URL(reloaded.window.location.href).searchParams.get('dataBuild'), index.build_id);
    } finally { reloaded.window.close(); }
  } finally { matching.window.close(); }
});

test('citation capacity protects reload and unavailable references can be removed', async () => {
  const model = require('../web/research-model.js');
  const draft = model.emptyDecisionDraft();
  draft.notes.push({ ...model.decisionNote(draft, 'datadog'), citations:
    Array.from({ length: model.MAX_DECISION_CITATIONS }, (_, index) => ({
      id: `page:unavailable-${index}`, role: 'context', catalog_build_id: '0'.repeat(64)
    })) });
  const initial = JSON.stringify(draft);
  const dom = await page('/index.html?view=compare&pinned=datadog', null, false, { decisionDraft: initial });
  let reloaded;
  try {
    const { document, Event } = dom.window;
    const role = document.querySelector('.decision-evidence select');
    role.value = 'supports';
    role.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(role.value, '');
    assert.equal(dom.window.localStorage.getItem('log-pose.decision-brief.v1'), initial);
    assert.match(document.querySelector('.decision-storage').textContent, /citation limit reached/);
    document.querySelector('.decision-stale-citation button').click();
    role.value = 'supports';
    role.dispatchEvent(new Event('change', { bubbles: true }));
    const saved = dom.window.localStorage.getItem('log-pose.decision-brief.v1');
    assert.equal(model.parseDecisionDraft(saved).notes[0].citations.length, model.MAX_DECISION_CITATIONS);
    reloaded = await page('/index.html?view=compare&pinned=datadog', null, false, { decisionDraft: saved });
    assert.equal(reloaded.window.document.querySelector('.decision-evidence select').value, 'supports');
    assert.equal(reloaded.window.document.querySelectorAll('.decision-stale-citation').length, 99);
  } finally { dom.window.close(); reloaded?.window.close(); }
});

test('leaving a stale saved link can open current in-app citations without carrying the old build lock', async () => {
  const index = JSON.parse(await fs.readFile(path.join(web, 'data/index.json'), 'utf8'));
  const dom = await page('/index.html?view=data&dataRecord=page:19&pinned=datadog&dataBuild=' + '0'.repeat(64));
  try {
    const { document } = dom.window;
    document.querySelector('[data-view="compare"]').click();
    document.querySelector('.decision-evidence button').click();
    await waitFor(() => document.querySelector('#data-inspector .data-reading'));
    assert.equal(new URL(dom.window.location.href).searchParams.get('dataBuild'), index.build_id);
    document.querySelector('[data-view="overview"]').click();
    [...document.querySelectorAll('button')].find(button => button.textContent === 'inspect dated evidence →').click();
    [...document.querySelectorAll('#company-detail button')]
      .find(button => button.textContent === 'inspect all retained records →').click();
    assert.equal(new URL(dom.window.location.href).searchParams.get('dataBuild'), index.build_id);
    assert.match(document.querySelector('#view h2').textContent, /research the record/);
    await waitFor(() => !document.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
    assert.deepEqual(dom.window.__routeErrors, []);
  } finally { dom.window.close(); }
});
