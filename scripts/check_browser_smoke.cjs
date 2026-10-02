// Launches an actual browser against the public or local read path.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { verifyAccessibleAtlas } = require('./check_atlas_accessibility.cjs');

async function verifyMissingBuildRecovery(page, validUrl, layer, report) {
  const validFrame = await page.locator('#atlas-frame-label').getAttribute('data-frame-id');
  assert(validFrame, 'valid atlas frame is required before recovery check');
  const validNodes = await page.locator('.constellation-node').count();
  const missingUrl = new URL(validUrl);
  missingUrl.searchParams.set('build_id', '0'.repeat(64));
  await page.goto(missingUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#atlas-retry').waitFor({ state: 'visible', timeout: 30000 });
  assert.match(await page.locator('#atlas-status').innerText(), /not hosted|snapshot is unavailable/);
  assert.equal(await page.locator('.constellation-node').count(), 0, 'missing build must not render another graph');
  assert.equal(await page.locator('.atlas-claim, .atlas-premise').count(), 0,
    'missing build must not render evidence from another build');
  const retryResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/atlas' && url.searchParams.get('build_id') === '0'.repeat(64);
  }, { timeout: 30000 });
  await page.locator('#atlas-retry').click();
  const response = await retryResponse;
  assert.equal(response.status(), 410, 'retry must retain the unavailable build selector');
  assert.equal((await response.json()).error, 'build_unavailable');
  await page.waitForFunction(() => !document.querySelector('#atlas-retry').hidden
    && /not hosted|snapshot is unavailable/.test(document.querySelector('#atlas-status').textContent));
  assert.equal(new URL(page.url()).searchParams.get('build_id'), '0'.repeat(64));
  assert.equal(await page.locator('.constellation-node').count(), 0);
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(({ frame, nodes }) =>
    document.querySelector('#atlas-frame-label')?.dataset.frameId === frame
      && document.querySelector('#atlas-inspector')?.dataset.frameId === frame
      && document.querySelectorAll('.constellation-node').length === nodes
      && !document.querySelector('#atlas-status')?.textContent,
  { frame: validFrame, nodes: validNodes }, { timeout: 30000 });
  report.checks.push({ name: `${layer}-missing-build-retry-recovery`, passed: true,
    recovered_frame_id: validFrame, nodes: validNodes });
}

