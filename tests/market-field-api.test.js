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
    for (const candidate of [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates.at(-1)]) {
      if (!candidate) continue;
      const focused = request('query', { ...filters, candidate: candidate.id }).body;
      const expected = model.matchingNeighbors(prepared, candidate.id,
        candidates.map(item => item.id), filters);
      // The new contract adds an ID tie-breaker where the old model only used names.
      expected.sort((left, right) => right.keys.length - left.keys.length
        || left.candidate.name.localeCompare(right.candidate.name)
        || left.candidate.id.localeCompare(right.candidate.id));
      assert.equal(focused.neighbor_count, expected.length);
      assert.deepEqual(focused.neighbors.map(item => ({
        id: item.candidate.id, keys: item.keys.map(key => JSON.stringify(key)).sort()
      })),
        expected.slice(0, focused.neighbor_limit).map(item => ({
          id: item.candidate.id, keys: [...item.keys].sort()
        })));
    }
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

test('temporal timeline preserves year precision, pinned commit clocks, and partial coverage', () => {
  const result = request('timeline');
  assert.equal(result.status, 200);
  assert.equal(result.body.frames.length, 14);
  assert.equal(result.body.clocks.active, 'inventory_year');
  assert.equal(result.body.clocks.precision, 'year');
  assert.equal(result.body.clocks.source_publication, 'unknown');
  assert.equal(handleMarketField(new URLSearchParams('mode=timeline&build_id=old')).status, 409);
  const partial = result.body.frames.filter(frame => frame.coverage_status === 'partial_year_snapshot');
  assert.deepEqual(partial.map(frame => [frame.source, frame.year]), [['cncf', 2026], ['lfai', 2026]]);
  assert(partial.every(frame => frame.commit_at && frame.artifact_sha256 && frame.source_url));
});

test('snapshot and accumulated frames keep exact source-year-category overlap semantics', () => {
  const snapshot = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: '00a2fb1597f507022279' });
  const accumulated = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'accumulated',
    candidate: '00a2fb1597f507022279' });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.compare_year, 2023);
  assert.equal(snapshot.body.active_clock, 'inventory_year');
  assert(snapshot.body.edges.length > 0);
  assert.equal(accumulated.body.compare_year, 2023);
  assert(accumulated.body.edges.length >= snapshot.body.edges.length);
  assert.match(accumulated.body.comparison_description, /previously observed only/);
  for (const edge of accumulated.body.edges) {
    const leftCandidate = projection.nodes.find(candidate => candidate.id === '00a2fb1597f507022279');
    const rightCandidate = projection.nodes.find(candidate => candidate.id === edge.candidate_id);
    for (const placement of edge.placements) {
      assert.equal(placement[0], 'lfai');
      assert(placement[1] <= 2024);
      assert.equal(placement.length, 3);
      const left = leftCandidate.observations.find(item => item.source === placement[0]
        && item.year === placement[1] && item.source_category === placement[2]);
      const right = rightCandidate.observations.find(item => item.source === placement[0]
        && item.year === placement[1] && item.source_category === placement[2]);
      assert(left && right);
      assert.equal(left.artifact_sha256, right.artifact_sha256);
    }
  }
  const repeat = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: '00a2fb1597f507022279' });
  assert.deepEqual(snapshot.body, repeat.body);
});

test('focus frame pages are bounded, stable, and included in the reproducible frame id', () => {
  const focus = '00a2fb1597f507022279';
  const first = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: focus, limit: '5', offset: '0' });
  const second = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: focus, limit: '5', offset: '5' });
  const repeated = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: focus, limit: '5', offset: '5' });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.changes.length, 5);
  assert.equal(second.body.offset, 5);
  assert.equal(second.body.frame_id, repeated.body.frame_id);
  assert.notEqual(first.body.frame_id, second.body.frame_id);
  assert.deepEqual(second.body, repeated.body);
});

