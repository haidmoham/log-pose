'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const protocol = require('../api/atlas-protocol.js');
const inventory = require('../api/atlas.js');
const { createReviewedAtlasHandler } = require('../api/atlas-reviewed.js');

function reviewedRequest(query) {
  const root = path.join(__dirname, '../api/data/atlas-reviewed');
  const handler = createReviewedAtlasHandler(root);
  try { return handler(new URLSearchParams(query)); } finally { handler.close(); }
}

test('shared hashes and positions preserve their stable wire values', t => {
  const value = { source: 'atlas', values: [3, 1, 2] };
  assert.equal(protocol.digest(value),
    'aa50b9c6665058f85befe32f7f0d277cb81097183fe57a23db3808e799b8176c');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-protocol-'));
  const filename = path.join(directory, 'input.json');
  fs.writeFileSync(filename, JSON.stringify(value).repeat(4096));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(protocol.fileDigest(filename),
    crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'));

  assert.deepEqual(protocol.stablePosition('layout-v1', 'entity-1'), {
    x: 0.3658281956719766,
    y: 0.9228684322263273,
  });
  assert.notDeepEqual(protocol.stablePosition('layout-v2', 'entity-1'),
    protocol.stablePosition('layout-v1', 'entity-1'));
});

test('shared parameter and integer validation retain exact error contracts', () => {
  assert.equal(protocol.parameterValue(new URLSearchParams('q=abcd'), 'q', '', 4), 'abcd');
  assert.throws(() => protocol.parameterValue(new URLSearchParams('q=a&q=b'), 'q', '', 4),
    error => error instanceof protocol.AtlasError && error.status === 400
      && error.code === 'invalid_request' && error.message === 'repeat parameter: q');
  assert.throws(() => protocol.parameterValue(new URLSearchParams('q=abcde'), 'q', '', 4),
    error => error.status === 400 && error.code === 'invalid_request'
      && error.message === 'q exceeds its length budget');
  assert.equal(protocol.positiveInteger('100', 'limit', 100), 100);
  for (const value of ['0', '-1', '01', '101', 'x']) {
    assert.throws(() => protocol.positiveInteger(value, 'limit', 100),
      error => error.status === 400 && error.code === 'invalid_request'
        && error.message === 'invalid limit');
  }
});

test('shared cursors reject malformed, mismatched, and out-of-range positions', () => {
  const cursor = protocol.encodeCursor('bound-frame', 100);
  assert.equal(protocol.decodeCursor(cursor, 'bound-frame', value => value <= 100,
    'cursor belongs elsewhere'), 100);
  for (const [value, binding] of [['garbage', 'bound-frame'], [cursor, 'other-frame']]) {
    assert.throws(() => protocol.decodeCursor(value, binding, position => position <= 100,
      'cursor belongs elsewhere'), error => error.status === 409 && error.code === 'cursor_mismatch'
        && error.message === 'cursor belongs elsewhere');
  }
  assert.throws(() => protocol.decodeCursor(protocol.encodeCursor('bound-frame', 101),
    'bound-frame', position => position <= 100, 'cursor belongs elsewhere'),
  error => error.status === 409 && error.code === 'cursor_mismatch');
});

test('inventory wrappers preserve cursor and evidence cursor budgets', () => {
  const { parameter } = inventory.protocol;
  assert.equal(parameter(new URLSearchParams(`cursor=${'x'.repeat(2048)}`), 'cursor').length, 2048);
  assert.throws(() => parameter(new URLSearchParams(`cursor=${'x'.repeat(2049)}`), 'cursor'),
    error => error.status === 400 && error.message === 'cursor exceeds its length budget');
  assert.equal(parameter(new URLSearchParams(`evidence_cursor=${'x'.repeat(240)}`),
    'evidence_cursor').length, 240);
  assert.throws(() => parameter(new URLSearchParams(`evidence_cursor=${'x'.repeat(241)}`),
    'evidence_cursor'), error => error.status === 400
      && error.message === 'evidence_cursor exceeds its length budget');
});

test('providers preserve repeated parameter and reviewed cursor errors', () => {
  const inventoryResponse = inventory.handleAtlas(new URLSearchParams('mode=discover&mode=search'));
  assert.deepEqual(inventoryResponse, { status: 400, body: {
    error: 'invalid_request', message: 'repeat parameter: mode',
  } });
  const reviewedResponse = reviewedRequest('mode=discover&mode=search');
  assert.deepEqual(reviewedResponse, { status: 400, body: {
    error: 'invalid_request', message: 'repeat parameter: mode',
  } });
  const atLimit = reviewedRequest(`mode=search&query=data&cursor=${'x'.repeat(2048)}`);
  assert.equal(atLimit.status, 409);
  assert.deepEqual(atLimit.body, {
    error: 'cursor_mismatch', message: 'cursor belongs to another build, selection or page',
  });
  const overLimit = reviewedRequest(`mode=search&query=data&cursor=${'x'.repeat(2049)}`);
  assert.equal(overLimit.status, 400);
  assert.deepEqual(overLimit.body, {
    error: 'invalid_request', message: 'cursor exceeds its length budget',
  });
});

test('current and pinned selections have identical stable frames', () => {
  const inventoryCurrent = inventory.handleAtlas(new URLSearchParams('mode=discover'));
  assert.equal(inventoryCurrent.status, 200);
  const inventoryPinned = inventory.handleAtlas(new URLSearchParams(
    `mode=discover&build_id=${inventoryCurrent.body.build_id}`));
  assert.equal(inventoryPinned.status, 200);
  assert.equal(inventoryPinned.body.build_id, inventoryCurrent.body.build_id);
  assert.equal(inventoryPinned.body.frame_id, inventoryCurrent.body.frame_id);
  assert.deepEqual(inventoryPinned.body.versions, inventoryCurrent.body.versions);

  const current = reviewedRequest('mode=discover');
  assert.equal(current.status, 200);
  const pinned = reviewedRequest(`mode=discover&build_id=${current.body.build_id}`);
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.build_id, current.body.build_id);
  assert.equal(pinned.body.frame_id, current.body.frame_id);
  assert.deepEqual(pinned.body.versions, current.body.versions);
});
