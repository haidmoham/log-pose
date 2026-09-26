// Read-only release check. Expected bytes come from the exact deployed commit.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PUBLIC_HOST = 'logpose.mhaider.dev';
const PUBLIC_ALIAS = 'log-pose-five.vercel.app';
const ASSETS = [
  ['html', '/', 'web/atlas.html'],
  ['console-html', '/index.html', 'web/index.html'],
  ['app', '/app.js', 'web/app.js'],
  ['field-view', '/discovery-topology-view.js', 'web/discovery-topology-view.js'],
  ['dashboard', '/dashboard.json', 'web/dashboard.json'],
  ['catalog', '/data/index.json', 'web/data/index.json'],
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function committedFile(commitSha, pathname) {
  return execFileSync('git', ['show', `${commitSha}:${pathname}`],
    { maxBuffer: 10 * 1024 * 1024 });
}

export function loadExpected(commitSha) {
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error('expected commit must be a full SHA');
  const localHead = execFileSync('git', ['rev-parse', '--is-inside-work-tree'],
    { encoding: 'utf8' }).trim();
  if (localHead !== 'true') throw new Error('release check needs the source repository');
  const assets = ASSETS.map(([name, pathname, sourcePath]) => ({
    name, pathname, sha256: sha256(committedFile(commitSha, sourcePath))
  }));
  const graph = JSON.parse(committedFile(commitSha, 'api/data/market-field-graph.json'));
  const catalog = JSON.parse(committedFile(commitSha, 'web/data/index.json'));
  const [left, right] = graph.pairs[0];
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    throw new Error('committed graph has no pair for source-inspector smoke');
  }
  return { commit_sha: commitSha, assets, graph_build_id: graph.build_id,
    graph_counts: graph.counts, catalog_build_id: catalog.build_id,
    candidate_id: graph.candidates[left].id, neighbor_id: graph.candidates[right].id };
}

async function readResponse(baseUrl, pathname, fetchImpl) {
  const url = new URL(pathname, baseUrl);
  const response = await fetchImpl(url, {
    redirect: 'manual', headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(10000)
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status} at ${url.pathname}`);
  const reportedSize = Number(response.headers.get('content-length') || 0);
  if (reportedSize > 8 * 1024 * 1024) throw new Error(`oversized response at ${url.pathname}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw new Error(`oversized response at ${url.pathname}`);
  return bytes;
}

export async function verifySite(baseUrl, expected, fetchImpl = fetch) {
  const checks = [];
  async function check(name, action) {
    try {
      const observation = await action();
      checks.push({ name, passed: true, ...observation });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message });
    }
  }
  await Promise.all(expected.assets.map(asset => check(asset.name, async () => {
    const bytes = await readResponse(baseUrl, asset.pathname, fetchImpl);
    const actual = sha256(bytes);
    if (actual !== asset.sha256) {
      throw new Error(`served SHA-256 ${actual} differs from commit ${asset.sha256}`);
    }
    return { sha256: actual, bytes: bytes.length };
  })));
  const deepLink = `/index.html?view=topology&topologyLayer=field&fieldCandidate=${expected.candidate_id}`
    + `&fieldNeighbor=${expected.neighbor_id}`;
  await check('direct-deep-link', async () => {
    const bytes = await readResponse(baseUrl, deepLink, fetchImpl);
    const actual = sha256(bytes);
    const html = expected.assets.find(asset => asset.name === 'console-html');
    if (actual !== html.sha256) throw new Error('console deep link does not serve the committed console HTML');
    return { sha256: actual };
  });

  let summary;
  await check('api-summary', async () => {
    summary = JSON.parse(await readResponse(baseUrl, '/api/market-field?mode=summary', fetchImpl));
    if (summary.build_id !== expected.graph_build_id) {
      throw new Error(`served graph ${summary.build_id} differs from commit ${expected.graph_build_id}`);
    }
    for (const [name, count] of Object.entries(expected.graph_counts)) {
      if (summary.counts?.[name] !== count) throw new Error(`served ${name} count differs from commit`);
    }
    return { build_id: summary.build_id, counts: summary.counts };
  });
  if (summary?.build_id === expected.graph_build_id) {
    const queryUrl = new URL('/api/market-field', baseUrl);
    queryUrl.search = new URLSearchParams({ mode: 'query', build_id: expected.graph_build_id,
      candidate: expected.candidate_id }).toString();
    await check('api-neighborhood', async () => {
      const query = JSON.parse(await readResponse(baseUrl, queryUrl.pathname + queryUrl.search, fetchImpl));
      if (query.build_id !== expected.graph_build_id || query.neighbor_count < 1 ||
          !query.neighbors.some(item => item.candidate.id === expected.neighbor_id)) {
        throw new Error('exact committed neighbor is absent from served query');
      }
      return { neighbor_count: query.neighbor_count };
    });
    const detailUrl = new URL('/api/market-field', baseUrl);
    detailUrl.search = new URLSearchParams({ mode: 'detail', build_id: expected.graph_build_id,
      candidate: expected.candidate_id, neighbor: expected.neighbor_id }).toString();
    await check('api-source-inspector', async () => {
      const detail = JSON.parse(await readResponse(baseUrl, detailUrl.pathname + detailUrl.search, fetchImpl));
      if (detail.build_id !== expected.graph_build_id ||
          detail.candidate?.id !== expected.candidate_id ||
          detail.neighbor?.id !== expected.neighbor_id ||
          !Array.isArray(detail.shared_observations) || !detail.shared_observations.length ||
          !detail.shared_observations.every(item => /^[a-f0-9]{64}$/.test(item.artifact_sha256)
            && item.subject_rows?.every(row => row.id)
            && item.object_rows?.every(row => row.id)
            && item.subject_rows.length && item.object_rows.length)) {
        throw new Error('source inspector lacks both pinned rows and artifact hashes');
      }
      return { shared_placements: detail.shared_observations.length };
    });
  } else {
    checks.push({ name: 'api-neighborhood', passed: false, error: 'summary build mismatch' });
    checks.push({ name: 'api-source-inspector', passed: false, error: 'summary build mismatch' });
  }
  return { passed: checks.every(item => item.passed), checks };
}

