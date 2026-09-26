import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({
  apiPerWorkload: 200, soakApi: 180, totalHttp: 2000, decodedBytes: 1024 * 1024,
  runtimeMs: 24 * 60 * 1000, browserRssBytes: 2 * 1024 ** 3, outputBytes: 100 * 1024 ** 2
});
export const BUDGETS = Object.freeze({
  desktop: { frameAcceptanceP95Ms: 1000, graphReadyP95Ms: 2000, cameraP95Ms: 33 },
  constrained: { frameAcceptanceP95Ms: 2000, graphReadyP95Ms: 5000, cameraP95Ms: 50 },
  heapGrowthBytes: 20 * 1024 ** 2, heapGrowthRatio: 1.15, domNodeGrowth: 50,
  listenerGrowth: 5
});

export function loopbackOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', 'benchmark requires local HTTP');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'benchmark requires loopback');
  assert.equal(url.pathname, '/', 'base URL must be an origin');
  return url;
}

export function nearestRank(values, fraction) {
  assert(values.length, 'percentile needs samples');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

export function summarize(values) {
  return { count: values.length, min: Math.min(...values), p50: nearestRank(values, .5),
    p95: nearestRank(values, .95), max: Math.max(...values) };
}

export function evaluateStability(samples) {
  assert(samples.length >= 2, 'stability needs comparable before and after samples');
  const baseline = samples[0]; const final = samples.at(-1);
  return { heapGrowthBytes: final.heapUsedBytes - baseline.heapUsedBytes,
    heapRatio: final.heapUsedBytes / baseline.heapUsedBytes, nodeGrowth: final.nodes - baseline.nodes,
    listenerGrowth: final.jsEventListeners - baseline.jsEventListeners,
    endpointWithinBudget: final.heapUsedBytes - baseline.heapUsedBytes <= BUDGETS.heapGrowthBytes
      && final.heapUsedBytes <= baseline.heapUsedBytes * BUDGETS.heapGrowthRatio
      && final.nodes <= baseline.nodes + BUDGETS.domNodeGrowth
      && final.jsEventListeners <= baseline.jsEventListeners + BUDGETS.listenerGrowth,
    monotonicallyIncreasing: samples.length < 3 ? [] : ['heapUsedBytes', 'nodes', 'jsEventListeners'].filter(key =>
      samples.every((sample, index) => index === 0 || sample[key] > samples[index - 1][key])) };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function descendantProcesses(rootPid) {
  const rows = execFileSync('ps', ['-e', '-o', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/, 4))
    .map(([pid, ppid, rss, command]) => ({ pid: Number(pid), ppid: Number(ppid), rss: Number(rss) * 1024, command }));
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) {
      selected.add(row.pid); changed = true;
    }
  }
  return rows.filter(row => selected.has(row.pid));
}

function descendantsRss(rootPid, predicate = () => true) {
  return descendantProcesses(rootPid).filter(predicate).reduce((total, row) => total + row.rss, 0);
}

async function waitForServer(origin, deadline) {
  while (Date.now() < deadline) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('local server did not start');
}

async function cdpProfile(page, profile) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency,
    downloadThroughput: profile.bytesPerSecond, uploadThroughput: profile.bytesPerSecond,
    connectionType: profile.cpu === 1 ? 'none' : 'cellular4g' });
  return cdp;
}

