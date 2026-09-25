const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const graph = require('../api/data/market-field-graph.json');
const projection = require('../web/data/topology-discovery.json');
const { verifyGraphDetail } = require('../api/market-field.js');

test('handler accepts the exact graph/detail projection shipped together', () => {
  assert.doesNotThrow(() => verifyGraphDetail(graph, projection));
});

test('handler rejects changed source rows or artifacts despite a stale projection build id', () => {
  const alteredRow = structuredClone(projection);
  alteredRow.nodes[0].observations[0].rows[0].name += ' changed';
  assert.equal(alteredRow.build_id, projection.build_id);
  assert.throws(() => verifyGraphDetail(graph, alteredRow), /graph and detail projection differ/);

  const alteredArtifact = structuredClone(projection);
  alteredArtifact.artifacts[0].url += '#different';
  assert.equal(alteredArtifact.build_id, projection.build_id);
  assert.throws(() => verifyGraphDetail(graph, alteredArtifact), /graph and detail projection differ/);
});

test('a mismatched graph and detail bundle returns the stable unavailable response', () => {
  const projectionPath = require.resolve('../web/data/topology-discovery.json');
  const handlerPath = require.resolve('../api/market-field.js');
  const script = `
    const projectionPath = ${JSON.stringify(projectionPath)};
    const handlerPath = ${JSON.stringify(handlerPath)};
    require(projectionPath).nodes[0].observations[0].rows[0].name += ' changed';
    const result = require(handlerPath).handleMarketField(new URLSearchParams('mode=summary'));
    process.stdout.write(JSON.stringify(result));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
  assert.deepEqual(result, { status: 503, body: { error: 'market_field_unavailable' } });
});
