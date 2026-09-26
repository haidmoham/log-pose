'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAtlasHandler, handleAtlas, LIMITS, selectTopK } = require('../api/atlas.js');

function fixture(t, memberCount = 4) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'log-pose-atlas-test-'));
  const buildId = 'a'.repeat(64);
  const file = path.join(directory, `${buildId}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE candidate(id TEXT PRIMARY KEY,name TEXT,summary_json TEXT);
    CREATE VIRTUAL TABLE candidate_search USING fts5(id UNINDEXED,text);
    CREATE TABLE artifact(id TEXT PRIMARY KEY,source TEXT,inventory_year INTEGER,raw_sha256 TEXT,detail_json TEXT);
    CREATE TABLE placement(id TEXT PRIMARY KEY,artifact_id TEXT,category TEXT,member_count INTEGER);
    CREATE TABLE membership(candidate_id TEXT,placement_id TEXT,detail_json TEXT,PRIMARY KEY(candidate_id,placement_id));
    CREATE INDEX membership_placement ON membership(placement_id,candidate_id);
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); BEGIN;`);
  for (const year of [2023, 2024]) {
    const artifact = { id: `artifact-${year}`, source: 'catalog', inventory_year: year,
      raw_sha256: String(year).repeat(16), url: `https://example.test/${year}` };
    db.prepare('INSERT INTO artifact VALUES(?,?,?,?,?)').run(artifact.id, artifact.source,
      year, artifact.raw_sha256, JSON.stringify(artifact));
    db.prepare('INSERT INTO placement VALUES(?,?,?,?)').run(`placement-${year}`, artifact.id, 'tools', memberCount);
  }
  for (let index = 0; index < memberCount; index += 1) {
    const id = `candidate-${String(index).padStart(5, '0')}`;
    const candidate = { id, name: `tool ${index}`, description: 'source evidence', identity_review: null };
    db.prepare('INSERT INTO candidate VALUES(?,?,?)').run(id, candidate.name, JSON.stringify(candidate));
    db.prepare('INSERT INTO candidate_search VALUES(?,?)').run(id, `${candidate.name} source evidence`);
    for (const year of index === 2 ? [2023] : index === 3 ? [2024] : [2023, 2024]) {
      const row = { id: `${id}-${year}`, name: candidate.name, source_path: [index] };
      db.prepare('INSERT INTO membership VALUES(?,?,?)').run(id, `placement-${year}`,
        JSON.stringify({ occurrence_ids: [row.id], rows: [row] }));
    }
  }
  const manifest = { schema_version: '1.0', build_id: buildId,
    versions: { query: 'atlas-query-v1', layout: 'atlas-address-v1' },
    database: `${buildId}.sqlite`, counts: { candidates: memberCount, artifacts: 2 } };
  db.prepare('INSERT INTO metadata VALUES(?,?)').run('manifest', JSON.stringify(manifest));
  db.exec('COMMIT'); db.close();
  manifest.database_bytes = fs.statSync(file).size;
  manifest.database_sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  for (const name of ['current.json', `${buildId}.json`]) fs.writeFileSync(path.join(directory, name), JSON.stringify(manifest));
  const handler = createAtlasHandler(directory);
  t.after(() => { handler.close(); fs.rmSync(directory, { recursive: true }); });
  const request = (mode, fields = {}) => handler(new URLSearchParams({ mode, build_id: buildId, ...fields }));
  return { handler, request, directory, buildId };
}

test('discovery sends source revisions and budgets without the whole candidate corpus', t => {
  const { request } = fixture(t);
  const result = request('discover');
  assert.equal(result.status, 200);
  assert.equal(result.body.artifacts.length, 2);
  assert.equal(result.body.candidates, undefined);
  assert.equal(result.body.limits.response_bytes, 1024 * 1024);
});

