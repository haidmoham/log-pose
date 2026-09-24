const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../web/research-model.js');

function selected(value, start = '2024-01-01', end = '2024-12-31') {
  return { value, start_date: start, end_date: end, filed_date: '2025-02-01' };
}

test('financial calculations preserve missing and invalid source values', () => {
  const index = model.buildFinancialIndex([
    { slug: 'alpha', year: 2023, concept: 'revenue', selected: selected('100') },
    { slug: 'alpha', year: 2024, concept: 'revenue', selected: selected('') },
    { slug: 'alpha', year: 2024, concept: 'net_income', selected: selected('not-a-number') },
    { slug: 'alpha', year: 2024, concept: 'assets', selected: null }
  ]);
  assert.deepEqual(model.financialsFor(index, 'alpha', 2024), {
    revenue: null,
    netIncome: null,
    growth: null,
    margin: null,
    assets: null,
    periodStart: '2024-01-01',
    periodEnd: '2024-12-31',
    filed: '2025-02-01',
    accession: null,
    rawSha256: null
  });
});

test('margin requires aligned reported periods and growth requires a positive prior value', () => {
  const index = model.buildFinancialIndex([
    { slug: 'alpha', year: 2023, concept: 'revenue', selected: selected('0', '2023-01-01', '2023-12-31') },
    { slug: 'alpha', year: 2024, concept: 'revenue', selected: selected('200') },
    { slug: 'alpha', year: 2024, concept: 'net_income', selected: selected('20', '2024-02-01', '2024-12-31') }
  ]);
  const result = model.financialsFor(index, 'alpha', 2024);
  assert.equal(result.growth, null);
  assert.equal(result.margin, null);
});

test('chart scale keeps a zero baseline and splits missing periods', () => {
  const scaled = model.chartScale([10, null, -5, 15], 100, 40, 0);
  assert.equal(scaled.low, -5);
  assert.equal(scaled.high, 15);
  assert.equal(scaled.zeroY, 30);
  assert.equal(scaled.points[1], null);
  assert.deepEqual(model.contiguousSegments(scaled.points).map(segment => segment.length), [1, 2]);
});

test('URL state validates routes, years, slugs, duplicates, and pin capacity', () => {
  const slugs = new Set(['a', 'b', 'c', 'd', 'e']);
  const state = model.parseUrlState('?view=compare&year=2023&company=b&pinned=a,b,a,c,d,e,nope', slugs, [2021, 2022, 2023, 2024]);
  assert.deepEqual(state, {
    view: 'compare', year: 2023, company: 'b', pinned: ['a', 'b', 'c', 'd']
  });
  assert.equal(model.parseUrlState('?view=unknown&year=1999', slugs, [2021, 2022]).view, 'overview');
  assert.equal(model.parseUrlState('?view=topology', slugs, [2024]).view, 'topology');
});

test('pinning is immutable and enforces the comparison cap', () => {
  const original = ['a', 'b', 'c', 'd'];
  assert.deepEqual(model.togglePinned(original, 'e'), original);
  assert.notEqual(model.togglePinned(original, 'e'), original);
  assert.deepEqual(model.togglePinned(original, 'b'), ['a', 'c', 'd']);
});

test('financial index rejects duplicate cells at its declared grain', () => {
  assert.throws(() => model.buildFinancialIndex([
    { slug: 'alpha', year: 2024, concept: 'revenue', selected: selected('1') },
    { slug: 'alpha', year: 2024, concept: 'revenue', selected: selected('2') }
  ]), /duplicate financial cell/);
});

test('export validation catches missing arrays and broken foreign keys', () => {
  assert.throws(() => model.validateExports({}, {}), /missing pilot.years/);
  const pilot = {
    years: [2024], companies: [{ slug: 'alpha' }], evidence: [{ slug: 'unknown' }],
    reviewed_quotes: [], financing_announcements: [], us_location_reviews: [], market: [],
    financials: { cells: [] }
  };
  const discovery = {
    artifacts: [], candidates: [], occurrences: [], identity_reviews: [], provider_candidates: []
  };
  assert.throws(() => model.validateExports(pilot, discovery), /unknown company/);
});

function topologyClaim(id, subject, object, predicate, sourceDate) {
  return {
    id, subject_slug: subject, object_slug: object, predicate, direction: 'symmetric',
    scope: 'A stated workflow', claim_status: 'documented',
    interpretation: 'A bounded reading of the source', alternative_or_unknown: 'Current status unknown',
    sources: [{ publisher: 'Company', source_date: sourceDate, event_date: null,
      source_url: 'https://example.com', source_type: 'announcement',
      evidence_text: 'Exact source passage', retrieved_on: '2026-09-24' }]
  };
}

