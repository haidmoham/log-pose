const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../api/data/market-field-graph.json');
const projection = require('../web/data/topology-discovery.json');
const { handleMarketField } = require('../api/market-field.js');
const model = require('./fixtures/discovery-topology-oracle.js');

const prepared = model.prepare(projection);
const base = { query: '', source: 'all', year: 'all', category: 'all', tag: 'all', identity: 'all' };

function request(mode, fields = {}) {
  return handleMarketField(new URLSearchParams({ mode, build_id: graph.build_id, ...fields }));
}

test('the shipped graph contains the full pair universe apart from the review worklist', () => {
  const summary = request('summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.candidates.length, prepared.nodes.size);
  assert.equal(summary.body.counts.possible_pairs, prepared.pairs.size);
  assert.equal(summary.body.counts.edges, projection.edges.length);
  assert.equal(summary.body.counts.nodes, 1240);
  assert.equal(summary.body.counts.possible_pairs, 47288);
  assert.equal(summary.body.counts.edges, 100);
  assert(summary.body.candidates.every(candidate => !('observations' in candidate)));
});

test('query matches the pure model for exact intersections, identity, search, and empty results', () => {
  const cases = [base,
    { ...base, source: 'lfai', year: '2021' },
    { ...base, source: 'cncf', year: '2024', category: 'CNAI / General Orchestration' },
    { ...base, tag: 'developer_tools', identity: 'reviewed' },
    { ...base, query: 'data' },
    { ...base, source: 'lfai', year: '2020', category: 'not in this source' },
    { ...base, query: 'a-query-that-cannot-match-any-candidate' }];
  for (const filters of cases) {
    const result = request('query', filters);
    assert.equal(result.status, 200);
    const candidates = model.matchingCandidates(prepared, filters);
    const pairs = model.matchingPairs(prepared, candidates.map(candidate => candidate.id), filters);
    assert.deepEqual(result.body.candidate_ids, candidates.map(candidate => candidate.id));
    assert.equal(result.body.pair_count, pairs.length);
    const expectedFlows = new Map();
    for (const pair of pairs) {
      const tags = [pair.left, pair.right].map(id =>
        model.TAG_ORDER.find(tag => prepared.nodes.get(id).candidate_tags.includes(tag))
        || model.TAG_ORDER[0]).sort();
      const key = tags.join(':');
      expectedFlows.set(key, (expectedFlows.get(key) || 0) + 1);
    }
    assert.deepEqual(result.body.tag_flows, [...expectedFlows]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => {
        const [left, right] = key.split(':');
        return { left, right, count };
      }));
    const observations = candidates.reduce((count, candidate) => count + candidate.observations
      .filter(observation => (filters.source === 'all' || observation.source === filters.source)
        && (filters.year === 'all' || observation.year === Number(filters.year))
        && (filters.category === 'all' || observation.source_category === filters.category)).length, 0);
    assert.equal(result.body.observation_count, observations);
  }
});

test('candidate and neighbor pages are stable, bounded, and report continuation', () => {
  const first = request('query', { limit: '17' }).body;
  const second = request('query', { limit: '17', offset: String(first.next_offset) }).body;
  assert.equal(first.candidates.length, 17);
  assert.equal(second.candidates.length, 17);
  assert.deepEqual([...first.candidates, ...second.candidates].map(candidate => candidate.id),
    first.candidate_ids.slice(0, 34));
  const highestDegree = graph.adjacency.map((indices, index) => ({ index, degree: indices.length }))
    .sort((left, right) => right.degree - left.degree)[0];
  const candidate = graph.candidates[highestDegree.index];
  const focused = request('query', { candidate: candidate.id, neighbor_limit: '13' }).body;
  const expected = model.matchingNeighbors(prepared, candidate.id, first.candidate_ids, base);
  assert.equal(focused.neighbor_count, expected.length);
  assert.equal(focused.neighbors.length, 13);
  assert.equal(focused.next_neighbor_offset, 13);
  assert.deepEqual(focused.neighbors.map(item => item.candidate.id),
    expected.slice(0, 13).map(item => item.candidate.id));
  const rest = request('query', { candidate: candidate.id, neighbor_limit: '500',
    neighbor_offset: '13' }).body;
  assert.equal(rest.neighbors.length, expected.length - 13);
  assert.equal(rest.next_neighbor_offset, null);
});

test('detail resolves both retained source rows and marks sampled review leads separately', () => {
  const edge = projection.edges[0];
  const result = request('detail', { candidate: edge.subject_candidate_id,
    neighbor: edge.object_candidate_id });
  assert.equal(result.status, 200);
  assert.equal(result.body.in_review_worklist, true);
  assert.equal(result.body.review_pair.id, edge.id);
  assert(result.body.shared_observations.length > 0);
  for (const shared of result.body.shared_observations) {
    assert.equal(shared.subject_occurrence_ids.length, shared.subject_rows.length);
    assert.equal(shared.object_occurrence_ids.length, shared.object_rows.length);
    assert(shared.subject_rows.every(row => row.id));
    assert(shared.object_rows.every(row => row.id));
    assert.match(shared.artifact_sha256, /^[a-f0-9]{64}$/);
  }
});

test('stale versions and invalid page limits fail with explicit responses', () => {
  assert.deepEqual(handleMarketField(new URLSearchParams('mode=query&build_id=old')),
    { status: 409, body: { error: 'build_version_mismatch', build_id: graph.build_id } });
  assert.equal(request('detail', { candidate: 'missing' }).status, 404);
  assert.equal(request('query', { limit: '101' }).status, 400);
  assert.equal(request('query', { neighbor_limit: '501' }).status, 400);
});

test('the pinned unfiltered responses stay below the one MiB read budget', () => {
  const summary = request('summary');
  const query = request('query');
  assert.equal(summary.status, 200);
  assert.equal(query.status, 200);
  assert(Buffer.byteLength(JSON.stringify(summary.body)) < 1024 * 1024);
  assert(Buffer.byteLength(JSON.stringify(query.body)) < 1024 * 1024);
});
