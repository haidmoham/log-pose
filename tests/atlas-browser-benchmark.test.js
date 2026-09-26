'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('browser benchmark freezes loopback, work and percentile contracts', async () => {
  const benchmark = await import('../scripts/benchmark_atlas_browser.mjs');
  assert.equal(benchmark.loopbackOrigin('http://127.0.0.1:8139/').port, '8139');
  assert.throws(() => benchmark.loopbackOrigin('https://example.com/'), /local HTTP/);
  assert.throws(() => benchmark.loopbackOrigin('http://example.com/'), /loopback/);
  assert.throws(() => benchmark.loopbackOrigin('http://127.0.0.1/path'), /origin/);
  assert.equal(benchmark.nearestRank([9, 1, 5, 3, 7], .5), 5);
  assert.equal(benchmark.nearestRank([9, 1, 5, 3, 7], .95), 9);
  assert.equal(benchmark.LIMITS.soakApi, 180);
  assert.equal(benchmark.LIMITS.apiPerWorkload, 200);
  assert.equal(benchmark.BUDGETS.constrained.graphReadyP95Ms, 5000);
  const baseline = { heapUsedBytes: 10_000_000, nodes: 100, jsEventListeners: 20 };
  const stable = benchmark.evaluateStability([baseline,
    { heapUsedBytes: 11_000_000, nodes: 110, jsEventListeners: 22 }]);
  assert.equal(stable.endpointWithinBudget, true);
  assert.deepEqual(stable.monotonicallyIncreasing, []);
  const growing = benchmark.evaluateStability([baseline,
    { heapUsedBytes: 11_000_000, nodes: 110, jsEventListeners: 22 },
    { heapUsedBytes: 12_000_000, nodes: 120, jsEventListeners: 24 }]);
  assert.deepEqual(growing.monotonicallyIncreasing, ['heapUsedBytes', 'nodes', 'jsEventListeners']);
  assert.equal(benchmark.evaluateStability([baseline,
    { heapUsedBytes: 40_000_000, nodes: 100, jsEventListeners: 20 }]).endpointWithinBudget, false);
});