test('topology validation resolves optional external entities and rejects broken claims', () => {
  const claim = topologyClaim('one', 'pilot', 'external', 'integrates_with', '2024-03-01');
  const topology = { entities: [{ slug: 'external', name: 'External lead',
    identity_status: 'provider_lead' }], claims: [claim] };
  assert.equal(model.validateTopology(topology, new Set(['pilot'])), true);
  assert.throws(() => model.validateTopology({ claims: [claim] }, new Set(['pilot'])),
    /unknown company/);
  assert.throws(() => model.validateTopology({ ...topology, claims: [claim, claim] },
    new Set(['pilot'])), /duplicate topology claim/);
});

test('source-year filter uses publication date and preserves mixed claims on one pair', () => {
  const competition = topologyClaim('a', 'pilot', 'external',
    'named_competitor_of', '2024-08-01');
  const collaboration = topologyClaim('b', 'pilot', 'external',
    'announced_partnership_with', '2025-02-15');
  collaboration.sources[0].event_date = '2024-12-20';
  const claims = [competition, collaboration];
  assert.deepEqual(model.filterTopologyClaims(claims, { sourceYear: '2024' }).map(item => item.id), ['a']);
  assert.deepEqual(model.filterTopologyClaims(claims, { category: 'collaboration' }).map(item => item.id), ['b']);
  assert.deepEqual(model.topologyPairGroups(claims)[0].claims.map(item => item.id), ['a', 'b']);
});

test('investment and shared drivers remain distinct from collaboration', () => {
  assert.equal(model.topologyCategory('invested_in'), 'investment');
  assert.equal(model.topologyCategory('integrates_with'), 'collaboration');
  assert.equal(model.topologyCategory('shared_exposure_hypothesis'), 'performance_exposure');
  assert.equal(model.topologyCategory('unreviewed_relation'), 'unknown');
});

test('graph projection is bounded and keeps focused neighbors', () => {
  const claims = Array.from({ length: 24 }, (_, index) =>
    topologyClaim(`claim-${index}`, 'hub', `neighbor-${index}`,
      'shared_exposure_hypothesis', '2025-01-01'));
  const slice = model.topologyGraphSlice(claims, 'hub', 6, 4);
  assert.equal(slice.claims.length, 4);
  assert(slice.claims.every(claim => claim.subject_slug === 'hub'));
  assert.equal(slice.hiddenNodes, 19);
  assert.equal(model.topologyCategory(claims[0].predicate), 'performance_exposure');
});

test('graph coordinates stay stable when a claim filter hides an edge', () => {
  const claims = [topologyClaim('a', 'alpha', 'beta', 'integrates_with', '2023-01-01'),
    topologyClaim('b', 'beta', 'gamma', 'named_competitor_of', '2025-01-01')];
  const basePositions = model.topologyPositions(claims);
  const filtered = model.filterTopologyClaims(claims, { sourceYear: '2024' });
  const projected = model.topologyGraphSlice(claims);
  assert.deepEqual(model.topologyPositions(projected.claims).get('beta'), basePositions.get('beta'));
  assert.deepEqual(filtered.map(claim => claim.id), ['a']);
});

test('3d graph positions and projection remain deterministic across claim order', () => {
  const claims = [topologyClaim('a', 'alpha', 'beta', 'integrates_with', '2023-01-01'),
    topologyClaim('b', 'beta', 'gamma', 'named_competitor_of', '2025-01-01')];
  const forward = model.topologyPositions3d(claims);
  const reversed = model.topologyPositions3d(claims.slice().reverse());
  assert.deepEqual([...forward], [...reversed]);
  const front = model.projectTopologyPoint(forward.get('alpha'), 22, -14, 2.4);
  const turned = model.projectTopologyPoint(forward.get('alpha'), 112, -14, 2.4);
  assert.notEqual(front.x, turned.x);
  assert.ok(Number.isFinite(front.depth));
});

test('inventory partition validation binds every row to the pinned artifact', () => {
  const artifact = { source: 'cncf', year: 2026, raw_sha256: 'source-hash', raw_item_count: 1 };
  const row = { id: 'row-1', source: 'cncf', year: 2026,
    artifact_sha256: 'source-hash', source_path: [0, 0, 0],
    mapping_status: 'unmapped_category' };
  assert.equal(model.validateInventoryPartition(artifact,
    { source: 'cncf', year: 2026, raw_sha256: 'source-hash', rows: [row] }), true);
  assert.throws(() => model.validateInventoryPartition(artifact,
    { source: 'cncf', year: 2026, raw_sha256: 'source-hash', rows: [row, row] }),
  /partition does not match/);
  assert.throws(() => model.validateInventoryPartition(artifact,
    { source: 'cncf', year: 2026, raw_sha256: 'source-hash',
      rows: [{ ...row, artifact_sha256: 'different' }] }), /invalid or duplicate/);
});