async function verifyDecisionWorkflow(page, baseUrl, report) {
  await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#atlas-frame-label')?.dataset.frameId
    && !document.querySelector('#atlas-regions').disabled);
  const hiddenLabels = await page.locator('.constellation-node:not(.has-label):not(.is-focus):not(.is-hovered):not(.is-selected):not(:focus-visible) .constellation-label')
    .evaluateAll(labels => labels.map(label => getComputedStyle(label).display));
  assert(hiddenLabels.length > 0, 'default density must exercise collision-hidden labels');
  assert(hiddenLabels.every(display => display === 'none'), 'hidden labels must not enlarge node hit geometry');
  const edgePoint = await page.locator('.constellation-edge-hit').evaluateAll(lines => {
    for (const line of lines) {
      const point = line.ownerSVGElement.createSVGPoint();
      point.x = (line.x1.baseVal.value + line.x2.baseVal.value) / 2;
      point.y = (line.y1.baseVal.value + line.y2.baseVal.value) / 2;
      const screen = point.matrixTransform(line.getScreenCTM());
      if (document.elementFromPoint(screen.x, screen.y) === line)
        return { x: screen.x, y: screen.y, neighbor: line.dataset.neighbor };
    }
    return null;
  });
  assert(edgePoint, 'at least one displayed edge must have an exposed pointer target');
  await page.mouse.move(edgePoint.x, edgePoint.y);
  await page.waitForFunction(() => /GitLab and .*co-listed in “.*Continuous Integration & Delivery/.test(
    document.querySelector('.constellation-relationship')?.textContent), null, { timeout: 30000 });
  assert.match(await page.locator('.constellation-relationship').innerText(), /unreviewed co-listing evidence/);
  report.checks.push({ name: 'relationship-hover-exact-source-category', passed: true });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await page.waitForFunction(neighbor => new URL(location.href).searchParams.get('neighbor') === neighbor,
    edgePoint.neighbor, { timeout: 30000 });
  await page.locator('.atlas-premise').first().waitFor({ state: 'visible' });
  report.checks.push({ name: 'graph-hidden-label-geometry-and-pointer-edge', passed: true });
  // Target the actual marker circle, not the SVG group's decorative/label bounding box.
  await page.getByRole('button', { name: 'select GitLab company summary', exact: true })
    .locator('.constellation-hit').click();
  await page.locator('.atlas-company-stat strong').first().waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(new URL(page.url()).searchParams.get('candidate'), 'db7244f000eedc7a99c9');
  assert.deepEqual(await page.locator('.atlas-company-stat strong').allTextContents(), ['$579.9m', '+36.7%', '−73.1%']);
  assert.match(await page.locator('.atlas-company-summary').innerText(), /2023-02-01 to 2024-01-31.*2025-04-01/s);
  assert.equal(await page.locator('.atlas-stat-sources a').count(), 5);
  report.checks.push({ name: 'selected-company-facts-stay-on-graph', passed: true });
  await page.getByRole('link', { name: 'full stat sheet, sources & further reading →', exact: true }).click();
  await page.locator('.company-snapshot').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(new URL(page.url()).searchParams.get('company'), 'gitlab');
  assert.equal(await page.locator('.company-fact-sheet').getAttribute('open'), null);
  const captionStyle = await page.locator('.company-snapshot .caption').first().evaluate(element => ({
    size: parseFloat(getComputedStyle(element).fontSize), transform: getComputedStyle(element).textTransform }));
  assert(captionStyle.size >= 13);
  assert.equal(captionStyle.transform, 'none');
  const readingLayout = await page.locator('.company-reading-grid').evaluate(element => {
    const boxes = [...element.children].map(child => child.getBoundingClientRect());
    return { width: window.innerWidth, sideBySide: boxes[1].left >= boxes[0].right };
  });
  if (readingLayout.width > 900) assert(readingLayout.sideBySide, 'wide source reading must use both columns');
  assert.match(await page.locator('.company-snapshot').innerText(), /2025-04-01/);
  assert.deepEqual(await page.locator('.company-economic-card strong').allTextContents(), ['$579.9m', '+36.7%', '−73.1%']);
  assert.match(await page.locator('.company-metric-gaps').innerText(), /MRR: Unknown.*ARR: Unknown.*retention: Unknown.*cash flow: Unknown/);
  assert.equal(await page.locator('.company-economic-card a').count(), 5);
  assert.match(await page.locator('.company-further-reading').innerText(), /sources & further reading.*filed 2024-03-26/s);
  const priorRevenueLink = page.getByRole('link', { name: 'prior revenue →', exact: true });
  const priorRecord = new URL(await priorRevenueLink.getAttribute('href'), page.url()).searchParams.get('dataRecord');
  await priorRevenueLink.click();
  await page.locator('#data-inspector').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).searchParams.get('dataRecord'), priorRecord);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.locator('.company-snapshot').waitFor({ state: 'visible' });
  report.checks.push({ name: 'stat-sheet-derived-inputs-and-dated-further-reading', passed: true });
  await page.locator('.fictional-example > summary').click();
  assert.match(await page.locator('.fictional-example').innerText(), /fictional teaching example/);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  report.checks.push({ name: 'graph-company-snapshot-progressive-disclosure', passed: true });
  await page.getByRole('link', { name: 'start a company decision brief →', exact: true }).click();
  await page.locator('#decision-question').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(new URL(page.url()).searchParams.get('view'), 'compare');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'start a company decision brief →', exact: true })
    .waitFor({ state: 'visible' });
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await page.locator('#decision-question').waitFor({ state: 'visible' });
  report.checks.push({ name: 'atlas-decision-entry-history', passed: true });
  const companyUrl = new URL('/index.html?view=overview&company=datadog', baseUrl);
  await page.goto(companyUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: 'inspect dated evidence →', exact: true }).click();
  await page.locator('#company-detail').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(new URL(page.url()).searchParams.get('view'), 'explore');
  await page.locator('.company-fact-sheet > summary').click();
  const claim = page.locator('.company-relationships [data-claim]').first();
  const claimId = await claim.getAttribute('data-claim');
  await claim.click();
  assert.equal(new URL(page.url()).searchParams.get('dataRecord'), claimId);
  assert.match(await page.locator('#data-inspector').innerText(), /log management/);
  await page.goBack();
  await page.locator('#company-detail').waitFor({ state: 'visible' });
  await page.locator('#company-detail .detail-head button').click();
  assert.equal(new URL(page.url()).searchParams.has('company'), false);
  await page.goBack();
  await page.locator('#company-detail').waitFor({ state: 'visible' });
  report.checks.push({ name: 'company-evidence-claim-close-history', passed: true, claim_id: claimId });

  const compareUrl = new URL('/index.html?view=compare&pinned=datadog,weights-and-biases', baseUrl);
  await page.goto(compareUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const question = 'Smoke test: what evidence should be investigated next?';
  await page.locator('#decision-question').fill(question);
  await page.locator('#decision-datadog-why').fill('Smoke test note, not an investment recommendation.');
  await page.locator('.decision-evidence summary').first().click();
  await page.locator('.decision-evidence select').first().selectOption('context');
  await page.locator('.decision-evidence button').first().click();
  await page.locator('#data-inspector .data-reading').first().waitFor({ state: 'visible' });
  await page.goBack();
  assert.equal(await page.locator('#decision-question').inputValue(), question);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#decision-question').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#decision-question').inputValue(), question);
  assert(!page.url().includes('Smoke'), 'private notes must not enter URL state');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'download decision brief · JSON', exact: true }).click();
  const download = await downloadPromise;
  const brief = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(brief.investor_question, question);
  assert.equal(brief.scope.historical_replay, false);
  assert.equal(brief.companies.length, 2);
  assert.equal(brief.companies[0].citations[0].role, 'context');
  assert.match(brief.companies[0].citations[0].partition.sha256, /^[a-f0-9]{64}$/);
  assert.equal(brief.companies[1].citations.length, 0, 'uncited company must not acquire automatic evidence');
  const citedUrl = new URL(brief.companies[0].citations[0].record_url);
  assert.equal(citedUrl.searchParams.get('dataBuild'), brief.scope.catalog_build_id);
  await page.goto(citedUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#data-inspector .data-reading').first().waitFor({ state: 'visible' });
  await page.goBack();
  await page.locator('#decision-question').waitFor({ state: 'visible' });
  report.checks.push({ name: 'decision-brief-source-restore-download', passed: true,
    catalog_build_id: brief.scope.catalog_build_id });

  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth,
    document: document.documentElement.scrollWidth }));
  assert(widths.document <= widths.viewport, 'decision brief must not overflow the mobile page');
  report.checks.push({ name: 'decision-brief-mobile-width', passed: true, ...widths });
  await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const mobileEntry = page.getByRole('link', { name: 'start a company decision brief →', exact: true });
  await mobileEntry.waitFor({ state: 'visible', timeout: 30000 });
  await mobileEntry.click();
  await page.locator('#decision-question').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('#decision-question').inputValue(), question);
  report.checks.push({ name: 'mobile-atlas-decision-entry', passed: true, viewport: 390 });
  await page.setViewportSize({ width: 1365, height: 900 });
}