test('focus pages count distinct neighbors and bind cursors to source, mode, build and limit', t => {
  const { request } = fixture(t);
  const fields = { candidate: 'candidate-00000', source: 'catalog', year: '2024', limit: '1' };
  const first = request('focus', fields);
  assert.equal(first.status, 200);
  assert.equal(first.body.count.value, 2);
  assert.equal(first.body.count.status, 'exact');
  assert.equal(first.body.edges.length, 1);
  const second = request('focus', { ...fields, cursor: first.body.next_cursor });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.edges[0].candidate_id, first.body.edges[0].candidate_id);
  assert.equal(second.body.next_cursor, null);
  assert.equal(request('focus', { ...fields, year: '2023', cursor: first.body.next_cursor }).status, 409);
  assert.equal(request('focus', { ...fields, limit: '2', cursor: first.body.next_cursor }).status, 409);
  const accumulated = request('focus', { ...fields, temporal_mode: 'accumulated', limit: '100' });
  assert.equal(accumulated.body.count.value, 3);
  assert.equal(accumulated.body.edges[0].supporting_placements, 2);
  assert.equal(accumulated.body.edges[0].placement_ids, undefined);
  assert.equal(accumulated.body.explanation.mode, 'explain');
});

test('explanation returns exact source rows, comparison names observation differences, missing clocks fail', t => {
  const { request } = fixture(t);
  const fields = { source: 'catalog', year: '2024', candidate: 'candidate-00000' };
  const detail = request('explain', { ...fields, neighbor: 'candidate-00001' });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.premises[0].subject.rows[0].id, 'candidate-00000-2024');
  assert.equal(detail.body.premises[0].object.rows[0].id, 'candidate-00001-2024');
  assert.equal(detail.body.premises[0].placement.inventory_year, 2024);
  const compare = request('compare', { ...fields, compare_year: '2023' });
  assert.equal(compare.status, 200);
  assert.deepEqual(compare.body.changes.map(item => [item.candidate_id, item.status]), [
    ['candidate-00001', 'observed_in_both'], ['candidate-00002', 'only_in_comparison_slice'],
    ['candidate-00003', 'only_in_selected_slice']]);
  assert.equal(request('focus', { ...fields, year: '2022' }).body.error, 'missing_snapshot');
  assert.equal(request('focus', { ...fields, clock: 'ingestion' }).body.error, 'unsupported_clock');
  for (const unsupported of [{ layer: 'capital' }, { predicate: 'invested_in' }, { direction: 'out' }]) {
    assert.equal(request('focus', { ...fields, ...unsupported }).body.error, 'unsupported_layer');
  }
});

test('source and FTS pages have no duplicate or missing candidates', t => {
  const { request } = fixture(t);
  for (const fields of [{}, { query: 'source' }, { source: 'catalog', year: '2024' }, { placement: 'placement-2024' }]) {
    const found = [];
    let cursor = '';
    do {
      const response = request('search', { ...fields, limit: '1', cursor });
      assert.equal(response.status, 200);
      found.push(...response.body.candidates.map(item => item.id));
      cursor = response.body.next_cursor;
      assert(found.length <= 4);
    } while (cursor);
    assert.deepEqual(found, fields.year || fields.placement
      ? ['candidate-00000', 'candidate-00001', 'candidate-00003']
      : ['candidate-00000', 'candidate-00001', 'candidate-00002', 'candidate-00003']);
  }
});

test('old builds fail explicitly and the API never loads the legacy corpus', t => {
  const { request, handler } = fixture(t);
  assert.equal(request('focus', { build_id: 'b'.repeat(64), candidate: 'candidate-00000' }).status, 410);
  assert.equal(handler(new URLSearchParams('mode=focus')).status, 409);
  assert.equal(request('focus', { candidate: 'candidate-00000', limit: '101' }).status, 400);
  assert.equal(request('focus', { build_id: '../private' }).status, 410);
  assert.equal(request('search', { query: '* ()' }).body.error, 'invalid_request');
  assert.equal(request('search', { query: '" OR * ()' }).body.candidates.length, 0);
  assert(!Object.keys(require.cache).some(file => file.endsWith('topology-discovery.json')));
});

test('same-size snapshot corruption cannot retain an immutable build identity', t => {
  const { request, directory, buildId } = fixture(t);
  const filename = path.join(directory, `${buildId}.sqlite`);
  const before = fs.statSync(filename).size;
  const database = new DatabaseSync(filename);
  database.prepare('UPDATE candidate SET name=? WHERE id=?').run('evil 0', 'candidate-00000');
  database.close();
  assert.equal(fs.statSync(filename).size, before);
  assert.equal(request('discover').body.error, 'snapshot_mismatch');
});

