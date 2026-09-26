'use strict';

let postgresHandler;

function poolOptions(environment = process.env) {
  const url = new URL(environment.ATLAS_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('unsupported database protocol');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const privateNetwork = url.hostname.endsWith('.railway.internal');
  const tlsMode = environment.ATLAS_DATABASE_TLS || (local ? 'local' : 'verify');
  if (!['local', 'private', 'verify'].includes(tlsMode)
      || (tlsMode === 'local' && !local) || (tlsMode === 'private' && !privateNetwork)) {
    throw new Error('database TLS mode does not match the endpoint');
  }
  // Connection-string SSL options must not override certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const ssl = tlsMode === 'verify' ? { rejectUnauthorized: true } : false;
  if (ssl && environment.ATLAS_DATABASE_CA) ssl.ca = environment.ATLAS_DATABASE_CA;
  return { connectionString: url.toString(), ssl, max: 4,
    connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000,
    allowExitOnIdle: true, application_name: 'log-pose-atlas-read' };
}

async function readAtlas(parameters) {
  if (process.env.ATLAS_READ_SERVICE_URL) return remoteRead(parameters);
  if (!process.env.ATLAS_DATABASE_URL) return require('./atlas.js').handleAtlas(parameters);
  try {
    if (!postgresHandler) {
      const { Pool } = require('pg');
      const { createPostgresHandler } = require('./atlas-postgres.js');
      const pool = new Pool(poolOptions());
      pool.on('error', () => { console.error('atlas database idle connection ended'); });
      postgresHandler = createPostgresHandler(pool);
    }
    return await postgresHandler(parameters);
  } catch {
    return { status: 503, body: { error: 'atlas_unavailable', message: 'the indexed snapshot could not be read' } };
  }
}

async function remoteRead(parameters) {
  try {
    const endpoint = new URL('/api/atlas', process.env.ATLAS_READ_SERVICE_URL);
    if (endpoint.protocol !== 'https:') throw new Error('remote atlas requires HTTPS');
    endpoint.search = parameters.toString();
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000), redirect: 'error',
      headers: { accept: 'application/json' } });
    const chunks = [];
    let length = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 1024 * 1024) throw new Error('remote atlas response exceeds byte budget');
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel(); }
    return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { status: 503, body: { error: 'atlas_unavailable', message: 'the hosted snapshot could not be read' } };
  }
}

readAtlas.close = async () => {
  if (postgresHandler) { await postgresHandler.close(); postgresHandler = null; }
  require('./atlas.js').handleAtlas.close();
};

module.exports = { readAtlas, poolOptions };
