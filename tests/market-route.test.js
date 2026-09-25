const test = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const topologyOracle = require('./fixtures/discovery-topology-oracle.js');

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
            const response = apiOptions.handler
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

test('canonical route searches retained evidence and opens a full page record', async () => {
  const dom = await page();
  const { document, Event } = dom.window;
  assert.match(document.querySelector('#view h2').textContent, /research the record/i);
  assert.match(document.querySelector('.data-coverage').textContent, /18,076/);
  await waitFor(() => document.querySelector('.data-results-head')?.textContent.includes('18,542 matching records')
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
  const inventory = await page('/?dataFamily=inventory&dataQuery=Airship');
  const inventoryDocument = inventory.window.document;
  await waitFor(() => inventoryDocument.querySelector('.data-results-head')?.textContent.includes('matching records')
    && !inventoryDocument.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  assert.match(inventoryDocument.querySelector('.data-results').textContent, /Airship/);
  inventoryDocument.querySelector('.data-result').click();
  await waitFor(() => inventoryDocument.querySelector('.data-inspector-body .data-facts'));
  assert.match(inventoryDocument.querySelector('.data-inspector').textContent, /unmapped_category/);
  assert.match(inventoryDocument.querySelector('.data-inspector').textContent, /No candidate tag or reviewed company link/);
  inventory.window.close();

  const navigation = await page('/?dataFamily=inventory&dataQuery=ClickHouse');
  const navigationDocument = navigation.window.document;
  await waitFor(() => !navigationDocument.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  navigationDocument.querySelector('.data-result').click();
  await waitFor(() => navigationDocument.querySelector('.data-inspector-body')?.textContent.includes('identity status'));
  assert.match(navigationDocument.querySelector('.data-inspector').textContent, /Navigation match.*unreviewed.*navigation_match_unreviewed/i);
  assert.doesNotMatch(navigationDocument.querySelector('.data-inspector').textContent, /Reviewed relationship to ClickHouse/);
  navigation.window.close();

  const sec = await page('/?dataFamily=sec&dataCompany=palantir&dataYear=2021');
  const secDocument = sec.window.document;
  assert.match(secDocument.querySelector('.data-results-head').textContent, /matching records/);
  secDocument.querySelector('.data-result').click();
  await waitFor(() => secDocument.querySelector('.data-inspector-body')?.textContent.includes('Selection policy'));
  assert.match(secDocument.querySelector('.data-inspector').textContent, /accession/i);
  assert(secDocument.querySelectorAll('.data-alternative').length > 0);
  sec.window.close();
});

test('research desk market point opens participant detail and topology shows review history', async () => {
  const market = await page('/?dataFamily=market&dataQuery=FINRA');
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

  const topology = await page('/?dataFamily=topology');
  const topologyDocument = topology.window.document;
  topologyDocument.querySelector('.data-result').click();
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /review history/i);
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /source/i);
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /reviewed_at|reviewer|review history/i);
  topology.window.close();
});

test('opening a claim map clears filters that would hide the selected claim', async () => {
  const dom = await page('/?view=topology&topologyLayer=reviewed');
  const { document, Event } = dom.window;
  const status = document.querySelector('[aria-label="Filter claim status"]');
  status.value = 'documented';
  status.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-view="data"]').click();
  document.querySelector('[aria-label="Record family"]').value = 'topology';
  document.querySelector('[aria-label="Record family"]').dispatchEvent(new Event('change', { bubbles: true }));
  const hypothesis = [...document.querySelectorAll('.data-result')].find(button =>
    button.textContent.includes('hypothesis'));
  hypothesis.click();
  document.querySelector('.data-inspector button.text-button:last-child').click();
  assert.equal(document.querySelector('[aria-label="Filter claim status"]').value, 'all');
  assert.match(document.querySelector('.topology-claim-detail').textContent, /shared business driver/i);
  const reopened = await page(dom.window.location.pathname + dom.window.location.search);
  assert.match(reopened.window.document.querySelector('.topology-claim-detail').textContent,
    /shared business driver/i);
  reopened.window.close();
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

test('filtered topology WebGL maps each matching claim and lets every shown edge open its evidence', async () => {
  const dom = await page('/?view=topology&topologyLayer=reviewed', null, true);
  const { document, Event } = dom.window;
  document.querySelector('[aria-label="switch to 3d relationship map"]').click();
  const status = document.querySelector('[aria-label="Filter claim status"]');
  status.value = 'hypothesis';
  status.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('.topology-webgl-edge-button'));

  const edges = [...document.querySelectorAll('.topology-webgl-edge-button')];
  assert.equal(edges.length, 1);
  assert.equal(edges[0].dataset.claimStatus, 'hypothesis');
  const hypothesisVertexCount = dom.window.__mockWebglBufferUploads.at(-2);
  assert(hypothesisVertexCount > 100,
    'hypothesis draws separated dots instead of a continuous line');
  assert.match(edges[0].getAttribute('aria-label'), /business driver.*hypothesis/i);
  assert.match(document.querySelector('.topology-map-coverage').textContent, /Map shows 1 of 1 matching claims/);
  edges[0].click();
  await waitFor(() => document.querySelector('.topology-claim-detail'));
  assert.match(document.querySelector('.topology-claim-detail').textContent,
    /What remains unknown|shared business driver/i);
  assert.equal(document.querySelector('.topology-webgl-edge-button').getAttribute('aria-pressed'), 'true');

  status.value = 'documented';
  status.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.topology-webgl-edge-button').length === 3);
  const documentedVertexCount = dom.window.__mockWebglBufferUploads.at(-2);
  assert(documentedVertexCount > 0, 'documented claims draw as source-stated lines');
  dom.window.close();
});

test('source field starts with all retained candidates and drills into exact source rows', async () => {
  const dom = await page('/?view=topology');
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
  const dom = await page('/?view=topology');
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
  const dom = await page('/?view=topology', null, false, apiOptions);
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
  const dom = await page('/?view=topology', null, false, apiOptions);
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
  const dom = await page('/?view=topology', null, false, apiOptions);
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
  const dom = await page('/?view=topology', null, false, apiOptions);
  assert.equal(apiOptions.summaryCount, 2);
  assert.equal(apiOptions.queryCount, 2);
  assert.match(dom.window.document.querySelector('.error').textContent,
    /changed again while loading/i);
  dom.window.close();
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
  const dom = await page('/?view=topology', null, false, apiOptions);
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
  const dom = await page('/?view=topology');
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
