const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../web/discovery-topology-model.js');
const oracle = require('./fixtures/discovery-topology-oracle.js');

const payload = JSON.parse(fs.readFileSync(path.join(__dirname,
  '../web/data/topology-discovery.json'), 'utf8'));
const prepared = oracle.prepare(payload);
const all = { query: '', source: 'all', year: 'all', tag: 'all',
  category: 'all', identity: 'all' };

const candidates = [
  { id: 'a3', candidate_tags: ['ai_automation'] },
  { id: 'a1', candidate_tags: ['ai_automation'] },
  { id: 'd1', candidate_tags: ['developer_tools'] },
  { id: 'unknown', candidate_tags: [] }
];

test('browser model keeps only deterministic display layout work', () => {
  assert.equal(model.prepare, undefined);
  assert.equal(model.matchingPairs, undefined);
  assert.equal(model.matchingNeighbors, undefined);
  assert.equal(model.isCurrentRequest(2, 'new', 2, 'new'), true);
  assert.equal(model.isCurrentRequest(1, 'old', 2, 'new'), false);
  assert.equal(model.isCurrentRequest(2, 'old', 2, 'new'), false);
  assert.equal(model.matchesBuild('build-2', 'build-2'), true);
  assert.equal(model.matchesBuild('build-2', 'build-1'), false);

  const first = model.positions(candidates);
  const reversed = model.positions([...candidates].reverse());
  assert.equal(first.nodes.size, candidates.length);
  assert.deepEqual([...first.nodes.entries()], [...reversed.nodes.entries()]);
  assert.deepEqual(first.nodes.get('a1'), reversed.nodes.get('a1'));
  assert.equal(first.nodes.get('unknown').tag, 'ai_automation');
  assert.equal(first.groups.get('ai_automation').length, 3);
  for (const position of first.nodes.values()) {
    assert(Number.isFinite(position.x));
    assert(Number.isFinite(position.y));
  }
});

test('frozen client oracle retains the pinned complete overlap frame', () => {
  assert.equal(prepared.nodes.size, 1240);
  assert.equal(prepared.pairs.size, 47288);
  assert.equal(oracle.matchingCandidates(prepared, all).length, 1240);
  assert.equal(oracle.matchingPairs(prepared, [...prepared.nodes.keys()], all).length, 47288);
});

test('source, year, and category filters intersect on exact shared placements', () => {
  const filtered = { ...all, source: 'lfai', year: '2021' };
  const candidates = oracle.matchingCandidates(prepared, filtered);
  const pairs = oracle.matchingPairs(prepared, candidates.map(item => item.id), filtered);
  assert(candidates.length > 0 && candidates.length < 1240);
  assert(pairs.length > 0 && pairs.length < 47288);
  for (const pair of pairs) for (const key of pair.keys) {
    const observation = prepared.observationsByNode.get(pair.left).get(key)[0];
    assert.equal(observation.source, 'lfai');
    assert.equal(observation.year, 2021);
  }
  const category = pairs[0].keys[0];
  const exactCategory = prepared.observationsByNode.get(pairs[0].left).get(category)[0]
    .source_category;
  const categoryOnly = oracle.matchingCandidates(prepared,
    { ...all, category: exactCategory });
  const noMatch = oracle.matchingCandidates(prepared,
    { ...all, source: 'lfai', year: '1900', category: exactCategory });
  assert(categoryOnly.length > 0);
  assert.equal(noMatch.length, 0);
});

test('identity filters preserve reviewed status separately from navigation matches', () => {
  const reviewed = oracle.matchingCandidates(prepared, { ...all, identity: 'reviewed' });
  const unreviewed = oracle.matchingCandidates(prepared, { ...all, identity: 'unreviewed' });
  assert.equal(reviewed.length + unreviewed.length, 1240);
  assert(reviewed.every(candidate => candidate.identity_review));
  assert(unreviewed.every(candidate => !candidate.identity_review));
});

test('duplicate observations remain one exact candidate pair and one shared key', () => {
  const duplicatePayload = { counts: { possible_pairs: 1 }, nodes: [
    { id: 'left', name: 'Left', description: '', candidate_tags: ['ai_automation'],
      identity_review: null, observations: [
        { source: 'lfai', year: 2021, source_category: 'member', rows: [{ id: 'l1' }] },
        { source: 'lfai', year: 2021, source_category: 'member', rows: [{ id: 'l2' }] }
      ] },
    { id: 'right', name: 'Right', description: '', candidate_tags: ['developer_tools'],
      identity_review: null, observations: [
        { source: 'lfai', year: 2021, source_category: 'member', rows: [{ id: 'r1' }] }
      ] }
  ] };
  const duplicatePrepared = oracle.prepare(duplicatePayload);
  const pairs = oracle.matchingPairs(duplicatePrepared, ['left', 'right'], all);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].keys.length, 1);
  assert.equal(oracle.matchingNeighbors(duplicatePrepared, 'left', ['left', 'right'], all).length, 1);
});
