'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { group } = require('../scripts/benchmark_atlas_postgres.js');

test('scale batches measure the declared client concurrency for one workload', async () => {
  let active = 0;
  let peak = 0;
  let requests = 0;
  async function handle(parameters) {
    assert.equal(parameters.get('mode'), 'focus');
    active += 1;
    peak = Math.max(peak, active);
    requests += 1;
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    return { status: 200, body: { edges: [], count: { status: 'exact', value: 0 } } };
  }

  const result = await group(handle, 'focus', { mode: 'focus' }, 5, 4);
  assert.equal(peak, 5);
  assert.equal(active, 0);
  assert.equal(requests, 20);
  assert.equal(result.samples.length, 20);
  assert(result.samples.every(sample => sample.workload === 'focus'));
});
