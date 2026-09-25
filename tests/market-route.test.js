const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const web = path.resolve(__dirname, '../web');

class LocalResources extends ResourceLoader {
  fetch(url) {
    if (!url.startsWith('https://logpose.test/')) return null;
    return fs.readFile(path.join(web, new URL(url).pathname));
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('market route did not reach expected state');
}

async function page(route = '/', failOncePath = null, mockWebgl = false) {
  const errors = [];
  let failed = false;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const html = await fs.readFile(path.join(web, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://logpose.test' + route,
    runScripts: 'dangerously',
    resources: new LocalResources(),
    virtualConsole,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      if (mockWebgl) {
        const bufferUploads = [];
        window.__mockWebglBufferUploads = bufferUploads;
        const constants = {
          VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ARRAY_BUFFER: 4,
          FLOAT: 5, BLEND: 6, SRC_ALPHA: 7, ONE_MINUS_SRC_ALPHA: 8,
          COLOR_BUFFER_BIT: 9, DYNAMIC_DRAW: 10, LINES: 11, POINTS: 12
        };
        const gl = new Proxy({
          ...constants,
          createShader: () => ({}),
          createProgram: () => ({}),
          createBuffer: () => ({}),
          getProgramParameter: () => true,
          getAttribLocation: (_program, name) => ({ position: 0, color: 1, pointSize: 2 })[name],
          getExtension: () => ({ loseContext() {} }),
          bufferData: (_target, data) => bufferUploads.push(data.length)
        }, { get(target, property) {
          if (property in target) return target[property];
          return () => {};
        } });
        window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
          return kind === 'webgl' ? gl : null;
        };
      }
      window.fetch = async url => {
        const pathname = new URL(url, window.location.href).pathname;
        if (pathname === failOncePath && !failed) {
          failed = true;
          return { ok: false, status: 503 };
        }
        const file = path.join(web, pathname);
        try {
          const body = await fs.readFile(file, 'utf8');
          return { ok: true, json: async () => JSON.parse(body) };
        } catch {
          return { ok: false, status: 404 };
        }
      };
    }
  });
  await waitFor(() => dom.window.document.querySelector('#view')?.getAttribute('aria-busy') === 'false');
  assert.deepEqual(errors, []);
  return dom;
}

test('canonical route searches retained evidence and opens a full page record', async () => {
  const dom = await page();
  const { document, Event } = dom.window;
  assert.match(document.querySelector('#view h2').textContent, /research the record/i);
  assert.match(document.querySelector('.data-coverage').textContent, /18,076/);
  await waitFor(() => document.querySelector('.data-results-head')?.textContent.includes('starting records')
    && !document.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  const family = document.querySelector('[aria-label="Record family"]');
  family.value = 'pages';
  family.dispatchEvent(new Event('change', { bubbles: true }));
  assert.match(document.querySelector('.data-results-head').textContent, /89 matching records/);
  document.querySelector('.data-result').click();
  await waitFor(() => document.querySelector('.data-inspector .data-reading')?.textContent.length > 500);
  assert.match(document.querySelector('.data-inspector').textContent, /captured text/i);
  assert.equal(new URL(dom.window.location.href).searchParams.get('dataFamily'), 'pages');
  const reloaded = await page(dom.window.location.pathname + dom.window.location.search);
  await waitFor(() => reloaded.window.document.querySelector('.data-inspector .data-reading')?.textContent.length > 500);
  dom.window.close();
  reloaded.window.close();
});

test('research desk drills from untagged inventory and SEC candidates into retained detail', async () => {
  const inventory = await page('/?dataFamily=inventory&dataQuery=Airship');
  const inventoryDocument = inventory.window.document;
  await waitFor(() => inventoryDocument.querySelector('.data-results-head')?.textContent.includes('matching records')
    && !inventoryDocument.querySelector('.data-results-head')?.textContent.includes('loading full inventory'));
  assert.match(inventoryDocument.querySelector('.data-results').textContent, /Airship/);
  inventoryDocument.querySelector('.data-result').click();
  await waitFor(() => inventoryDocument.querySelector('.data-inspector-body .data-facts'));
  assert.match(inventoryDocument.querySelector('.data-inspector').textContent, /unmapped_category/);
  assert.match(inventoryDocument.querySelector('.data-inspector').textContent, /No candidate tag or reviewed company link/);
  inventory.window.close();

  const sec = await page('/?dataFamily=sec&dataCompany=palantir&dataYear=2021');
  const secDocument = sec.window.document;
  assert.match(secDocument.querySelector('.data-results-head').textContent, /matching records/);
  secDocument.querySelector('.data-result').click();
  await waitFor(() => secDocument.querySelector('.data-inspector-body')?.textContent.includes('Selection policy'));
  assert.match(secDocument.querySelector('.data-inspector').textContent, /accession/i);
  assert(secDocument.querySelectorAll('.data-alternative').length > 0);
  sec.window.close();
});

test('research desk market point opens participant detail and topology shows review history', async () => {
  const market = await page('/?dataFamily=market');
  const marketDocument = market.window.document;
  marketDocument.querySelector('.data-result').click();
  await waitFor(() => marketDocument.querySelector('.data-market-chart svg'));
  assert.match(marketDocument.querySelector('.data-market-day').textContent, /participant/i);
  marketDocument.querySelector('.data-participant-button').click();
  assert.match(marketDocument.querySelector('.data-participant-breakdown').textContent, /tape a shares/i);
  market.window.close();

  const topology = await page('/?dataFamily=topology');
  const topologyDocument = topology.window.document;
  topologyDocument.querySelector('.data-result').click();
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /review history/i);
  assert.match(topologyDocument.querySelector('.data-inspector').textContent, /source/i);
  topology.window.close();
});