function validateUrls(productionUrl, aliasUrl, deploymentUrl) {
  const publicUrl = new URL(productionUrl);
  const alias = new URL(aliasUrl);
  if (publicUrl.protocol !== 'https:' || publicUrl.hostname !== PUBLIC_HOST ||
      publicUrl.username || publicUrl.password || publicUrl.port ||
      publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw new Error('production URL must be the canonical public origin');
  }
  if (alias.protocol !== 'https:' || alias.hostname !== PUBLIC_ALIAS ||
      alias.username || alias.password || alias.port ||
      alias.pathname !== '/' || alias.search || alias.hash) {
    throw new Error('alias URL must be the public project alias');
  }
  if (deploymentUrl) {
    const uniqueUrl = new URL(deploymentUrl);
    if (uniqueUrl.protocol !== 'https:' || uniqueUrl.username ||
        uniqueUrl.password || uniqueUrl.port ||
        !/^log-pose-[a-z0-9-]+\.vercel\.app$/.test(uniqueUrl.hostname) ||
        uniqueUrl.hostname === PUBLIC_ALIAS ||
        uniqueUrl.pathname !== '/' || uniqueUrl.search || uniqueUrl.hash) {
      throw new Error('deployment URL must be a unique Vercel origin');
    }
  }
}

export async function runHealthCheck(config) {
  const report = { schema_version: '1.0', status: 'failed', expected_sha: config.expectedSha,
    production_url: config.productionUrl, alias_url: config.aliasUrl,
    deployment_url: config.deploymentUrl,
    attempts: [], unique_deployment: { status: 'not_evaluated' } };
  try {
    validateUrls(config.productionUrl, config.aliasUrl, config.deploymentUrl);
    const expected = loadExpected(config.expectedSha);
    report.expected = { graph_build_id: expected.graph_build_id,
      catalog_build_id: expected.catalog_build_id, graph_counts: expected.graph_counts,
      asset_hashes: Object.fromEntries(expected.assets.map(asset => [asset.name, asset.sha256])) };
    const attempts = config.attempts ?? 12;
    const intervalMs = config.intervalMs ?? 15000;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20 ||
        !Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 30000) {
      throw new Error('invalid retry budget');
    }
    for (let index = 0; index < attempts; index++) {
      const [production, alias] = await Promise.all([
        verifySite(config.productionUrl, expected, config.fetchImpl),
        verifySite(config.aliasUrl, expected, config.fetchImpl)
      ]);
      report.attempts.push({ number: index + 1, checked_at: new Date().toISOString(),
        passed: production.passed && alias.passed, production, alias });
      if (production.passed && alias.passed) {
        report.status = 'passed';
        report.verified_at = new Date().toISOString();
        break;
      }
      if (index + 1 < attempts) await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    // Generated Vercel URLs may require SSO. This is an explicit unavailable
    // check; an accessible but mismatched unique deployment fails the release.
    if (!config.deploymentUrl) {
      report.unique_deployment = { status: 'not_evaluated',
        reason: 'no unique deployment URL supplied; public-origin results are recorded separately' };
    } else {
      const probe = await (config.fetchImpl || fetch)(new URL('/', config.deploymentUrl), {
        redirect: 'manual', headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(10000)
      });
      const redirect = probe.headers.get('location') || '';
      let vercelSso = false;
      try {
        const target = new URL(redirect);
        vercelSso = target.protocol === 'https:' && target.hostname === 'vercel.com'
          && ['/sso-api', '/login'].includes(target.pathname);
      } catch {
        vercelSso = false;
      }
      if ([302, 303, 307, 308].includes(probe.status) && vercelSso) {
        report.unique_deployment = { status: 'not_evaluated',
          reason: 'unique Vercel deployment requires SSO; public-origin results are recorded separately' };
      } else if (probe.status === 200) {
        const unique = await verifySite(config.deploymentUrl, expected, config.fetchImpl);
        report.unique_deployment = { status: unique.passed ? 'passed' : 'failed',
          checks: unique.checks };
        if (!unique.passed) report.status = 'failed';
      } else {
        report.unique_deployment = { status: 'failed', http_status: probe.status };
        report.status = 'failed';
      }
    }
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    if (report.unique_deployment.status === 'not_evaluated' && config.deploymentUrl) {
      report.unique_deployment = { status: 'failed', error: error.message };
    }
  } finally {
    writeFileSync(config.reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const report = await runHealthCheck({
    expectedSha: process.env.EXPECTED_SHA,
    productionUrl: process.env.PRODUCTION_URL,
    aliasUrl: process.env.ALIAS_URL,
    deploymentUrl: process.env.DEPLOYMENT_URL,
    reportPath: process.env.REPORT_PATH || 'production-smoke.json'
  });
  console.log(JSON.stringify({ status: report.status, expected_sha: report.expected_sha,
    attempts: report.attempts.length, error: report.error || null }));
  if (report.status !== 'passed') process.exitCode = 1;
}
