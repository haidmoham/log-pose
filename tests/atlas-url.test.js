'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { handleAtlas } = require('../api/atlas.js');
const context = { URLSearchParams, TextEncoder };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/atlas-model.js'), 'utf8'), context);
const { routeParams } = context.LogPoseAtlasModel;
const discovery = handleAtlas(new URLSearchParams('mode=discover&limit=100')).body;
const artifact = discovery.artifacts.find(item => item.source === 'cncf' && item.inventory_year === 2024);
const fields = { mode: 'focus', build_id: discovery.build_id, source: 'cncf', year: '2024',
  temporal_mode: 'snapshot', artifact: artifact.artifact_id, candidate: 'db7244f000eedc7a99c9', top_k: '24', limit: '24' };

test('compact atlas route keeps the exact build and selection while omitting redundant defaults', () => {
  const params = routeParams(fields, discovery.artifacts);
  assert.equal(params.get('build_id'), fields.build_id);
  assert.equal(params.get('candidate'), fields.candidate);
  assert.equal(params.get('year'), '2024');
  for (const key of ['mode', 'source', 'temporal_mode', 'artifact', 'top_k', 'limit']) assert.equal(params.has(key), false);
  assert(params.toString().length < 125);
  assert(new URLSearchParams(fields).toString().length > params.toString().length * 2);
});

test('ambiguous, mismatched or unpinned revisions retain their artifact identity', () => {
  const duplicate = [...discovery.artifacts, { ...artifact, artifact_id: 'other-revision' }];
  assert.equal(routeParams(fields, duplicate).get('artifact'), artifact.artifact_id);
  assert.equal(routeParams({ ...fields, artifact: 'not-in-this-build' }, discovery.artifacts).get('artifact'), 'not-in-this-build');
  assert.equal(routeParams({ ...fields, build_id: '' }, discovery.artifacts).get('artifact'), artifact.artifact_id);
});

test('nondefault scope, exact edge, page cursors and reviewed filters survive canonicalization', () => {
  const selected = { ...fields, source: 'lfai', temporal_mode: 'accumulated', artifact: '', top_k: '9',
    neighbor: 'edge-id', evidence_cursor: 'exact-page', cursor: 'search-page', query: 'CI & build', placement: 'category-id',
    reviewed_build_id: 'b'.repeat(64), reviewed_cutoff: '2024-02-01', reviewed_basis: 'hypothesis', reviewed_direction: 'incoming',
    reviewed_predicate: 'partner', reviewed_neighbor: 'mapped-neighbor', reviewed_claim: 'claim-id' };
  const params = routeParams(selected, discovery.artifacts);
  for (const [key, value] of Object.entries(selected)) {
    if (['mode', 'limit', 'artifact'].includes(key)) continue;
    assert.equal(params.get(key), value, key);
  }
  assert.equal(params.has('artifact'), false);
});

test('compare URLs retain their two years and only omit an unambiguous comparison revision', () => {
  const previous = discovery.artifacts.find(item => item.source === 'cncf' && item.inventory_year === 2023);
  const compared = { ...fields, mode: 'compare', compare_year: '2023', compare_artifact: previous.artifact_id };
  const params = routeParams(compared, discovery.artifacts);
  assert.equal(params.get('mode'), 'compare');
  assert.equal(params.get('compare_year'), '2023');
  assert.equal(params.has('compare_artifact'), false);
  const ambiguous = [...discovery.artifacts, { ...previous, artifact_id: 'second-2023-revision' }];
  assert.equal(routeParams(compared, ambiguous).get('compare_artifact'), previous.artifact_id);
});