async function verifyPhoneCompanyFacts(page, baseUrl, report) {
  const captureDirectory = path.dirname(process.env.BROWSER_REPORT_PATH || 'browser-smoke.json');
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('.atlas-company-stat strong').first().waitFor({ state: 'visible', timeout: 30000 });
    assert.deepEqual(await page.locator('.atlas-company-stat strong').allTextContents(), ['$579.9m', '+36.7%', '−73.1%']);
    await page.locator('.atlas-view-settings > summary').click();
    const layout = await page.evaluate(() => {
      const metrics = [...document.querySelectorAll('.atlas-company-stat')].map(element => {
        const box = element.getBoundingClientRect();
        const label = element.querySelector('span').getBoundingClientRect();
        const value = element.querySelector('strong').getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, labelRight: label.right, valueLeft: value.left,
          border: getComputedStyle(element).borderTopStyle, padding: parseFloat(getComputedStyle(element).paddingTop) };
      });
      const selectors = ['#atlas-controls', '#atlas-inspector', '.atlas-company-stats',
        '.atlas-density', '.constellation-heading', '.constellation-mode-switch', '.constellation-camera-controls'];
      const overflow = selectors.filter(selector => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > window.innerWidth + 1 || element.scrollWidth > element.clientWidth + 1;
      });
      return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, metrics, overflow,
        sourceHeights: [...document.querySelectorAll('.atlas-stat-sources a')].map(element => element.getBoundingClientRect().height),
        filedDisplay: getComputedStyle(document.querySelector('.atlas-company-filed')).display };
    });
    assert(layout.document <= width, `phone page overflow at ${width}px`);
    assert.deepEqual(layout.overflow, [], `phone controls or facts overflow at ${width}px`);
    assert.equal(layout.metrics.length, 3);
    layout.metrics.forEach((metric, index) => {
      assert(metric.labelRight <= metric.valueLeft - 10, 'metric label and figure need breathing room');
      assert(metric.padding >= 20, 'metric rows need vertical breathing room');
      if (index) {
        assert(metric.top >= layout.metrics[index - 1].bottom - 1, 'phone metrics must stack');
        assert.equal(metric.border, 'solid', 'metric rows need visible separators');
      }
    });
    assert(layout.sourceHeights.every(height => height >= 44), 'source links need separate touch targets');
    assert.equal(layout.filedDisplay, 'block');
    await page.locator('#atlas-inspector').screenshot({ path: path.join(captureDirectory, `browser-phone-${width}-summary.png`) });
    await page.screenshot({ path: path.join(captureDirectory, `browser-phone-${width}-page.png`), fullPage: true });
    // Check actual narrow-screen node and edge activation, not a forced DOM click.
    await page.locator('.constellation-map').scrollIntoViewIfNeeded();
    const edgePoint = await page.locator('.constellation-edge-hit').evaluateAll(lines => {
      for (const line of lines) {
        const point = line.ownerSVGElement.createSVGPoint();
        point.x = (line.x1.baseVal.value + line.x2.baseVal.value) / 2;
        point.y = (line.y1.baseVal.value + line.y2.baseVal.value) / 2;
        const screen = point.matrixTransform(line.getScreenCTM());
        if (document.elementFromPoint(screen.x, screen.y) === line) return { x: screen.x, y: screen.y };
      }
      return null;
    });
    assert(edgePoint, 'phone graph needs an exposed edge target');
    await page.mouse.click(edgePoint.x, edgePoint.y);
    await page.locator('.atlas-premise').first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'select GitLab company summary', exact: true })
      .locator('.constellation-hit').click();
    await page.locator('.atlas-company-stat strong').first().waitFor({ state: 'visible' });
    const source = page.locator('.atlas-stat-sources a').first();
    const record = new URL(await source.getAttribute('href'), page.url()).searchParams.get('dataRecord');
    await source.click();
    await page.locator('#data-inspector').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).searchParams.get('dataRecord'), record);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.locator('.atlas-company-stat strong').first().waitFor({ state: 'visible' });
    await page.getByRole('link', { name: 'full stat sheet, sources & further reading →', exact: true }).click();
    await page.locator('.company-snapshot').waitFor({ state: 'visible' });
    const detailWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(detailWidth <= width, `full company sheet overflows at ${width}px`);
    if (width === 390) await page.locator('.company-snapshot').screenshot({
      path: path.join(captureDirectory, 'browser-phone-390-detail.png') });
    report.checks.push({ name: `phone-company-facts-${width}px`, passed: true, ...layout, detail_width: detailWidth });
  }
  await page.setViewportSize({ width: 1365, height: 900 });
}

