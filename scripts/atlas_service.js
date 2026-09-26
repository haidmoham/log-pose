'use strict';

const http = require('node:http');
const { readAtlas } = require('../api/atlas-runtime.js');

if (!process.env.ATLAS_DATABASE_URL || process.env.ATLAS_READ_SERVICE_URL) {
  throw new Error('the atlas read service requires its own Postgres connection');
}

const server = http.createServer(async (request, reply) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method !== 'GET' || !['/api/atlas', '/healthz'].includes(url.pathname)) {
    reply.writeHead(request.method === 'GET' ? 404 : 405); reply.end(); return;
  }
  const result = await readAtlas(url.pathname === '/healthz' ? new URLSearchParams('mode=discover') : url.searchParams);
  reply.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  reply.end(JSON.stringify(url.pathname === '/healthz' && result.status === 200
    ? { status: 'ready', build_id: result.body.build_id } : result.body));
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.listen(Number(process.env.PORT || 8092), '0.0.0.0');
process.on('SIGTERM', () => { server.close(async () => { await readAtlas.close(); process.exitCode = 0; }); });
