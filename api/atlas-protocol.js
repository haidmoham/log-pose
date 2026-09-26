'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

class AtlasError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fileDigest(filename) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = fs.openSync(filename, 'r');
  try {
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, length));
    }
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}

function parameterValue(params, name, fallback, maximumLength) {
  const values = params.getAll(name);
  if (values.length > 1) throw new AtlasError(400, 'invalid_request', `repeat parameter: ${name}`);
  const value = values.length ? values[0] : fallback;
  if (value.length > maximumLength) {
    throw new AtlasError(400, 'invalid_request', `${name} exceeds its length budget`);
  }
  return value;
}

function positiveInteger(value, name, maximum) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
    throw new AtlasError(400, 'invalid_request', `invalid ${name}`);
  }
  return Number(value);
}

function encodeCursor(binding, position) {
  return Buffer.from(JSON.stringify({ binding, position })).toString('base64url');
}

function decodeCursor(value, binding, validatePosition, message) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed.binding !== binding || !validatePosition(parsed.position)) throw new Error('invalid cursor');
    return parsed.position;
  } catch {
    throw new AtlasError(409, 'cursor_mismatch', message);
  }
}

function stablePosition(version, id) {
  const hash = crypto.createHash('sha256').update(`${version}:${id}`).digest();
  return { x: hash.readUInt32BE(0) / 0xffffffff, y: hash.readUInt32BE(4) / 0xffffffff };
}

module.exports = { AtlasError, digest, fileDigest, parameterValue, positiveInteger,
  encodeCursor, decodeCursor, stablePosition };
