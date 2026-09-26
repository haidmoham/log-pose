'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createReviewedAtlasHandler } = require('../api/atlas-reviewed.js');

const root = path.join(__dirname, '../api/data/atlas-reviewed');
function request(query) {
  const handler = createReviewedAtlasHandler(root);
  try { return handler(new URLSearchParams(query)); } finally { handler.close(); }
}

test('discover reports the independently versioned accepted lens', () => {
  const response = request('mode=discover');
  assert.equal(response.status, 200);
  assert.equal(response.body.review_lens, 'current_accepted_at_build');
  assert.equal(response.body.counts.claims, 4);
  assert.deepEqual(response.body.predicates.map(row => row.id),
    ['announced_partnership_with', 'invested_in', 'named_competitor_of', 'shared_exposure_hypothesis']);
  assert.equal(response.body.predicates.at(-1).count, 0);
  assert.equal(response.body.predicates.at(-1).total_count, 1);
});

test('candidate focus uses reviewed identity and hypotheses require opt in', () => {
  const documented = request('mode=focus&candidate=4d9ade2bfb2aa6cb4afb');
  assert.equal(documented.status, 200);
  assert.equal(documented.body.focus.entity_slug, 'datadog');
  assert.deepEqual(documented.body.edges.map(edge => edge.neighbor_id), ['elastic']);
  const all = request('mode=focus&candidate=4d9ade2bfb2aa6cb4afb&basis=all');
  assert.deepEqual(all.body.edges.map(edge => edge.neighbor_id), ['elastic', 'snowflake']);
});

test('publication cutoff requires every premise by that date', () => {
  const before = request('mode=focus&entity=datadog&basis=hypothesis&cutoff=2025-02-19');
  assert.equal(before.body.count.value, 0);
  const onDate = request('mode=focus&entity=datadog&basis=hypothesis&cutoff=2025-02-20');
  assert.equal(onDate.body.count.value, 1);
});

test('explain retains multiple typed claims, direction, reviews, and external identity', () => {
  const response = request('mode=explain&entity=snowflake&neighbor=dbt-labs&cutoff=2022-02-24');
  assert.equal(response.status, 200);
  assert.equal(response.body.neighbor.target_kind, 'reviewed_external_entity');
  assert.deepEqual(response.body.claims.map(claim => claim.predicate),
    ['announced_partnership_with', 'invested_in']);
  assert.deepEqual(response.body.claims.map(claim => claim.direction), ['symmetric', 'subject_to_object']);
  assert.ok(response.body.claims.every(claim => claim.sources[0].artifact_sha256 && claim.review_history.length === 1));
  assert.equal(response.body.frame_id,
    request('mode=focus&entity=snowflake&cutoff=2022-02-24').body.frame_id);
});

test('identity mismatch, unsupported clocks and unknown candidates fail explicitly', () => {
  assert.equal(request('mode=focus&entity=elastic&candidate=4d9ade2bfb2aa6cb4afb').status, 409);
  assert.equal(request('mode=focus&candidate=missing').body.error, 'unknown_identity');
  assert.equal(request('mode=discover&year=2024').body.error, 'unsupported_clock');
  assert.equal(request('mode=discover&clock=relationship_validity').body.error, 'unsupported_clock');
});

test('direction filtering never includes an unrelated symmetric claim', () => {
  const response = request('mode=focus&entity=elastic&direction=out&basis=all');
  assert.equal(response.status, 200);
  assert.equal(response.body.count.value, 0);
  assert.deepEqual(response.body.edges, []);
});

test('malformed build paths and unexpected failures do not leak filesystem details', () => {
  const traversal = request('mode=discover&build_id=../../etc/passwd');
  assert.equal(traversal.status, 410);
  assert.equal(traversal.body.error, 'build_unavailable');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-reviewed-broken-'));
  fs.writeFileSync(path.join(temporary, 'current.json'), '{');
  const handler = createReviewedAtlasHandler(temporary);
  try {
    const broken = handler(new URLSearchParams('mode=discover'));
    assert.equal(broken.status, 500);
    assert.deepEqual(broken.body, { error: 'reviewed_provider_error', message: 'reviewed provider failed' });
  } finally { handler.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('claim and neighbor must identify the same reviewed pair', () => {
  const response = request('mode=explain&entity=datadog&neighbor=snowflake'
    + '&claim=datadog-named-competitor-elastic-log-management-2024&basis=all');
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'claim_neighbor_mismatch');
});

test('cursor is bound to build, selection and page size', () => {
  const first = request('mode=search&query=&limit=1');
  assert.ok(first.body.next_cursor);
  const mismatch = request(`mode=search&query=&limit=2&cursor=${first.body.next_cursor}`);
  assert.equal(mismatch.status, 409);
  const next = request(`mode=search&query=&limit=1&cursor=${first.body.next_cursor}`);
  assert.equal(next.status, 200);
  assert.notEqual(next.body.entities[0].id, first.body.entities[0].id);
});

test('compare reports publication availability and never activity', () => {
  const response = request('mode=compare&entity=datadog&basis=all&compare_cutoff=2024-12-31&cutoff=2025-02-20');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.additions.map(row => row.id), [
    'datadog-named-competitor-elastic-log-management-2024',
    'datadog-snowflake-shared-customer-workload-exposure-hypothesis-2024']);
  assert.match(response.body.caveat, /not relationship activity/);
  const other = request('mode=compare&entity=datadog&basis=all&compare_cutoff=2025-02-20&cutoff=2025-02-20');
  assert.notEqual(other.body.frame_id, response.body.frame_id);
});

test('dense claim work fails before detail materialization', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-reviewed-dense-'));
  fs.cpSync(root, temporary, { recursive: true });
  const manifestPath = path.join(temporary, 'current.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const databasePath = path.join(temporary, manifest.database);
  const database = new DatabaseSync(databasePath);
  database.exec(`WITH RECURSIVE sequence(value) AS (
      SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<=200000
    ) INSERT INTO claim(id,subject_id,object_id,predicate,direction,status,latest_source_date,detail_json)
      SELECT printf('dense-%06d',value),'datadog','elastic','named_competitor_of',
        'subject_to_object','documented','2025-02-20','{}' FROM sequence`);
  database.close();
  const bytes = fs.readFileSync(databasePath);
  manifest.database_bytes = bytes.length;
  manifest.database_sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const handler = createReviewedAtlasHandler(temporary);
  try {
    const response = handler(new URLSearchParams('mode=focus&entity=datadog'));
    assert.equal(response.status, 422);
    assert.equal(response.body.error, 'query_budget_exceeded');
  } finally { handler.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
});