test('source inventory route exposes 2020–2026 raw rows and keeps company years separate', async () => {
  const dom = await page('/?view=explore');
  const { document, Event } = dom.window;
  assert.match(document.querySelector('#view h2').textContent, /explore software sources/i);
  assert.match(document.querySelector('#view').textContent, /2020–2026/);
  assert.equal(document.querySelector('[aria-label="Select period-end year"]'), null);
  const source = document.querySelector('[aria-label="Pinned source and year"]');
  assert.equal(source.value, 'cncf-2026');
  await waitFor(() => document.querySelectorAll('.full-inventory-row').length > 0);

  source.value = 'lfai-2020';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  source.value = 'cncf-2026';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('.full-inventory [role="status"]')
    ?.textContent.includes('in this pinned source'));
  const newest = JSON.parse(await fs.readFile(path.join(web, 'discovery-inventory/cncf-2026.json')));
  assert(document.querySelector('.full-inventory [role="status"]').textContent
    .includes(newest.rows.length.toLocaleString()));

  source.value = 'cncf-2020';
  source.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('.full-inventory [role="status"]')?.textContent.includes('in this pinned source'));
  assert.equal(new URL(dom.window.location.href).searchParams.get('inventory'), 'cncf-2020');
  const partition = JSON.parse(await fs.readFile(path.join(web, 'discovery-inventory/cncf-2020.json')));
  const untagged = partition.rows.find(row => row.mapping_status === 'unmapped_category'
    && row.name.length > 5);
  assert(untagged);
  const query = document.querySelector('[aria-label="Search all rows in selected source snapshot"]');
  query.value = untagged.name;
  query.dispatchEvent(new Event('input', { bubbles: true }));
  assert(document.querySelector('.full-inventory-results').textContent.includes(untagged.name));
  assert(document.querySelector('.full-inventory-results').textContent.includes('untagged row'));
  assert(document.querySelector('.full-inventory-results a[href]'));

  const year = document.querySelector('[aria-label="Record year"]');
  year.value = '2020';
  year.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(new URL(dom.window.location.href).searchParams.get('recordYear'), '2020');
  assert.equal(new URL(dom.window.location.href).searchParams.get('year'), null);
  dom.window.history.back();
  await waitFor(() => document.querySelector('[aria-label="Record year"]').value === 'all');
  assert.equal(document.querySelector('[aria-label="Pinned source and year"]').value, 'cncf-2020');
  dom.window.history.forward();
  await waitFor(() => document.querySelector('[aria-label="Record year"]').value === '2020');
  const reloaded = await page(dom.window.location.pathname + dom.window.location.search);
  assert.equal(reloaded.window.document.querySelector('[aria-label="Record year"]').value, '2020');
  assert.equal(reloaded.window.document.querySelector('[aria-label="Pinned source and year"]').value, 'cncf-2020');
  assert.equal(reloaded.window.document.querySelector('[aria-label="Search all rows in selected source snapshot"]').value,
    untagged.name);
  await waitFor(() => reloaded.window.document.querySelector('.full-inventory [role="status"]')
    ?.textContent.includes('in this pinned source'));

  document.querySelector('[data-view="overview"]').click();
  assert.equal(document.querySelector('[aria-label="Select period-end year"]').value, '2024');
  assert.match(document.querySelector('#view').textContent, /2021–2024/);
  assert.equal(new URL(dom.window.location.href).searchParams.get('view'), 'overview');
  dom.window.close();
  reloaded.window.close();
});

test('a failed raw partition offers a working retry', async () => {
  const dom = await page('/?view=explore', '/discovery-inventory/cncf-2026.json');
  const { document } = dom.window;
  await waitFor(() => document.querySelector('.full-inventory [role="status"]')
    ?.textContent.includes('Could not load'));
  document.querySelector('.full-inventory-results button').click();
  await waitFor(() => document.querySelectorAll('.full-inventory-row').length > 0);
  dom.window.close();
});

test('filtered topology WebGL maps each matching claim and lets every shown edge open its evidence', async () => {
  const dom = await page('/?view=topology', null, true);
  const { document, Event } = dom.window;
  const status = document.querySelector('[aria-label="Filter claim status"]');
  status.value = 'hypothesis';
  status.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('.topology-webgl-edge-button'));

  const edges = [...document.querySelectorAll('.topology-webgl-edge-button')];
  assert.equal(edges.length, 1);
  assert.equal(edges[0].dataset.claimStatus, 'hypothesis');
  const hypothesisVertexCount = dom.window.__mockWebglBufferUploads.at(-2);
  assert(hypothesisVertexCount > 100,
    'hypothesis draws separated dots instead of a continuous line');
  assert.match(edges[0].getAttribute('aria-label'), /business driver.*hypothesis/i);
  assert.match(document.querySelector('.topology-map-coverage').textContent, /Map shows 1 of 1 matching claims/);
  edges[0].click();
  await waitFor(() => document.querySelector('.topology-claim-detail'));
  assert.match(document.querySelector('.topology-claim-detail').textContent,
    /What remains unknown|shared business driver/i);
  assert.equal(document.querySelector('.topology-webgl-edge-button').getAttribute('aria-pressed'), 'true');

  status.value = 'documented';
  status.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('.topology-webgl-edge-button').length === 3);
  const documentedVertexCount = dom.window.__mockWebglBufferUploads.at(-2);
  assert(documentedVertexCount > 0, 'documented claims draw as source-stated lines');
  dom.window.close();
});