async function main() {
  const report = { schema_version: '1.0', status: 'failed',
    base_url: process.env.BASE_URL, expected_sha: process.env.EXPECTED_SHA || null,
    checks: [], page_errors: [] };
  let browser;
  let page;
  try {
    const installRoot = process.env.PLAYWRIGHT_ROOT;
    if (!installRoot) throw new Error('PLAYWRIGHT_ROOT is required');
    const { chromium } = require(path.join(installRoot, 'node_modules/playwright'));
    const baseUrl = new URL(process.env.BASE_URL);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.pathname !== '/') {
      throw new Error('BASE_URL must be an HTTP origin');
    }
    const commitSha = process.env.EXPECTED_SHA ||
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error('expected commit must be a full SHA');
    report.expected_sha = commitSha;
    const graph = JSON.parse(execFileSync('git', ['show',
      `${commitSha}:api/data/market-field-graph.json`], { maxBuffer: 10 * 1024 * 1024 }));
    const [left, right] = graph.pairs[0];
    const candidate = graph.candidates[left];
    const neighbor = graph.candidates[right];
    report.candidate_id = candidate.id;
    report.neighbor_id = neighbor.id;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
    page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    page.on('pageerror', error => report.page_errors.push(error.message));
    const summaryResponse = await page.request.get(
      new URL('/api/market-field?mode=summary', baseUrl).href);
    assert.equal(summaryResponse.status(), 200, 'summary HTTP status');
    const summary = await summaryResponse.json();
    assert.equal(summary.build_id, graph.build_id, 'summary graph build');
    const detailUrl = new URL('/api/market-field', baseUrl);
    detailUrl.search = new URLSearchParams({ mode: 'detail', build_id: graph.build_id,
      candidate: candidate.id, neighbor: neighbor.id }).toString();
    const detailResponse = await page.request.get(detailUrl.href);
    assert.equal(detailResponse.status(), 200, 'detail HTTP status');
    const detail = await detailResponse.json();
    assert.equal(detail.build_id, graph.build_id, 'detail graph build');
    assert(detail.shared_observations?.length > 0, 'detail has no shared placements');
    const sourceRowId = detail.shared_observations[0].subject_rows[0].id;
    const sourceHash = detail.shared_observations[0].artifact_sha256;
    report.checks.push({ name: 'browser-api-build', passed: true, build_id: graph.build_id });

    // The public root is the bounded atlas. Walk one real retained placement
    // through focus and explanation so this smoke checks the primary journey.
    const atlasNavigation = await page.goto(baseUrl.href, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    assert.equal(atlasNavigation.status(), 200, 'atlas root HTTP status');
    await page.locator('#atlas-frame-label').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#atlas-regions').click();
    await page.locator('.atlas-region').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('.atlas-region').first().click();
    await page.locator('.atlas-access summary').click();
    await page.locator('.atlas-candidate-list button').first()
      .waitFor({ state: 'visible', timeout: 30000 });
    const focusButton = page.locator('.atlas-candidate-list button').first();
    const focusId = await focusButton.getAttribute('data-candidate');
    assert(focusId, 'atlas candidate list did not identify the selected candidate');
    await focusButton.click();
    await page.waitForFunction(candidateId =>
      new URLSearchParams(location.search).get('candidate') === candidateId, focusId,
    { timeout: 30000 });
    const neighborButtons = page.locator(`.atlas-candidate-list button:not([data-candidate="${focusId}"])`);
    await neighborButtons.first().waitFor({ state: 'visible', timeout: 30000 });
    await neighborButtons.first().click();
    await page.locator('#atlas-inspector .atlas-premise').first()
      .waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-premise-identifiers summary').first().click();
    const atlasInspector = await page.locator('#atlas-inspector').innerText();
    assert.match(atlasInspector, /exact shared placements · unreviewed co-listing/i,
      'atlas must label inventory overlap as unreviewed co-listing');
    assert.match(atlasInspector, /[a-f0-9]{64}/, 'atlas premise hash missing');
    assert(await page.locator('#atlas-inspector .atlas-premise a[href*="view=data"]').count() >= 2,
      'both retained source rows must be inspectable from the atlas');
    assert.equal(await page.locator('#atlas-frame-label').getAttribute('data-frame-id'),
      await page.locator('#atlas-inspector').getAttribute('data-frame-id'),
      'atlas frame and exact-premise inspector must agree');
    report.checks.push({ name: 'atlas-root-exact-evidence', passed: true,
      frame_id: await page.locator('#atlas-frame-label').getAttribute('data-frame-id') });

    const deepLink = new URL('/', baseUrl);
    deepLink.search = new URLSearchParams({ view: 'topology', topologyLayer: 'field',
      fieldCandidate: candidate.id, fieldNeighbor: neighbor.id }).toString();
    deepLink.pathname = '/index.html';
    const navigation = await page.goto(deepLink.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(navigation.status(), 200, 'deep link HTTP status');
    report.checks.push({ name: 'direct-deep-link', passed: true });
    await page.locator('#field-inspector .field-shared-placement').first()
      .waitFor({ state: 'visible', timeout: 30000 });
    const inspector = await page.locator('#field-inspector').innerText();
    assert(inspector.includes(candidate.name), 'candidate name missing from inspector');
    assert(inspector.includes(neighbor.name), 'neighbor name missing from inspector');
    assert(inspector.includes('shared artifact'), 'pinned source provenance missing');
    const sourceRows = page.locator('#field-inspector .field-shared-placement .field-row-button');
    assert(await sourceRows.count() >= 2, 'both retained source rows must be inspectable');
    report.checks.push({ name: 'exact-source-inspector', passed: true,
      source_row_buttons: await sourceRows.count() });
    await sourceRows.first().click();
    await page.waitForFunction(({ rowId, hash }) => {
      const params = new URLSearchParams(window.location.search);
      const body = document.querySelector('#data-inspector .data-inspector-body');
      return params.get('dataFamily') === 'inventory' && params.get('dataRecord') === rowId
        && body?.textContent.includes(hash);
    }, { rowId: sourceRowId, hash: sourceHash }, { timeout: 30000 });
    report.checks.push({ name: 'source-row-drill', passed: true,
      source_row_id: sourceRowId, artifact_sha256: sourceHash });
    const inventoryManifest = JSON.parse(execFileSync('git', ['show',
      `${commitSha}:api/data/atlas/current.json`]));
    const inventoryUrl = new URL('/atlas.html', baseUrl);
    inventoryUrl.search = new URLSearchParams({ mode: 'focus', build_id: inventoryManifest.build_id,
      source: 'cncf', year: '2024', temporal_mode: 'snapshot', top_k: '100',
      artifact: 'artifact_01044292a1f8dc05285bdb5e7c3814dd91e577059b74385fff4bacaaf26bc3a8',
      candidate: '4d9ade2bfb2aa6cb4afb', neighbor: '0b53be52084e857862ac' }).toString();
    await page.goto(inventoryUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-premise').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-premise-identifiers summary').first().click();
    assert.equal(await page.locator('.constellation-node').count(), 101, 'top 100 must render 100 neighbors and the focus');
    assert.equal(await page.locator('.atlas-candidate-list button').count(), 100, 'candidate list must match top 100');
    assert.equal(await page.locator('#atlas-frame-label').getAttribute('data-frame-id'),
      await page.locator('#atlas-inspector').getAttribute('data-frame-id'), 'inventory graph and inspector frame');
    assert((await page.locator('#atlas-inspector').innerText()).includes(
      'f1036cb6b8e9b9ef7647a0203ac349ba308173bf407f79cc8ccd4d4a2e7d46fd'), 'inventory source hash missing');
    report.checks.push({ name: 'inventory-top100-deep-link', passed: true,
      build_id: inventoryManifest.build_id, nodes: 101, neighbors: 100 });
    await verifyMissingBuildRecovery(page, inventoryUrl, 'inventory', report);
    const reviewedManifest = JSON.parse(execFileSync('git', ['show',
      `${commitSha}:api/data/atlas-reviewed/current.json`]));
    const reviewedUrl = new URL('/atlas.html', baseUrl);
    reviewedUrl.search = new URLSearchParams({ mode: 'focus', candidate: '4d9ade2bfb2aa6cb4afb',
      neighbor: '0b53be52084e857862ac', source: 'cncf', year: '2024',
      reviewed_cutoff: '2025-02-20', reviewed_basis: 'documented',
      reviewed_build_id: reviewedManifest.build_id }).toString();
    await page.goto(reviewedUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-claim').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-claim-audit summary').click();
    const reviewedInspector = await page.locator('#atlas-inspector').innerText();
    assert(reviewedInspector.includes('named competitor of'), 'typed pair claim missing');
    assert(reviewedInspector.includes('published 2025-02-20'), 'source publication date missing');
    assert(reviewedInspector.includes('711ee14f238f3e12597a03d889b7d8c29785eee865e1cecd8e20e0578a67facf'), 'reviewed source hash missing');
    assert(!reviewedInspector.includes('announced partnership with'), 'unrelated pair claim leaked into inspector');
    assert.equal(await page.locator('#atlas-frame-label').getAttribute('data-frame-id'),
      await page.locator('#atlas-inspector').getAttribute('data-frame-id'), 'inventory graph and contextual claims frame');
    assert.equal(await page.locator('.constellation-map').count(), 1, 'only one atlas graph should render');
    report.checks.push({ name: 'contextual-reviewed-pair', passed: true, build_id: reviewedManifest.build_id,
      claims: 1, clock: 'source_publication', review_lens: 'current_accepted_at_build' });
    const missingReviewed = new URL(reviewedUrl);
    missingReviewed.searchParams.set('reviewed_build_id', '0'.repeat(64));
    await page.goto(missingReviewed.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('.atlas-relationship-body button').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.locator('.atlas-relationship-body').innerText(), /not hosted/);
    assert.equal(await page.locator('.atlas-claim').count(), 0, 'unavailable reviewed build must not show a claim');
    assert(await page.locator('.constellation-node').count() > 0, 'independent inventory frame should remain usable');
    report.checks.push({ name: 'independent-reviewed-build-unavailable', passed: true });
    await page.goto(reviewedUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-claim').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#atlas-inspector a[href*="dataFamily=topology"]').first().click();
    await page.waitForFunction(() => {
      const params = new URLSearchParams(window.location.search);
      const body = document.querySelector('#data-inspector .data-inspector-body');
      return params.get('dataRecord') === 'datadog-named-competitor-elastic-log-management-2024'
        && body?.textContent.includes('review history')
        && body?.textContent.includes('log management');
    }, null, { timeout: 30000 });
    report.checks.push({ name: 'reviewed-claim-source-trail', passed: true });
    const legacyClaim = new URL('/atlas.html', baseUrl);
    legacyClaim.search = new URLSearchParams({ layer: 'reviewed', mode: 'explain',
      entity: 'snowflake', claim: 'dbt-labs-announced-partnership-snowflake-2022',
      cutoff: '2022-02-24', basis: 'documented', build_id: reviewedManifest.build_id }).toString();
    await page.goto(legacyClaim.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => new URLSearchParams(location.search).get('dataRecord')
      === 'dbt-labs-announced-partnership-snowflake-2022'
      && document.querySelector('#data-inspector .data-inspector-body')?.textContent.includes('dbt Labs'),
    null, { timeout: 30000 });
    assert.equal(new URL(page.url()).pathname, '/index.html', 'legacy exact claim must open retained record');
    report.checks.push({ name: 'legacy-exact-claim-route', passed: true,
      claim: 'dbt-labs-announced-partnership-snowflake-2022' });
    legacyClaim.searchParams.set('build_id', '0'.repeat(64));
    await page.goto(legacyClaim.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#atlas-retry').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(new URL(page.url()).pathname, '/atlas.html', 'unavailable reviewed build must not redirect to current claim');
    assert.match(await page.locator('#atlas-status').innerText(), /not hosted/);
    report.checks.push({ name: 'legacy-exact-claim-build-unavailable', passed: true });
    await verifyAccessibleAtlas(browser, inventoryUrl, 'inventory', report);
    await verifyAccessibleAtlas(browser, reviewedUrl, 'contextual', report);
    await verifyDecisionWorkflow(page, baseUrl, report);
    await verifyPhoneCompanyFacts(page, baseUrl, report);
    assert.deepEqual(report.page_errors, [], 'uncaught browser errors');
    report.status = 'passed';
  } catch (error) {
    report.error = error.message;
    if (page) report.current_url = page.url();
  } finally {
    if (browser) await browser.close();
    writeFileSync(process.env.BROWSER_REPORT_PATH || 'browser-smoke.json',
      JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    error: report.error || null }));
  if (report.status !== 'passed') process.exitCode = 1;
}

main();