test('temporal category coverage counts only rows in the exact selected category', () => {
  const category = projection.nodes.flatMap(candidate => candidate.observations)
    .find(observation => observation.source === 'lfai' && observation.year === 2024)?.source_category;
  assert(category);
  const expected = projection.nodes.reduce((count, candidate) => count
    + candidate.observations.filter(observation => observation.source === 'lfai'
      && observation.year === 2024 && observation.source_category === category)
      .reduce((rows, observation) => rows + observation.rows.length, 0), 0);
  const result = request('frame', { source: 'lfai', year: '2024', category });
  assert.equal(result.status, 200);
  assert.equal(result.body.coverage.selected_rows, expected);
});

test('a future-only candidate ID does not leak a future display name into an empty historical frame', () => {
  const candidateId = '00d40d801bd8300d3c9b';
  const currentBuildName = projection.nodes.find(candidate => candidate.id === candidateId).name;
  const result = request('frame', { source: 'lfai', year: '2020', temporal_mode: 'snapshot',
    candidate: candidateId, compare_year: 'none' });
  assert.equal(result.status, 200);
  assert.equal(result.body.detail, null);
  assert.equal(result.body.nodes[0].name, `unobserved candidate ${candidateId.slice(0, 8)}`);
  assert.notEqual(result.body.nodes[0].name, currentBuildName);
});

test('all retained temporal stops stay within the bounded frame response budget', () => {
  const frames = request('timeline').body.frames;
  for (const frame of frames) {
    for (const temporalMode of ['snapshot', 'accumulated']) {
      const result = request('frame', { source: frame.source, year: String(frame.year), temporal_mode: temporalMode });
      assert.equal(result.status, 200);
      assert(Buffer.byteLength(JSON.stringify(result.body)) < 1024 * 1024,
        `${frame.source} ${frame.year} ${temporalMode} response exceeded one MiB`);
    }
  }
});

test('temporal edge detail resolves both exact retained rows and comparison reason', () => {
  const frame = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: '00a2fb1597f507022279' }).body;
  const comparable = frame.changes.find(change => change.status === 'observed_in_both');
  assert(comparable);
  const result = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    candidate: '00a2fb1597f507022279', neighbor: comparable.candidate_id });
  assert.equal(result.status, 200);
  assert.equal(result.body.detail.status, 'observed_in_both');
  const shared = result.body.detail.selected_placements[0];
  assert.equal(shared.source, 'lfai');
  assert.equal(shared.year, 2024);
  assert(shared.source_category);
  assert.equal(shared.subject_rows.length, shared.subject_occurrence_ids.length);
  assert.equal(shared.object_rows.length, shared.object_occurrence_ids.length);
  assert.match(shared.artifact_sha256, /^[a-f0-9]{64}$/);
  assert.match(shared.source_url, /^https:\/\//);
});

test('missing snapshots and unsupported clocks remain explicit', () => {
  const sameFrameComparison = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'snapshot',
    compare_year: '2024' });
  assert.equal(sameFrameComparison.status, 400); // a stop cannot compare with itself
  const unavailable = request('frame', { source: 'lfai', year: '2020', temporal_mode: 'snapshot',
    clock: 'event_validity' });
  assert.equal(unavailable.status, 400);
  const gap = request('frame', { source: 'lfai', year: '2019', temporal_mode: 'snapshot' });
  assert.equal(gap.status, 200);
  assert.equal(gap.body.status, 'missing_snapshot');
  const omitted = handleMarketField(new URLSearchParams({ mode: 'frame', build_id: graph.build_id,
    source: 'lfai', year: '2027', temporal_mode: 'snapshot' }));
  assert.equal(omitted.status, 200);
  assert.equal(omitted.body.status, 'missing_snapshot');
});

test('reviewed overlay and historical event clock cannot be requested as inventory frames', () => {
  const reviewed = request('frame', { source: 'lfai', year: '2024', temporal_mode: 'reviewed' });
  const eventClock = request('frame', { source: 'lfai', year: '2024', clock: 'event_validity' });
  assert.equal(reviewed.status, 400);
  assert.equal(eventClock.status, 400);
});

