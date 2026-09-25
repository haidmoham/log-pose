import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { loadExpected, runHealthCheck, verifySite } from '../scripts/check_deployment_health.mjs';

const require = createRequire(import.meta.url);
const { handleMarketField } = require('../api/market-field.js');
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expected = loadExpected(commitSha);
const assetPaths = new Map(expected.assets.map(asset => [asset.pathname,
  asset.name === 'html' ? 'web/index.html'
    : asset.name === 'app' ? 'web/app.js'
      : asset.name === 'field-view' ? 'web/discovery-topology-view.js'
        : asset.name === 'dashboard' ? 'web/dashboard.json' : 'web/data/index.json']));

function fakeFetch({ staleApp = false, protectedUnique = false } = {}) {
  return async input => {
    const url = new URL(input);
    if (protectedUnique && url.hostname.endsWith('.vercel.app') &&
        url.hostname !== 'log-pose-five.vercel.app') {
      return new Response('', { status: 302,
        headers: { location: 'https://vercel.com/sso-api?next=protected' } });
    }
    const assetPath = assetPaths.get(url.pathname === '/' ? '/' : url.pathname);
    if (assetPath) {
      const bytes = execFileSync('git', ['show', `${commitSha}:${assetPath}`]);
      if (staleApp && url.pathname === '/app.js') bytes[0] ^= 1;
      return new Response(bytes, { status: 200 });
    }
    if (url.pathname === '/api/market-field') {
      const result = handleMarketField(url.searchParams);
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    return new Response('missing', { status: 404 });
  };
}

test('exact committed assets, graph build, and source inspector pass together', async () => {
  const result = await verifySite('https://logpose.mhaider.dev/', expected, fakeFetch());
  assert.equal(result.passed, true);
  assert(result.checks.some(check => check.name === 'direct-deep-link' && check.passed));
  assert(result.checks.some(check => check.name === 'api-source-inspector' && check.passed));
});

test('one stale served asset fails even when the API still has the right graph', async () => {
  const result = await verifySite('https://logpose.mhaider.dev/', expected,
    fakeFetch({ staleApp: true }));
  assert.equal(result.passed, false);
  assert(result.checks.some(check => check.name === 'app' && !check.passed));
});

test('release report records protected unique URL and still requires public exact bytes', async () => {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'log-pose-smoke-')), 'report.json');
  const report = await runHealthCheck({ expectedSha: commitSha,
    productionUrl: 'https://logpose.mhaider.dev/',
    aliasUrl: 'https://log-pose-five.vercel.app/',
    deploymentUrl: 'https://log-pose-fixture.vercel.app/',
    attempts: 1, intervalMs: 0, reportPath,
    fetchImpl: fakeFetch({ protectedUnique: true }) });
  assert.equal(report.status, 'passed');
  assert.equal(report.unique_deployment.status, 'not_evaluated');
  assert.deepEqual(JSON.parse(readFileSync(reportPath)), report);
});

test('scheduled check pins one commit and labels the absent unique URL', async () => {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'log-pose-scheduled-')), 'report.json');
  const report = await runHealthCheck({ expectedSha: commitSha,
    productionUrl: 'https://logpose.mhaider.dev/',
    aliasUrl: 'https://log-pose-five.vercel.app/',
    deploymentUrl: '', attempts: 1, intervalMs: 0, reportPath,
    fetchImpl: fakeFetch() });
  assert.equal(report.status, 'passed');
  assert.equal(report.expected_sha, commitSha);
  assert.equal(report.unique_deployment.status, 'not_evaluated');
  assert.equal(report.attempts[0].production.passed, true);
  assert.equal(report.attempts[0].alias.passed, true);
});

test('unique deployment probe failure cannot leave a passed release receipt', async () => {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'log-pose-probe-')), 'report.json');
  const fetchImpl = fakeFetch();
  const report = await runHealthCheck({ expectedSha: commitSha,
    productionUrl: 'https://logpose.mhaider.dev/',
    aliasUrl: 'https://log-pose-five.vercel.app/',
    deploymentUrl: 'https://log-pose-fixture.vercel.app/',
    attempts: 1, intervalMs: 0, reportPath,
    fetchImpl: input => new URL(input).hostname === 'log-pose-fixture.vercel.app'
      ? Promise.reject(new Error('unique deployment network failure')) : fetchImpl(input) });
  assert.equal(report.attempts[0].passed, true);
  assert.equal(report.status, 'failed');
  assert.equal(report.unique_deployment.status, 'failed');
  assert.deepEqual(JSON.parse(readFileSync(reportPath)), report);
});


test('protected unique URL does not mask a failed public origin', async () => {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'log-pose-stale-public-')), 'report.json');
  const report = await runHealthCheck({ expectedSha: commitSha,
    productionUrl: 'https://logpose.mhaider.dev/',
    aliasUrl: 'https://log-pose-five.vercel.app/',
    deploymentUrl: 'https://log-pose-fixture.vercel.app/',
    attempts: 1, intervalMs: 0, reportPath,
    fetchImpl: fakeFetch({ staleApp: true, protectedUnique: true }) });
  assert.equal(report.status, 'failed');
  assert.equal(report.attempts[0].passed, false);
  assert.equal(report.unique_deployment.status, 'not_evaluated');
  assert(!report.unique_deployment.reason.includes('were verified'));
  assert(!report.unique_deployment.reason.includes('domain verified'));
  assert.deepEqual(JSON.parse(readFileSync(reportPath)), report);
});
