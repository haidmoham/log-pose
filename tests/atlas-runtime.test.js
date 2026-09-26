'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { poolOptions, readAtlas } = require('../api/atlas-runtime.js');

test('external database connections verify TLS even when the URL requests weaker settings', () => {
  const options = poolOptions({ ATLAS_DATABASE_URL: 'postgres://reader:example@database.example/atlas?sslmode=disable' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert(!options.connectionString.includes('sslmode'));
  assert.equal(options.max, 4);
  assert.throws(() => poolOptions({ ATLAS_DATABASE_URL: 'postgres://database.example/atlas', ATLAS_DATABASE_TLS: 'private' }));
  assert.equal(poolOptions({ ATLAS_DATABASE_URL: 'postgres://postgres.railway.internal/atlas', ATLAS_DATABASE_TLS: 'private' }).ssl, false);
});

test('hosted read failures are bounded and never silently fall back to another build', async () => {
  const previous = process.env.ATLAS_READ_SERVICE_URL;
  process.env.ATLAS_READ_SERVICE_URL = 'http://invalid.example';
  try {
    const response = await readAtlas(new URLSearchParams('mode=discover'));
    assert.equal(response.status, 503);
    assert.equal(response.body.error, 'atlas_unavailable');
  } finally {
    if (previous === undefined) delete process.env.ATLAS_READ_SERVICE_URL;
    else process.env.ATLAS_READ_SERVICE_URL = previous;
  }
});
