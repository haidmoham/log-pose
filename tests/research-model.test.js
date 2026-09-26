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

test('temporal 3d coordinates are id-stable and orbit changes projection without changing depth source', () => {
  const anchor = { x: 620, y: 270 };
  const first = model.temporalSpatialPosition('candidate:one', anchor);
  const repeated = model.temporalSpatialPosition('candidate:one', anchor);
  const other = model.temporalSpatialPosition('candidate:two', anchor);
  assert.deepEqual(first, repeated);
  assert.notEqual(first.z, other.z);
  const front = model.projectTemporalPoint(first, -.52, -.28);
  const orbited = model.projectTemporalPoint(first, .24, -.28);
  assert.notDeepEqual([front.x, front.y], [orbited.x, orbited.y]);
  assert(front.scale >= .58 && front.scale <= 1.55);
  assert(front.opacity >= .52 && front.opacity <= 1);
});

test('temporal decorative colors are stable, bounded to the shared palette, and varied', () => {
  const ids = Array.from({ length: 24 }, (_, index) => `candidate:${index}`);
  const first = ids.map(id => model.temporalDisplayTint(id));
  const repeated = ids.map(id => model.temporalDisplayTint(id));
  assert.deepEqual(first, repeated);
  assert(new Set(first.map(tint => tint.hex)).size >= 4);
  for (const tint of first) {
    assert.match(tint.hex, /^#[0-9a-f]{6}$/);
    assert.equal(tint.rgb.length, 3);
    assert(tint.rgb.every(channel => channel >= 0 && channel <= 255));
  }
});

test('URL state validates routes, years, slugs, duplicates, and pin capacity', () => {
  const slugs = new Set(['a', 'b', 'c', 'd', 'e']);
  const state = model.parseUrlState('?view=compare&year=2023&company=b&pinned=a,b,a,c,d,e,nope', slugs, [2021, 2022, 2023, 2024]);
  assert.equal(state.view, 'compare');
  assert.equal(state.year, 2023);
  assert.equal(state.company, 'b');
  assert.deepEqual(state.pinned, ['a', 'b', 'c', 'd']);
  assert.equal(model.parseUrlState('?view=unknown&year=1999', slugs, [2021, 2022]).view, 'data');
  assert.equal(model.parseUrlState('?view=topology', slugs, [2024]).view, 'topology');
});

test('data desk URL state defaults to all sources and validates each selector', () => {
  const allSlugs = new Set(['pilot', 'external']);
  const pilotSlugs = new Set(['pilot']);
  const defaults = model.parseUrlState('?view=data', allSlugs, [2021, 2022, 2023, 2024], [], pilotSlugs);
  assert.equal(defaults.view, 'data');
  assert.equal(defaults.dataFamily, 'all');
  assert.equal(defaults.dataCompany, 'all');
  assert.equal(defaults.dataYear, 'all');
  assert.equal(defaults.dataRecord, '');

  const parsed = model.parseUrlState(
    '?view=data&dataFamily=topology&dataQuery=Snowflake&dataCompany=pilot&dataYear=2026&dataRecord=claim:seed-1',
    allSlugs, [2021, 2022, 2023, 2024], [], pilotSlugs);
  assert.deepEqual([parsed.dataFamily, parsed.dataQuery, parsed.dataCompany,
    parsed.dataYear, parsed.dataRecord], ['topology', 'Snowflake', 'pilot', '2026', 'claim:seed-1']);

  const invalid = model.parseUrlState(
    '?view=data&dataFamily=unknown&dataQuery=' + 'x'.repeat(230)
      + '&dataCompany=external&dataYear=2029&dataRecord=../../bad',
    allSlugs, [2021, 2022, 2023, 2024], [], pilotSlugs);
  assert.equal(invalid.dataFamily, 'all');
  assert.equal(invalid.dataQuery.length, 200);
  assert.equal(invalid.dataCompany, 'all');
  assert.equal(invalid.dataYear, 'all');
  assert.equal(invalid.dataRecord, '');

  const serialized = model.toUrlParams({ ...parsed, compareSlugs: [] });
  assert.equal(serialized.includes('year='), false);
  assert.deepEqual(model.parseUrlState('?' + serialized, allSlugs,
    [2021, 2022, 2023, 2024], [], pilotSlugs), parsed);
});

test('legacy explore URLs remain explore routes after the data desk becomes default', () => {
  const slugs = new Set(['pilot']);
  assert.equal(model.parseUrlState('?q=datadog', slugs, [2021, 2024]).view, 'explore');
  const legacy = model.parseUrlState('?company=pilot&inventory=cncf-2024', slugs,
    [2021, 2024], ['cncf-2026', 'cncf-2024']);
  assert.equal(legacy.view, 'explore');
  const serialized = model.toUrlParams({ ...legacy, compareSlugs: [] });
  assert.equal(new URLSearchParams(serialized).get('view'), 'explore');
  assert.equal(model.parseUrlState('?' + serialized, slugs, [2021, 2024],
    ['cncf-2026', 'cncf-2024']).inventoryArtifact, 'cncf-2024');
});

test('a pinned comparison does not turn a data-desk URL into a legacy explore route', () => {
  const slugs = new Set(['pilot']);
  const state = model.parseUrlState('?view=data', slugs, [2021, 2024], [], slugs);
  const url = model.toUrlParams({ ...state, compareSlugs: ['pilot'] });
  assert.equal(model.parseUrlState('?' + url, slugs, [2021, 2024], [], slugs).view, 'data');
});

test('temporal frame pages preserve stable URLs and reject unsafe offsets', () => {
  const valid = model.parseUrlState(
    '?view=topology&topologyLayer=temporal&temporalCandidate=vespa&temporalOffset=120',
    new Set(), [2024]);
  assert.equal(valid.temporalOffset, 120);
  const serialized = model.toUrlParams({ ...valid, compareSlugs: [] });
  assert.equal(new URLSearchParams(serialized).get('temporalOffset'), '120');
  assert.equal(model.parseUrlState('?' + serialized, new Set(), [2024]).temporalOffset, 120);
  assert.equal(model.parseUrlState('?view=topology&temporalOffset=-1', new Set(), [2024]).temporalOffset, 0);
  assert.equal(model.parseUrlState('?view=topology&temporalOffset=999999', new Set(), [2024]).temporalOffset, 5000);
});

test('a temporal neighbor requires a selected candidate', () => {
  const neighborOnly = model.parseUrlState(
    '?view=topology&temporalNeighbor=neighbor-id', new Set(), [2024]);
  assert.equal(neighborOnly.temporalNeighbor, null);
  assert.equal(new URLSearchParams(model.toUrlParams({ ...neighborOnly,
    compareSlugs: [] })).has('temporalNeighbor'), false);

  const focused = model.parseUrlState(
    '?view=topology&temporalCandidate=focus-id&temporalNeighbor=neighbor-id',
    new Set(), [2024]);
  assert.equal(focused.temporalNeighbor, 'neighbor-id');
});

test('relationship claim, status, category, and source year survive a URL round trip', () => {
  const slugs = new Set(['datadog', 'elastic']);
  const parsed = model.parseUrlState(
    '?view=topology&company=datadog&topologySourceYear=2025&topologyCategory=competition&topologyStatus=documented&selectedClaim=claim:seed-1',
    slugs, [2021, 2022, 2023, 2024]);
  assert.equal(parsed.selectedClaim, 'claim:seed-1');
  assert.equal(parsed.topologySourceYear, '2025');
  const serialized = model.toUrlParams({ ...parsed, compareSlugs: [] });
  assert.deepEqual(model.parseUrlState('?' + serialized, slugs, [2021, 2022, 2023, 2024]), parsed);

  const invalid = model.parseUrlState(
    '?view=topology&topologySourceYear=2030&topologyCategory=merger&topologyStatus=accepted&selectedClaim=../../bad',
    slugs, [2021, 2022, 2023, 2024]);
  assert.deepEqual([invalid.topologySourceYear, invalid.topologyCategory,
    invalid.topologyStatus, invalid.selectedClaim], ['all', 'all', 'all', null]);
});

test('temporal atlas opens by default and explicit field links preserve their filters', () => {
  const slugs = new Set();
  const parsed = model.parseUrlState('?view=topology&fieldQuery=vector&fieldSource=lfai'
    + '&fieldYear=2024&fieldTag=data_infrastructure&fieldCategory=Data%20%2F%20Operations'
    + '&fieldIdentity=unreviewed&fieldCandidate=004c9f6b7ecc1c48c8e4', slugs, [2024]);
  assert.equal(parsed.topologyLayer, 'field');
  assert.equal(model.parseUrlState('?view=topology', slugs, [2024]).topologyLayer, 'temporal');
  assert.equal(model.parseUrlState('', slugs, [2024]).view, 'topology');
  const serialized = model.toUrlParams({ ...parsed, compareSlugs: [] });
  assert.deepEqual(model.parseUrlState('?' + serialized, slugs, [2024]), parsed);
  const fieldHome = model.parseUrlState('?view=topology&topologyLayer=field', slugs, [2024]);
  const fieldHomeUrl = model.toUrlParams({ ...fieldHome, compareSlugs: [] });
  assert.equal(new URLSearchParams(fieldHomeUrl).get('topologyLayer'), 'field');
  assert.equal(model.parseUrlState('?' + fieldHomeUrl, slugs, [2024]).topologyLayer, 'field');
});

test('market file, date, measure, and participant survive a URL round trip', () => {
  const route = '?view=data&dataFamily=market&dataRecord=market-file:4&dataMarketDay=2024-01-03'
    + '&dataMarketMeasure=total_notional&dataMarketParticipant=market-row:4:19';
  const parsed = model.parseUrlState(route, new Set(), [2024]);
  assert.deepEqual([parsed.dataRecord, parsed.dataMarketDay, parsed.dataMarketMeasure,
    parsed.dataMarketParticipant], ['market-file:4', '2024-01-03', 'total_notional', 'market-row:4:19']);
  const serialized = model.toUrlParams({ ...parsed, compareSlugs: [] });
  assert.deepEqual(model.parseUrlState('?' + serialized, new Set(), [2024]), parsed);
});

test('market route keeps inventory controls separate from the SEC period', () => {
  const artifacts = ['cncf-2026', 'cncf-2020', 'lfai-2020'];
  const parsed = model.parseUrlState(
    '?inventory=lfai-2020&inventoryQuery=untagged&q=vector&recordYear=2020&source=lfai&type=lead&category=data_infrastructure',
    new Set(), [2021, 2022, 2023, 2024], artifacts);
  assert.equal(parsed.view, 'explore');
  assert.equal(parsed.year, 2024);
  assert.equal(parsed.inventoryArtifact, 'lfai-2020');
  assert.equal(parsed.inventoryQuery, 'untagged');
  assert.equal(parsed.searchYear, '2020');
  const url = model.toUrlParams({ ...parsed, compareSlugs: [] });
  assert(!url.includes('year=2024'));
  assert.deepEqual(model.parseUrlState('?' + url, new Set(), [2021, 2022, 2023, 2024], artifacts), parsed);
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

test('graph slice starts with connected high-degree nodes and includes a selected claim', () => {
  const claims = [
    topologyClaim('hub-a', 'hub', 'a', 'integrates_with', '2024-01-01'),
    topologyClaim('hub-b', 'hub', 'b', 'integrates_with', '2024-01-01'),
    topologyClaim('hub-c', 'hub', 'c', 'integrates_with', '2024-01-01'),
    topologyClaim('solo-z', 'y', 'z', 'named_competitor_of', '2024-01-01')
  ];
  const slice = model.topologyGraphSlice(claims, null, 3, 48);
  assert.deepEqual(new Set(slice.claims.map(claim => claim.id)), new Set(['hub-a', 'hub-b']));
  assert.equal(slice.hiddenClaims, 2);

  const selected = model.topologyGraphSlice(claims, null, 3, 48, 'solo-z');
  assert(selected.claims.some(claim => claim.id === 'solo-z'));
  assert.equal(selected.hiddenClaims, 3);
});

test('filtered graph slice cannot hide every matching claim behind unrelated nodes', () => {
  const claims = Array.from({ length: 24 }, (_, index) =>
    topologyClaim(`claim-${index}`, 'hub', `neighbor-${index}`,
      'shared_exposure_hypothesis', '2025-01-01'));
  const matching = model.filterTopologyClaims(claims, { company: 'neighbor-23' });
  const slice = model.topologyGraphSlice(matching, 'neighbor-23');
  assert.deepEqual(slice.claims.map(claim => claim.id), ['claim-23']);
  assert.equal(slice.hiddenClaims, 0);
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


test('the atlas defaults to accumulated CNCF evidence and preserves explicit snapshot links', () => {
  const defaults = model.parseUrlState('', new Set(), [2024]);
  assert.equal(defaults.temporalSource, 'cncf');
  assert.equal(defaults.temporalMode, 'accumulated');
  assert.equal(defaults.temporalYear, '2024');
  const explicit = model.parseUrlState('?temporalSource=lfai&temporalMode=snapshot', new Set(), [2024]);
  assert.equal(explicit.temporalSource, 'lfai');
  assert.equal(explicit.temporalMode, 'snapshot');
  const serialized = model.toUrlParams({ ...explicit, compareSlugs: [] });
  assert.equal(model.parseUrlState('?' + serialized, new Set(), [2024]).temporalMode, 'snapshot');
});


test('overview top-k defaults and explicit values survive URL round trips', () => {
  const defaults = model.parseUrlState('', new Set(), [2024]);
  assert.equal(defaults.temporalNodeLimit, '150');
  assert.equal(defaults.temporalEdgeLimit, '500');
  const selected = model.parseUrlState('?view=topology&temporalNodeLimit=all&temporalEdgeLimit=1000', new Set(), [2024]);
  const restored = model.parseUrlState('?' + model.toUrlParams({ ...selected, compareSlugs: [] }), new Set(), [2024]);
  assert.equal(restored.temporalNodeLimit, 'all');
  assert.equal(restored.temporalEdgeLimit, '1000');
  const invalid = model.parseUrlState('?temporalNodeLimit=-50&temporalEdgeLimit=999999', new Set(), [2024]);
  assert.equal(invalid.temporalNodeLimit, '150');
  assert.equal(invalid.temporalEdgeLimit, '500');
});
