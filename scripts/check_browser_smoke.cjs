// Launches an actual browser against the public or local read path.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const path = require('node:path');

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
    browser = await chromium.launch({ headless: true });
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
    const deepLink = new URL('/', baseUrl);
    deepLink.search = new URLSearchParams({ view: 'topology', topologyLayer: 'field',
      fieldCandidate: candidate.id, fieldNeighbor: neighbor.id }).toString();
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
    const reviewedManifest = JSON.parse(execFileSync('git', ['show',
      `${commitSha}:api/data/atlas-reviewed/current.json`]));
    const reviewedUrl = new URL('/atlas.html', baseUrl);
    reviewedUrl.search = new URLSearchParams({ layer: 'reviewed', entity: 'snowflake',
      neighbor: 'dbt-labs', cutoff: '2022-02-24', build_id: reviewedManifest.build_id }).toString();
    await page.goto(reviewedUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#atlas-inspector .atlas-claim').nth(2).waitFor({ state: 'visible', timeout: 30000 });
    const reviewedInspector = await page.locator('#atlas-inspector').innerText();
    assert(reviewedInspector.includes('announced partnership with'), 'partnership claim missing');
    assert(reviewedInspector.includes('invested in'), 'financing claim missing');
    assert(reviewedInspector.includes('integrates with'), 'accepted integration claim missing');
    assert(reviewedInspector.includes('64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece'), 'reviewed source hash missing');
    assert(reviewedInspector.includes('no reviewed inventory candidate mapping'), 'external entity label missing');
    assert.equal(await page.locator('#atlas-frame-label').getAttribute('data-frame-id'),
      await page.locator('#atlas-inspector').getAttribute('data-frame-id'), 'reviewed graph and inspector frame');
    assert.equal(await page.locator('.constellation-node').count(), 2, 'reviewed graph node count');
    report.checks.push({ name: 'reviewed-claims-deep-link', passed: true, build_id: reviewedManifest.build_id,
      claims: 3, clock: 'source_publication', review_lens: 'current_accepted_at_build' });
    await page.locator('#atlas-inspector a[href*="dataFamily=topology"]').first().click();
    await page.waitForFunction(() => {
      const params = new URLSearchParams(window.location.search);
      const body = document.querySelector('#data-inspector .data-inspector-body');
      return params.get('dataRecord') === 'dbt-labs-announced-partnership-snowflake-2022'
        && body?.textContent.includes('review history')
        && body?.querySelector('a[href*="dbt-labs-raises-222m"]');
    }, null, { timeout: 30000 });
    report.checks.push({ name: 'reviewed-claim-source-trail', passed: true });
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
