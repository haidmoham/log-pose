'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
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
    ['announced_partnership_with', 'invested_in', 'named_competitor_of']);
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
});
