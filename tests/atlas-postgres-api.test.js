'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createAtlasHandler } = require('../api/atlas.js');
const { createPostgresHandler } = require('../api/atlas-postgres.js');

const databaseUrl = process.env.LOG_POSE_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function parameters(mode, fields = {}) {
  return new URLSearchParams({ mode, ...fields });
}

test('a failed rollback discards the connection instead of pooling its transaction', async () => {
  let discarded = false;
  const client = {
    async query(statement) {
      if (statement === 'ROLLBACK' || (statement.text && statement.text.includes('gold.atlas_current'))) {
        throw new Error('connection ended');
      }
      return { rows: [] };
    },
    release(discard) { discarded = discard; }
  };
  const handler = createPostgresHandler({ connect: async () => client, end: async () => {} });
  assert.equal((await handler(parameters('discover'))).status, 503);
  assert.equal(discarded, true);
});

integration('postgres S0 matches exact sqlite top-k, paging and evidence contracts', async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const postgres = createPostgresHandler(pool);
  const sqlite = createAtlasHandler();
  t.after(async () => { sqlite.close(); await postgres.close(); });

  const pgDiscovery = await postgres(parameters('discover'));
  const sqliteDiscovery = sqlite(parameters('discover'));
  assert.equal(pgDiscovery.status, 200);
  assert.equal(pgDiscovery.body.build_id, sqliteDiscovery.body.build_id);
  assert.deepEqual(pgDiscovery.body.artifacts, sqliteDiscovery.body.artifacts);
  const buildId = pgDiscovery.body.build_id;
  const graph = JSON.parse(fs.readFileSync(path.join(__dirname, '../api/data/market-field-graph.json')));
  const candidateIndex = graph.adjacency.reduce((best, edges, index) =>
    edges.length > graph.adjacency[best].length ? index : best, 0);
  const base = { build_id: buildId, candidate: graph.candidates[candidateIndex].id,
    source: 'cncf', year: '2024', top_k: '20', limit: '7' };
  const pgFirst = await postgres(parameters('focus', base));
  const sqliteFirst = sqlite(parameters('focus', base));
  assert.equal(pgFirst.status, 200);
  assert.deepEqual(pgFirst.body.edges, sqliteFirst.body.edges);
  assert.deepEqual(pgFirst.body.count, sqliteFirst.body.count);
  assert.deepEqual(pgFirst.body.ranking, sqliteFirst.body.ranking);
  assert(pgFirst.body.next_cursor);
  const pgSecond = await postgres(parameters('focus', { ...base, cursor: pgFirst.body.next_cursor }));
  const sqliteSecond = sqlite(parameters('focus', { ...base, cursor: sqliteFirst.body.next_cursor }));
  assert.deepEqual(pgSecond.body.edges, sqliteSecond.body.edges);
  assert.equal(pgSecond.body.frame_id, pgFirst.body.frame_id);

  const neighbor = pgFirst.body.edges[0].candidate_id;
  const evidenceFields = { ...base, top_k: undefined, limit: '1', neighbor };
  delete evidenceFields.top_k;
  const pgEvidence = await postgres(parameters('explain', evidenceFields));
  const sqliteEvidence = sqlite(parameters('explain', evidenceFields));
  assert.equal(pgEvidence.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(pgEvidence.body.premises)),
    JSON.parse(JSON.stringify(sqliteEvidence.body.premises)));
  assert.deepEqual(pgEvidence.body.count, sqliteEvidence.body.count);
});

integration('postgres operations keep bounded selectors and response shapes', async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const handler = createPostgresHandler(pool);
  t.after(() => handler.close());
  const discovery = await handler(parameters('discover'));
  const build_id = discovery.body.build_id;
  const selection = { build_id, source: 'cncf', year: '2024' };
  const regions = await handler(parameters('regions', { ...selection, limit: '2' }));
  assert.equal(regions.status, 200);
  assert(regions.body.regions.length > 0 && regions.body.regions.length <= 2);
  const placement = regions.body.regions[0].id;
  const search = await handler(parameters('search', { ...selection, placement, limit: '2' }));
  assert.equal(search.status, 200);
  assert(search.body.candidates.length > 0);
  const text = await handler(parameters('search', { ...selection, query: search.body.candidates[0].name,
    limit: '2' }));
  assert.equal(text.status, 200);
  assert(text.body.candidates.some(row => row.id === search.body.candidates[0].id));

  const focusId = search.body.candidates[0].id;
  const focus = await handler(parameters('focus', { ...selection, candidate: focusId, top_k: '20' }));
  assert.equal(focus.status, 200);
  if (focus.body.edges.length) {
    const neighbor = focus.body.edges[0].candidate_id;
    const traversal = await handler(parameters('traverse', { ...selection, candidate: focusId,
      target: neighbor, hops: '1' }));
    assert.equal(traversal.body.status, 'found');
    const exported = await handler(parameters('export', { ...selection, candidate: focusId,
      neighbor, top_k: '20' }));
    assert.equal(exported.status, 200);
    assert.equal(exported.body.neighborhood.frame_id, undefined);
    assert.equal(exported.body.evidence.operation, 'explain');
  }
  const compared = await handler(parameters('compare', { ...selection, candidate: focusId,
    compare_year: '2023' }));
  assert.equal(compared.status, 200);
  assert.equal(compared.body.meaning,
    'observation differences, not product changes, relationship formation or exits');
  assert.equal((await handler(parameters('focus', { ...selection, candidate: focusId,
    clock: 'system_known' }))).body.error, 'unsupported_clock');
  const missing = await handler(parameters('focus', { ...selection, candidate: 'absent-candidate' }));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'unknown_candidate');
});