test('accumulated comparison keeps earlier revisions and export uses separate evidence bounds', t => {
  const { request } = fixture(t);
  const fields = { candidate: 'candidate-00000', source: 'catalog', year: '2024', temporal_mode: 'accumulated' };
  const compared = request('compare', { ...fields, compare_year: '2024', compare_artifact: 'artifact-2024' });
  assert.equal(compared.status, 200);
  assert(compared.body.changes.every(change => change.status === 'observed_in_both'));
  assert.equal(compared.body.comparison_selection.artifact, '');
  const exported = request('export', { ...fields, neighbor: 'candidate-00001', limit: '100', evidence_limit: '1' });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.evidence.premises.length, 1);
  assert(exported.body.evidence.next_cursor);
});

test('dense 10,000-member focus uses memberships without materializing its 49,995,000 pairs', t => {
  const { request } = fixture(t, 10000);
  const result = request('focus', { source: 'catalog', year: '2024', candidate: 'candidate-00000' });
  assert.equal(result.status, 200);
  assert.equal(result.body.edges.length, 60);
  assert.equal(result.body.count.value, 9998); // one candidate is observed only in 2023.
  assert(result.body.work.membership_rows_read < 11000);
  assert(Buffer.byteLength(JSON.stringify(result.body)) < LIMITS.response_bytes);
  const pruned = request('focus', { candidate: 'candidate-00000', top_k: '20' });
  assert.equal(pruned.status, 200);
  assert.equal(pruned.body.edges.length, 20);
  assert.equal(pruned.body.ranking.pruned, 9979);
  assert.equal(pruned.body.count.value, 9999);
  assert.equal(pruned.body.next_cursor, null);
  assert(pruned.body.edges.every(edge => edge.supporting_placements === 2));
  assert.equal(request('focus', { candidate: 'candidate-00000', top_k: '101' }).status, 400);
});

test('bounded heap top-k equals exhaustive ranking including deterministic tied supports', () => {
  const connections = Array.from({ length: 997 }, (_, index) => ({ candidate_id: `id-${String(index).padStart(4, '0')}`,
    supporting_placements: (index * 73) % 31 }));
  const expected = [...connections].sort((left, right) => right.supporting_placements - left.supporting_placements
    || left.candidate_id.localeCompare(right.candidate_id));
  for (const k of [1, 20, 60, 100]) {
    assert.deepEqual(selectTopK(connections, k), expected.slice(0, k));
    assert.deepEqual(selectTopK([...connections].reverse(), k), expected.slice(0, k));
  }
});

test('traversal returns premises and never promotes the path into a relationship', t => {
  const { request } = fixture(t);
  const result = request('traverse', { candidate: 'candidate-00002', target: 'candidate-00003', hops: '2' });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.path.length, 2);
  assert(result.body.path.every(edge => edge.predicate === 'exact_inventory_colisting' && edge.placement_ids.length));
});

test('shipped snapshot S0 focused reads preserve pinned oracle neighbors and source premises', () => {
  const graph = JSON.parse(fs.readFileSync(path.join(__dirname, '../api/data/market-field-graph.json')));
  const discovery = handleAtlas(new URLSearchParams('mode=discover'));
  assert.equal(discovery.status, 200);
  assert.equal(discovery.body.counts.candidates, 1240);
  for (const id of ['004c9f6b7ecc1c48c8e4', graph.candidates[0].id]) {
    const candidateIndex = graph.candidates.findIndex(item => item.id === id);
    const expected = graph.adjacency[candidateIndex].map(index => {
      const [left, right] = graph.pairs[index];
      return graph.candidates[left === candidateIndex ? right : left].id;
    }).sort();
    let cursor = '';
    const found = [];
    do {
      const result = handleAtlas(new URLSearchParams({ mode: 'focus', build_id: discovery.body.build_id,
        candidate: id, limit: '100', cursor }));
      assert.equal(result.status, 200);
      assert.equal(result.body.count.value, expected.length);
      found.push(...result.body.edges.map(edge => edge.candidate_id));
      cursor = result.body.next_cursor;
    } while (cursor);
    assert.deepEqual(found.sort(), expected);
  }
});
