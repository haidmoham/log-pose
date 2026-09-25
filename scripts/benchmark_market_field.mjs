// Run against an isolated Chrome for Testing instance with remote debugging enabled.
// CDP throttling models a constrained device; it is not a physical phone measurement.
import fs from 'node:fs/promises';

const [debugOrigin, siteOrigin, outputPath] = process.argv.slice(2);
if (!debugOrigin || !siteOrigin || !outputPath) {
  throw new Error('usage: node scripts/benchmark_market_field.mjs http://127.0.0.1:9222 http://127.0.0.1:8134 output.json');
}
for (const value of [debugOrigin, siteOrigin]) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) {
    throw new Error('benchmark accepts loopback endpoints only');
  }
}
const target = await (await fetch(`${debugOrigin}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timer);
  if (response.error) request.reject(new Error(JSON.stringify(response.error)));
  else request.resolve(response.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out: ${method}`));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`page did not settle: ${expression}`);
}

// Hook the old pure model before scripts load. New clients must make zero prepare calls.
const instrumentation = `
  window.__fieldBench = { calls: {}, milliseconds: {}, longTasks: [], errors: [] };
  addEventListener('error', event => __fieldBench.errors.push(event.message));
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) __fieldBench.longTasks.push(entry.duration);
  }).observe({type: 'longtask', buffered: true});
  let fieldModel;
  Object.defineProperty(window, 'LogPoseDiscoveryTopologyModel', {
    configurable: true, get: () => fieldModel,
    set(value) {
      fieldModel = value;
      for (const name of ['prepare', 'matchingCandidates', 'matchingPairs', 'matchingNeighbors', 'positions']) {
        if (typeof value[name] !== 'function') continue;
        const original = value[name];
        value[name] = function(...args) {
          const start = performance.now();
          try { return original.apply(this, args); }
          finally {
            __fieldBench.calls[name] = (__fieldBench.calls[name] || 0) + 1;
            __fieldBench.milliseconds[name] = (__fieldBench.milliseconds[name] || 0) + performance.now() - start;
          }
        };
      }
    }
  });
`;
await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
const profiles = [
  { name: 'desktop', width: 1440, height: 1000, cpu: 1, latency: 0, bytesPerSecond: -1 },
  { name: 'constrained-emulation', width: 390, height: 844, cpu: 4, latency: 80, bytesPerSecond: 1000000 }
];
const measurements = [];
try {
  for (const profile of profiles) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: profile.width, height: profile.height, deviceScaleFactor: 1, mobile: false
    });
    await send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: profile.latency,
      downloadThroughput: profile.bytesPerSecond, uploadThroughput: profile.bytesPerSecond
    });
    for (let trial = 1; trial <= 3; trial++) {
      await send('Page.navigate', { url: `${siteOrigin}/?view=topology` });
      await waitFor(`document.querySelectorAll('.field-dot').length === 1240 && document.querySelectorAll('.field-index-row').length > 0`);
      const initial = await evaluate(`({
        readyMs: performance.now(), metrics: structuredClone(__fieldBench),
        resources: performance.getEntriesByType('resource').map(entry => ({
          path: new URL(entry.name).pathname + new URL(entry.name).search,
          transferredBytes: entry.transferSize, decodedBytes: entry.decodedBodySize
        }))
      })`);
      const filterStart = await evaluate(`(() => {
        const start = performance.now();
        const select = document.querySelector('#field-year');
        select.value = '2023'; select.dispatchEvent(new Event('change', {bubbles: true}));
        return start;
      })()`);
      await waitFor(`document.querySelector('#field-year')?.value === '2023' && !document.querySelector('#view .loading') && document.querySelectorAll('.field-index-row').length > 0 && document.querySelectorAll('.field-dot.is-muted').length > 0`);
      const filterMs = await evaluate(`performance.now() - ${filterStart}`);
      const focusStart = await evaluate(`(() => {
        const start = performance.now(); document.querySelector('.field-index-row').click(); return start;
      })()`);
      await waitFor(`document.querySelectorAll('.field-observation').length > 0`);
      const focusMs = await evaluate(`performance.now() - ${focusStart}`);
      const finalMetrics = await evaluate('structuredClone(__fieldBench)');
      measurements.push({ profile, trial, initial, filterMs, focusMs, finalMetrics });
      console.log(`${profile.name} trial ${trial}: ready ${initial.readyMs.toFixed(0)} ms; filter ${filterMs.toFixed(0)} ms; focus ${focusMs.toFixed(0)} ms`);
    }
  }
  await fs.writeFile(outputPath, JSON.stringify({
    measuredAt: new Date().toISOString(), siteOrigin,
    environment: await evaluate('navigator.userAgent'),
    notes: 'cold browser cache; local HTTP; 100ms polling includes observation delay; constrained profile is emulation, not physical-device evidence',
    measurements
  }, null, 2) + '\n');
  if (process.argv.includes('--enforce')) {
    for (const measurement of measurements) {
      const fieldBytes = measurement.initial.resources
        .filter(resource => resource.path.startsWith('/api/market-field')
          || resource.path.startsWith('/data/topology-discovery.json'))
        .reduce((total, resource) => total + resource.decodedBytes, 0);
      if (fieldBytes === 0 || fieldBytes > 1000000) throw new Error(`field payload budget: ${fieldBytes}`);
      for (const name of ['prepare', 'matchingPairs', 'matchingNeighbors']) {
        if (measurement.finalMetrics.calls[name]) throw new Error(`client called forbidden graph operation ${name}`);
      }
      if (measurement.finalMetrics.errors.length) throw new Error('browser errors occurred');
      const latencyBudget = measurement.profile.cpu === 1 ? 1000 : 2000;
      if (measurement.filterMs > latencyBudget || measurement.focusMs > latencyBudget) {
        throw new Error(`${measurement.profile.name} filter/focus exceeds ${latencyBudget} ms budget`);
      }
    }
  }
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`);
}
