'use strict';
// Local endpoint measurements: uncompressed response-body bytes and HTTP wall time.
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const [origin = 'http://127.0.0.1:8155', output] = process.argv.slice(2);
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('use a local verification server');
async function read(fields) {
  const start = performance.now();
  const response = await fetch(`${origin}/api/market-field?${new URLSearchParams(fields)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const elapsedMs = performance.now() - start;
  if (!response.ok) throw new Error(`frame request failed: ${response.status}`);
  return { fields, responseBodyBytes: bytes.length, elapsedMs, body: JSON.parse(bytes) };
}
(async () => {
  const timeline = await read({ mode: 'timeline' });
  const observations = [];
  for (const stop of timeline.body.frames) {
    for (const temporalMode of ['snapshot', 'accumulated']) {
      const result = await read({ mode: 'frame', build_id: timeline.body.build_id,
        source: stop.source, year: String(stop.year), temporal_mode: temporalMode });
      observations.push({ source: stop.source, year: stop.year, mode: temporalMode,
        frameId: result.body.frame_id, responseBodyBytes: result.responseBodyBytes,
        elapsedMs: result.elapsedMs, nodes: result.body.nodes.length,
        drawnConnections: result.body.context_edges.length,
        totalConnections: result.body.total_context_edges });
    }
  }
  const fields = { mode: 'frame', build_id: timeline.body.build_id, source: 'lfai',
    year: '2024', candidate: '00a2fb1597f507022279', temporal_mode: 'snapshot' };
  const trials = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await read(fields);
    trials.push({ elapsedMs: result.elapsedMs, responseBodyBytes: result.responseBodyBytes, frameId: result.body.frame_id });
  }
  const report = { measuredAt: new Date().toISOString(), origin,
    boundary: 'local Node endpoint; no compression; response body bytes exclude HTTP headers; wall time includes query and local transfer; not production latency or browser frame rate',
    buildId: timeline.body.build_id, timelineBytes: timeline.responseBodyBytes, observations, neighborhoodTrials: trials };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ buildId: report.buildId, frames: observations.length,
    maximumFrameBytes: Math.max(...observations.map(item => item.responseBodyBytes)),
    neighborhoodTrials: trials }, null, 2));
})();
