'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { readAtlas } = require('../api/atlas-runtime.js');

const webRoot = path.resolve(__dirname, '../web');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.txt': 'text/plain', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT || 8080);

http.createServer(async (request, reply) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/market-field' || url.pathname === '/api/atlas') {
    let result;
    try {
      const handler = url.pathname === '/api/atlas' ? readAtlas
        : require('../api/market-field.js').handleMarketField;
      result = request.method === 'GET' ? await handler(url.searchParams)
        : { status: 405, body: { error: 'method_not_allowed' } };
    } catch {
      result = { status: 503, body: { error: 'market_field_unavailable' } };
    }
    reply.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store' });
    reply.end(JSON.stringify(result.body));
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reply.writeHead(405);
    reply.end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { reply.writeHead(400); reply.end(); return; }
  const relative = pathname === '/'
    ? (url.searchParams.has('view') ? 'index.html' : 'atlas.html')
    : pathname.replace(/^\/+/, '');
  const asset = path.resolve(webRoot, relative);
  const extension = path.extname(asset);
  if (!asset.startsWith(webRoot + path.sep) || !mime[extension] || !fs.existsSync(asset) ||
      !fs.statSync(asset).isFile()) {
    reply.writeHead(404);
    reply.end();
    return;
  }
  reply.writeHead(200, { 'Content-Type': mime[extension] + (extension === '.woff2' ? '' : '; charset=utf-8') });
  if (request.method === 'HEAD') reply.end();
  else fs.createReadStream(asset).pipe(reply);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`saved export preview: http://127.0.0.1:${port}/\n`);
});
