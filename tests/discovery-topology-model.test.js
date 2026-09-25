const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../web/discovery-topology-model.js');

const payload = JSON.parse(fs.readFileSync(path.join(__dirname,
  '../web/data/topology-discovery.json'), 'utf8'));
const prepared = model.prepare(payload);
const all = { query: '', source: 'all', year: 'all', tag: 'all',
  category: 'all', identity: 'all' };

test('the exported source field exposes its entire exact overlap frame', () => {
  assert.equal(prepared.nodes.size, 1240);
  assert.equal(prepared.pairs.size, 47288);
  assert.equal(model.matchingCandidates(prepared, all).length, 1240);
  assert.equal(model.matchingPairs(prepared, [...prepared.nodes.keys()], all).length, 47288);
});

test('a same-category pair is only retained when both observations match the filters', () => {
  const filtered = { ...all, source: 'lfai', year: '2021' };
  const candidates = model.matchingCandidates(prepared, filtered);
  const pairs = model.matchingPairs(prepared, candidates.map(item => item.id), filtered);
  assert(candidates.length > 0 && candidates.length < 1240);
  assert(pairs.length > 0 && pairs.length < 47288);
  for (const pair of pairs) for (const key of pair.keys) {
    const observation = prepared.observationsByNode.get(pair.left).get(key)[0];
    assert.equal(observation.source, 'lfai');
    assert.equal(observation.year, 2021);
  }
});

test('identity filtering does not turn navigation matches into reviewed identities', () => {
  const reviewed = model.matchingCandidates(prepared, { ...all, identity: 'reviewed' });
  const unreviewed = model.matchingCandidates(prepared, { ...all, identity: 'unreviewed' });
  assert.equal(reviewed.length + unreviewed.length, 1240);
  assert(reviewed.every(candidate => candidate.identity_review));
  assert(unreviewed.every(candidate => !candidate.identity_review));
});