test('a retained neighbor with no support in either frame is not a disappearance', () => {
  const focus = '00a2fb1597f507022279';
  const frame = request('frame', { source: 'lfai', year: '2024', candidate: focus }).body;
  const dragonfly = frame.nodes.find(node => node.name === 'Dragonfly');
  const earlier = request('frame', { source: 'lfai', year: '2023', candidate: focus,
    neighbor: dragonfly.id }).body;
  assert.equal(earlier.detail.status, 'not_observed_in_either_frame');
  assert.deepEqual(earlier.detail.selected_placements, []);
  assert.deepEqual(earlier.detail.comparison_placements, []);
  const noComparison = request('frame', { source: 'lfai', year: '2024', candidate: focus,
    neighbor: dragonfly.id, compare_year: 'none' }).body;
  assert.equal(noComparison.detail.status, 'observed_without_comparison');
  assert(noComparison.changes.every(change => change.status === 'observed_without_comparison'));
});


test('overview top-k ranks the complete filtered slice and preserves coverage and edge endpoints', () => {
  const filters = { source: 'cncf', year: '2024', temporal_mode: 'accumulated' };
  const full = request('frame', filters).body;
  const limited = request('frame', { ...filters, node_limit: '150', edge_limit: '500' });
  assert.equal(limited.status, 200);
  const frame = limited.body;
  assert.equal(frame.nodes.length, 150);
  assert.equal(frame.context_edges.length, 500);
  assert.equal(frame.candidate_count, full.candidate_count);
  assert.equal(frame.total_context_edges, full.total_context_edges);
  assert.deepEqual(frame.coverage, full.coverage);
  assert(frame.candidates_truncated);
  assert(frame.context_edges_truncated);
  const visible = new Set(frame.nodes.map(node => node.id));
  assert(frame.context_edges.every(edge => visible.has(edge.left) && visible.has(edge.right)));
  assert.deepEqual(request('frame', { ...filters, node_limit: '150', edge_limit: '500' }).body, frame);
  const fewerEdges = request('frame', { ...filters, node_limit: '150', edge_limit: '100' }).body;
  assert.deepEqual(fewerEdges.nodes, frame.nodes);
  assert.deepEqual(fewerEdges.context_edges, frame.context_edges.slice(0, 100));
  assert.notEqual(fewerEdges.frame_id, frame.frame_id);
  const fewerNodes = request('frame', { ...filters, node_limit: '50', edge_limit: '500' }).body;
  assert.deepEqual(fewerNodes.nodes, frame.nodes.slice(0, 50));
  assert.notEqual(fewerNodes.frame_id, frame.frame_id);

  // Independently recover the rank from all retained pairs, not the old 2,500-edge response cap.
  const degrees = new Map();
  const rankedPairs = [];
  for (const [left, right, keys] of graph.pairs) {
    const count = keys.filter(index => graph.keys[index][0] === 'cncf' && graph.keys[index][1] <= 2024).length;
    if (!count) continue;
    const a = graph.candidates[left].id;
    const b = graph.candidates[right].id;
    degrees.set(a, (degrees.get(a) || 0) + 1);
    degrees.set(b, (degrees.get(b) || 0) + 1);
    if (visible.has(a) && visible.has(b)) rankedPairs.push({ left: a, right: b, count });
  }
  const expectedIds = full.nodes.toSorted((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0)
    || a.id.localeCompare(b.id)).slice(0, 150).map(node => node.id);
  assert.deepEqual(frame.nodes.map(node => node.id), expectedIds);
  rankedPairs.sort((a, b) => b.count - a.count || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
  assert.deepEqual(frame.context_edges, rankedPairs.slice(0, 500).map(({ left, right }) => ({ left, right })));
  assert.deepEqual(frame.nodes.map(node => node.position), frame.nodes.map(node => full.nodes.find(item => item.id === node.id).position));
  for (const bad of [{ node_limit: '0' }, { node_limit: '5001' }, { edge_limit: '0' }, { edge_limit: '2501' }, { edge_limit: 'NaN' }]) {
    assert.equal(request('frame', { ...filters, ...bad }).status, 400);
  }
});