async function tracker(context, page, cdp, cap = LIMITS.totalHttp, apiCap = LIMITS.apiPerWorkload) {
  const state = { attempts: [], records: [], failures: [], pending: new Set(), encoded: new Map() };
  const requestUrls = new Map();
  cdp.on('Network.loadingFinished', event => {
    const url = requestUrls.get(event.requestId);
    if (url) state.encoded.set(`url:${url}`, event.encodedDataLength);
  });
  cdp.on('Network.responseReceived', event => {
    requestUrls.set(event.requestId, event.response.url);
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      state.failures.push({ url: url.href, error: 'non_loopback_request_blocked' });
      return route.abort('blockedbyclient');
    }
    state.attempts.push({ url: url.href, api: url.pathname === '/api/atlas' });
    const apiAttempts = state.attempts.filter(item => item.api).length;
    if (state.attempts.length > cap || apiAttempts > apiCap) {
      state.failures.push({ url: url.href, error: 'request_cap_exceeded' });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('requestfailed', request => state.failures.push({ url: request.url(), error: request.failure()?.errorText || 'request_failed' }));
  page.on('response', response => {
    const pending = (async () => {
      const url = new URL(response.url());
      const body = await response.body();
      const headers = await response.allHeaders();
      state.records.push({ url: url.href, path: url.pathname + url.search, status: response.status(),
        api: url.pathname === '/api/atlas', decodedBytes: body.length,
        transferBytes: state.encoded.get(`url:${url.href}`) || null,
        contentEncoding: headers['content-encoding'] || '' });
    })().catch(error => state.failures.push({ url: response.url(), error: `response_body: ${error.message}` }))
      .finally(() => state.pending.delete(pending));
    state.pending.add(pending);
  });
  state.settle = async () => { await Promise.all(state.pending); };
  return state;
}

async function ready(page, layer, expectedCount) {
  await page.waitForFunction(({ layer, expectedCount }) => {
    const scene = document.querySelector('#atlas-scene');
    const frame = document.querySelector('#atlas-frame-label')?.dataset.frameId;
    const inspector = document.querySelector('#atlas-inspector')?.dataset.frameId;
    const nodes = document.querySelectorAll('.constellation-node').length;
    return scene?.dataset.frameReadyMs && frame && frame === inspector && !document.querySelector('#atlas-status')?.textContent
      && nodes >= expectedCount && (layer !== 'inventory' || scene.dataset.graphReadyMs);
  }, { layer, expectedCount }, { timeout: 15000 });
}

async function cameraSamples(page, count = 20) {
  const map = page.locator('.constellation-map');
  const graph = page.locator('.temporal-constellation');
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  assert(box, 'graph map is not visible');
  const zoom = [];
  for (let index = 0; index < count; index += 1) {
    const before = await map.locator('.constellation-camera').getAttribute('transform');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, index % 2 ? 60 : -60);
    await page.waitForFunction(value => document.querySelector('.constellation-camera')?.getAttribute('transform') !== value,
      before, { timeout: 5000 });
    const value = await graph.getAttribute('data-camera-frame-ms');
    assert(value !== null, 'zoom frame timing unavailable'); zoom.push(Number(value));
  }
  const pan = [];
  await map.focus();
  for (let index = 0; index < count; index += 1) {
    const before = await map.locator('.constellation-camera').getAttribute('transform');
    await page.keyboard.press(index % 2 ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForFunction(value => document.querySelector('.constellation-camera')?.getAttribute('transform') !== value,
      before, { timeout: 5000 });
    const value = await graph.getAttribute('data-camera-frame-ms');
    assert(value !== null, 'pan frame timing unavailable'); pan.push(Number(value));
  }
  return { zoom, pan };
}

async function measureOne(browser, origin, profile, workload, trial) {
  const context = await browser.newContext({ viewport: profile.viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await cdpProfile(page, profile);
  await page.addInitScript(() => {
    window.__atlasGraphReadyMs = null;
    const inspect = () => {
      const frame = document.querySelector('#atlas-frame-label')?.dataset.frameId;
      if (frame && frame === document.querySelector('#atlas-inspector')?.dataset.frameId
          && document.querySelector('.constellation-map')) {
        requestAnimationFrame(() => { window.__atlasGraphReadyMs ??= performance.now(); });
        return;
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  const requests = await tracker(context, page, cdp);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const started = Date.now();
  const response = await page.goto(new URL(workload.path, origin).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
  assert.equal(response.status(), 200);
  await ready(page, workload.layer, workload.minimumNodes);
  await page.waitForFunction(() => window.__atlasGraphReadyMs !== null);
  const initial = await page.evaluate(() => ({
    graphReadyMs: window.__atlasGraphReadyMs,
    frameReadyMs: Number(document.querySelector('#atlas-scene').dataset.frameReadyMs),
    renderMs: Number(document.querySelector('#atlas-scene').dataset.renderMs),
    frameId: document.querySelector('#atlas-frame-label').dataset.frameId,
    inspectorFrameId: document.querySelector('#atlas-inspector').dataset.frameId,
    nodes: document.querySelectorAll('.constellation-node').length,
    domNodes: document.querySelectorAll('*').length,
    resources: performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname,
      transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize }))
  }));
  assert(initial.graphReadyMs !== null, 'graph-ready observer did not accept a frame');
  await requests.settle();
  const initialTransport = { attempts: requests.attempts.length,
    apiAttempts: requests.attempts.filter(item => item.api).length,
    totalDecodedBytes: requests.records.reduce((sum, item) => sum + item.decodedBytes, 0),
    totalTransferBytes: requests.records.reduce((sum, item) => sum + (item.transferBytes || 0), 0),
    apiResponses: requests.records.filter(item => item.api),
    resourceTiming: { transferBytes: initial.resources.reduce((sum, item) => sum + item.transferBytes, 0),
      encodedBytes: initial.resources.reduce((sum, item) => sum + item.encodedBytes, 0),
      decodedBytes: initial.resources.reduce((sum, item) => sum + item.decodedBytes, 0) } };
  const beforeFrame = initial.frameId;
  const updateStarted = await page.evaluate(({ next, layer }) => {
    const input = document.querySelector(layer === 'reviewed' ? '#atlas-cutoff' : '#atlas-top-k');
    input.value = layer === 'reviewed' ? '2025-02-20' : String(next);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return performance.now();
  }, { next: workload.updateTopK, layer: workload.layer });
  try { await page.waitForFunction(({ beforeFrame, expectedNodes, layer }) => {
    const label = document.querySelector('#atlas-frame-label');
    const inspector = document.querySelector('#atlas-inspector');
    return label?.dataset.frameId && label.dataset.frameId === inspector?.dataset.frameId
      && document.querySelectorAll('.constellation-node').length >= expectedNodes
      && Number(document.querySelector('#atlas-scene').dataset.frameReadyMs) >= 0
      && (label.dataset.frameId !== beforeFrame || (layer === 'inventory'
        && label.textContent.includes(`top ${expectedNodes - 1}`)));
  }, { beforeFrame, expectedNodes: workload.updateMinimumNodes, layer: workload.layer }, { timeout: 15000 }); }
  catch (error) {
    const state = await page.evaluate(() => ({ status: document.querySelector('#atlas-status')?.textContent,
      label: document.querySelector('#atlas-frame-label')?.textContent,
      frame: document.querySelector('#atlas-frame-label')?.dataset.frameId,
      inspector: document.querySelector('#atlas-inspector')?.dataset.frameId,
      nodes: document.querySelectorAll('.constellation-node').length,
      topK: document.querySelector('#atlas-top-k')?.value }));
    throw new Error(`${error.message}; update state ${JSON.stringify(state)}`);
  }
  const frameAcceptanceMs = await page.evaluate(start => performance.now() - start, updateStarted);
  const finalFrame = await page.locator('#atlas-frame-label').getAttribute('data-frame-id');
  assert.equal(finalFrame, await page.locator('#atlas-inspector').getAttribute('data-frame-id'));
  const camera = await cameraSamples(page);
  await requests.settle();
  const finalResourceTiming = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({
    path: new URL(entry.name).pathname, transferBytes: entry.transferSize,
    encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })));
  const api = requests.records.filter(item => item.api);
  assert(api.every(item => item.status === 200));
  assert(api.every(item => item.decodedBytes <= LIMITS.decodedBytes));
  assert.deepEqual(errors, []); assert.deepEqual(requests.failures, []);
  const result = { workload: workload.name, profile: profile.name, trial, elapsedMs: Date.now() - started,
    initial, frameAcceptanceMs, acceptedFrameId: finalFrame, camera,
    transport: { cache: 'disabled', initial: initialTransport,
      compression: [...new Set(requests.records.map(item => item.contentEncoding).filter(Boolean))],
      apiResponses: api, totalHttpRequests: requests.attempts.length,
      totalDecodedBytes: requests.records.reduce((sum, item) => sum + item.decodedBytes, 0),
      totalTransferBytes: finalResourceTiming.reduce((sum, item) => sum + item.transferBytes, 0),
      resourceTiming: finalResourceTiming }, errors };
  await cdp.detach();
  await context.close();
  return result;
}

async function collectMemory(cdp, page, minute, serverPid, browserPid) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(250);
  const counters = await cdp.send('Memory.getDOMCounters');
  const heap = await cdp.send('Runtime.getHeapUsage');
  return { minute, timestamp: new Date().toISOString(), ...counters, heapUsedBytes: heap.usedSize,
    serverRssBytes: descendantsRss(serverPid),
    browserRssBytes: descendantsRss(browserPid, row => /chrome|chromium/i.test(row.command)),
    route: new URL(page.url()).pathname };
}

async function soak(browser, origin, paths, durationMs, serverPid, browserPid) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = await tracker(context, page, cdp, LIMITS.totalHttp, LIMITS.soakApi);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function cycleOnce(cycle) {
    await page.goto(new URL(paths.inventory, origin).href, { waitUntil: 'domcontentloaded' });
    await ready(page, 'inventory', 61);
    const density = page.locator('#atlas-density');
    await density.fill(cycle % 2 ? '60' : '100'); await density.dispatchEvent('input');
    await page.locator('.constellation-edge-hit').first().click({ force: true });
    await page.locator('.atlas-premise').first().waitFor({ timeout: 10000 });
    await requests.settle();
    await page.goto(new URL(paths.reviewed, origin).href, { waitUntil: 'domcontentloaded' });
    await ready(page, 'reviewed', 2);
    await page.locator('.atlas-candidate-list button').first().click();
    await page.locator('.atlas-claim').first().waitFor({ timeout: 10000 });
    await requests.settle();
    await page.goto(new URL('/index.html', origin).href, { waitUntil: 'networkidle' });
    await requests.settle();
  }
  // Prime one identical route cycle so the before/after resting-route samples
  // have comparable document and code-cache history.
  await cycleOnce(0);
  await page.waitForTimeout(300);
  const samples = [await collectMemory(cdp, page, 0, serverPid, browserPid)];
  const started = Date.now();
  let cycle = 0;
  let nextSample = 2 * 60 * 1000;
  while (Date.now() - started < durationMs) {
    await cycleOnce(cycle);
    cycle += 1;
    const elapsed = Date.now() - started;
    if (elapsed >= nextSample || elapsed >= durationMs) {
      await page.waitForTimeout(300);
      samples.push(await collectMemory(cdp, page, elapsed / 60000, serverPid, browserPid));
      nextSample += 2 * 60 * 1000;
    }
    await requests.settle();
    const apiCount = requests.attempts.filter(item => item.api).length;
    assert(apiCount <= LIMITS.soakApi, `soak API budget exceeded: ${apiCount}`);
    assert(requests.attempts.length <= LIMITS.totalHttp, `soak HTTP budget exceeded: ${requests.attempts.length}`);
    const remaining = Math.min(50000 - (Date.now() - started) % 50000,
      durationMs - (Date.now() - started));
    if (remaining > 0) await page.waitForTimeout(remaining);
  }
  if (samples.length === 1 || samples.at(-1).minute < (Date.now() - started) / 60000 - .1) {
    samples.push(await collectMemory(cdp, page, (Date.now() - started) / 60000, serverPid, browserPid));
  }
  const result = { durationMs: Date.now() - started, cycles: cycle, samples,
    requests: { api: requests.attempts.filter(item => item.api).length, total: requests.attempts.length,
      completed: requests.records.length, failures: requests.failures,
      decodedBytes: requests.records.reduce((sum, item) => sum + item.decodedBytes, 0),
      transferBytes: requests.records.reduce((sum, item) => sum + (item.transferBytes || 0), 0) }, errors,
    evaluation: evaluateStability(samples) };
  await context.close();
  return result;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.resolve(argument('--output', path.join(root, 'docs/research/issue11/browser-playwright.json')));
  const playwrightRoot = path.resolve(argument('--playwright-root', process.env.PLAYWRIGHT_ROOT || '/tmp/playwright-1.63.0'));
  const samples = Number(argument('--samples', '5'));
  const soakMinutes = Number(argument('--soak-minutes', '20'));
  assert(Number.isInteger(samples) && samples > 0 && samples <= 10);
  assert(soakMinutes >= 0 && soakMinutes <= 20);
  const origin = loopbackOrigin(argument('--origin', 'http://127.0.0.1:8139/'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirtyPatch = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).sort();
  const harnessBytes = await fs.readFile(fileURLToPath(import.meta.url));
  const { chromium } = await import(path.join(playwrightRoot, 'node_modules/playwright/index.mjs'));
  const executablePath = chromium.executablePath();
  assert(executablePath.includes('chromium-'), 'expected Playwright-managed Chromium');
  const server = spawn(process.execPath, ['scripts/market_field_dev.js'], { cwd: root,
    env: { ...process.env, PORT: origin.port }, stdio: ['ignore', 'pipe', 'pipe'] });
  const report = { schemaVersion: '2.0', status: 'failed', startedAt: new Date().toISOString(),
    question: 'Do bounded real S0 inventory and reviewed frames meet interaction budgets without retained browser-state growth?',
    commit, runtimeState: { dirtyPatchSha256: crypto.createHash('sha256').update(dirtyPatch).digest('hex'),
      untracked, harnessSha256: crypto.createHash('sha256').update(harnessBytes).digest('hex') },
    budgets: BUDGETS, limits: LIMITS, environment: { platform: process.platform,
      release: os.release(), cpus: os.cpus().length, cpuModel: os.cpus()[0].model,
      memoryBytes: os.totalmem(), node: process.version, playwright: '1.63.0', executablePath,
      server: 'loopback Node/SQLite; warm process and OS cache', gpuMemory: 'not_evaluated' }, measurements: [] };
  const deadline = Date.now() + LIMITS.runtimeMs;
  const resource = { peakBrowserRssBytes: 0, peakServerRssBytes: 0, violation: null };
  let browser;
  const resourceTimer = setInterval(async () => {
    resource.peakServerRssBytes = Math.max(resource.peakServerRssBytes, descendantsRss(server.pid));
    resource.peakBrowserRssBytes = Math.max(resource.peakBrowserRssBytes,
      descendantsRss(process.pid, row => /chrome|chromium/i.test(row.command)));
    if (Date.now() > deadline) resource.violation ||= 'runtime_limit';
    if (resource.peakBrowserRssBytes > LIMITS.browserRssBytes) resource.violation ||= 'browser_rss_limit';
    if (resource.violation) {
      server.kill('SIGTERM');
      try { await browser?.close(); } catch {}
    }
  }, 500);
  try {
    await waitForServer(origin, Date.now() + 10000);
    browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
    const browserVersion = browser.version();
    const browserCdp = await browser.newBrowserCDPSession();
    const systemInfo = await browserCdp.send('SystemInfo.getInfo');
    const inventory = JSON.parse(await fs.readFile(path.join(root, 'api/data/atlas/current.json')));
    const reviewed = JSON.parse(await fs.readFile(path.join(root, 'api/data/atlas-reviewed/current.json')));
    const artifact = JSON.parse(await fs.readFile(path.join(root, `api/data/atlas/${inventory.build_id}.json`))).counts
      ? 'artifact_01044292a1f8dc05285bdb5e7c3814dd91e577059b74385fff4bacaaf26bc3a8' : '';
    const base = `/atlas.html?mode=focus&build_id=${inventory.build_id}&source=cncf&year=2024&temporal_mode=snapshot&artifact=${artifact}&candidate=4d9ade2bfb2aa6cb4afb`;
    const reviewedPath = `/atlas.html?layer=reviewed&mode=focus&build_id=${reviewed.build_id}&clock=source_publication&temporal_mode=published_through&cutoff=2022-02-24&basis=documented&predicate=&direction=both&entity=snowflake&top_k=60`;
    report.builds = { inventory: inventory.build_id, reviewed: reviewed.build_id };
    report.environment.browser = browserVersion;
    report.environment.gpu = {
      devices: systemInfo.gpu?.devices?.map(device => ({ vendorId: device.vendorId,
        deviceId: device.deviceId, vendorString: device.vendorString,
        deviceString: device.deviceString })) || [],
      featureStatus: systemInfo.gpu?.featureStatus || {},
      limitation: 'availability only; GPU retained memory and compositor completion are not evaluated'
    };
    const profiles = [
      { name: 'desktop', viewport: { width: 1440, height: 1000 }, cpu: 1, latency: 0, bytesPerSecond: -1 },
      { name: 'constrained', viewport: { width: 390, height: 844 }, cpu: 4, latency: 80, bytesPerSecond: 1000000 }
    ];
    const workloads = [
      { name: 'inventory-top60', layer: 'inventory', path: `${base}&top_k=60`, minimumNodes: 61, updateTopK: 100, updateMinimumNodes: 101 },
      { name: 'inventory-top100', layer: 'inventory', path: `${base}&top_k=100`, minimumNodes: 101, updateTopK: 60, updateMinimumNodes: 61 },
      { name: 'reviewed', layer: 'reviewed', path: reviewedPath, minimumNodes: 2, updateTopK: 100, updateMinimumNodes: 2 }
    ];
    for (const profile of profiles) for (const workload of workloads) for (let trial = 1; trial <= samples; trial += 1) {
      report.measurements.push(await measureOne(browser, origin, profile, workload, trial));
    }
    report.summaries = profiles.flatMap(profile => workloads.map(workload => {
      const selected = report.measurements.filter(item => item.profile === profile.name && item.workload === workload.name);
      return { profile: profile.name, workload: workload.name,
        graphReadyMs: summarize(selected.map(item => item.initial.graphReadyMs)),
        frameAcceptanceMs: summarize(selected.map(item => item.frameAcceptanceMs)),
        renderMs: summarize(selected.map(item => item.initial.renderMs)),
        zoomCameraMs: summarize(selected.flatMap(item => item.camera.zoom)),
        panCameraMs: summarize(selected.flatMap(item => item.camera.pan)),
        maximumApiBytes: Math.max(...selected.flatMap(item => item.transport.apiResponses.map(response => response.decodedBytes))) };
    }));
    const perWorkload = Object.fromEntries(workloads.map(workload => [workload.name,
      report.measurements.filter(item => item.workload === workload.name).reduce((sum, item) => sum + item.transport.apiResponses.length, 0)]));
    assert(Object.values(perWorkload).every(count => count <= LIMITS.apiPerWorkload));
    report.requestCounts = perWorkload;
    if (soakMinutes) report.soak = await soak(browser, origin,
      { inventory: `${base}&top_k=60`, reviewed: reviewedPath }, soakMinutes * 60 * 1000, server.pid, process.pid);
    const evaluations = report.summaries.map(summary => {
      const budget = BUDGETS[summary.profile];
      return { profile: summary.profile, workload: summary.workload,
        passed: summary.graphReadyMs.p95 <= budget.graphReadyP95Ms
          && summary.frameAcceptanceMs.p95 <= budget.frameAcceptanceP95Ms
          && summary.zoomCameraMs.p95 <= budget.cameraP95Ms
          && summary.panCameraMs.p95 <= budget.cameraP95Ms
          && summary.maximumApiBytes <= LIMITS.decodedBytes };
    });
    report.evaluation = { workloads: evaluations,
      soakPassed: report.soak ? report.soak.evaluation.endpointWithinBudget
        && !report.soak.evaluation.monotonicallyIncreasing.length
        && !report.soak.errors.length && !report.soak.requests.failures.length : null,
      resourcePassed: !resource.violation };
    report.status = evaluations.every(item => item.passed) && report.evaluation.resourcePassed
      && (report.evaluation.soakPassed ?? true) ? 'passed' : 'failed';
  } catch (error) {
    report.error = error.stack || error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (browser) await browser.close();
    server.kill('SIGTERM');
    clearInterval(resourceTimer);
    report.resources = resource;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    const size = (await fs.stat(output)).size;
    assert(size <= LIMITS.outputBytes, `output exceeds ${LIMITS.outputBytes}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