integration('dense 10,000-member placement returns exact deterministic top-k without pairs', async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const handler = createPostgresHandler(pool);
  const buildId = 'b'.repeat(64);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.atlas_snapshot(build_id,manifest) VALUES ($1,$2)
      ON CONFLICT (build_id) DO NOTHING`, [buildId, { build_id: buildId,
        schema_version: '1.0', versions: { query: 'atlas-query-v1', layout: 'atlas-address-v1' },
        counts: { candidates: 10000, artifacts: 1, placements: 1, memberships: 10000,
          supporting_occurrences: 10000 } }]);
    await client.query(`INSERT INTO public.atlas_artifact
      SELECT $1,'dense-artifact','synthetic',2024,repeat('a',64),
        jsonb_build_object('id','dense-artifact','source','synthetic','inventory_year',2024,
          'raw_sha256',repeat('a',64),'url','https://example.test/synthetic')
      ON CONFLICT DO NOTHING`, [buildId]);
    await client.query(`INSERT INTO public.atlas_placement
      VALUES ($1,'dense-placement','dense-artifact','synthetic_dense',10000)
      ON CONFLICT DO NOTHING`, [buildId]);
    await client.query(`INSERT INTO public.atlas_candidate(build_id,id,name,summary_json,search_text)
      SELECT $1,'dense-'||lpad(value::text,5,'0'),'dense '||value,
        jsonb_build_object('id','dense-'||lpad(value::text,5,'0'),'name','dense '||value,
          'record_type','inventory_candidate'),to_tsvector('simple','dense '||value)
      FROM generate_series(0,9999) value ON CONFLICT DO NOTHING`, [buildId]);
    await client.query(`INSERT INTO public.atlas_membership
      SELECT $1,'dense-'||lpad(value::text,5,'0'),'dense-placement',
        jsonb_build_object('occurrence_ids',jsonb_build_array('row-'||value),
          'rows',jsonb_build_array(jsonb_build_object('id','row-'||value,'name','dense '||value)))
      FROM generate_series(0,9999) value ON CONFLICT DO NOTHING`, [buildId]);
    await client.query('COMMIT');
  } finally { client.release(); }
  t.after(async () => {
    const cleanup = await pool.connect();
    try {
      await cleanup.query('BEGIN');
      for (const table of ['atlas_membership', 'atlas_placement', 'atlas_artifact',
        'atlas_candidate', 'atlas_snapshot']) {
        await cleanup.query(`DELETE FROM public.${table} WHERE build_id=$1`, [buildId]);
      }
      await cleanup.query('COMMIT');
    } finally { cleanup.release(); await handler.close(); }
  });
  const result = await handler(parameters('focus', { build_id: buildId,
    candidate: 'dense-00000', source: 'synthetic', year: '2024', top_k: '100', limit: '100' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.count.value, 9999);
  assert.equal(result.body.edges.length, 100);
  assert.deepEqual(result.body.edges.slice(0, 3).map(edge => edge.candidate_id),
    ['dense-00001', 'dense-00002', 'dense-00003']);
  assert(result.body.edges.every(edge => edge.supporting_placements === 1));
  assert(result.body.work.membership_rows_estimate <= 20001);
  const direct = await handler(parameters('traverse', { build_id: buildId,
    candidate: 'dense-00000', target: 'dense-00001', source: 'synthetic', year: '2024' }));
  assert.equal(direct.body.status, 'found');
});

test('query timeout rolls back and releases the checked-out client', async () => {
  const calls = [];
  const client = { async query(statement) {
    const text = statement.text ?? statement;
    calls.push(text);
    if (text.includes('FROM gold.atlas_current')) throw Object.assign(new Error('timeout'), { code: '57014' });
    return { rows: [] };
  }, release() { calls.push('release'); } };
  const pool = { async connect() { return client; }, async end() { calls.push('end'); } };
  const handler = createPostgresHandler(pool);
  const result = await handler(parameters('discover'));
  assert.equal(result.status, 422);
  assert.equal(result.body.error, 'query_budget_exceeded');
  assert(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1), 'release');
  await handler.close();
  assert.equal(calls.at(-1), 'end');
});
