const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../../../web/experimental/mlops-2024/study-model.js');

test('experimental study URL state retains filters and rejects unsafe member values', () => {
  const parsed = model.parseUrlState('?member=lead.alpha&role=platform%20engineering&disposition=include&researchQuery=feature%20store');
  assert.deepEqual([parsed.researchMember, parsed.researchRole, parsed.researchDisposition, parsed.researchQuery],
    ['lead.alpha', 'platform engineering', 'include', 'feature store']);
  assert.equal(model.toUrlParams(parsed),
    'member=lead.alpha&role=platform+engineering&disposition=include&researchQuery=feature+store');
  const invalid = model.parseUrlState('?member=../../other&researchQuery=' + 'x'.repeat(220));
  assert.equal(invalid.researchMember, null);
  assert.equal(invalid.researchQuery.length, 200);
});
