#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function percentile(values, proportion) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * proportion) - 1)];
}

function workloads(manifest) {
  const source = `synthetic-${argument('--tier')}`;
  const lastYear = String(1990 + manifest.generator.revisions - 1);
  const build = manifest.build_id;
  const focus = topK => ({ mode: 'focus', build_id: build, candidate: 'candidate-000000',
    limit: String(Math.min(topK, 100)), top_k: String(topK) });
  return {
    focus_top_k_20: focus(20),
    focus_top_k_60: focus(60),
    focus_top_k_100: focus(100),
    focus_dense_accumulated: { ...focus(100), source, year: lastYear, temporal_mode: 'accumulated' },
    explain: { mode: 'explain', build_id: build, candidate: 'candidate-000000',
      neighbor: 'candidate-000001', limit: '10' },
    search: { mode: 'search', build_id: build, query: 'Synthetic Candidate', limit: '60' }
  };
}

async function worker() {
  const root = argument('--root');
  const handlerPath = argument('--handler');
  const repeats = Number(argument('--repeats'));
  const selected = JSON.parse(Buffer.from(argument('--workloads'), 'base64url').toString('utf8'));
  const { createAtlasHandler } = require(handlerPath);
  const handle = createAtlasHandler(root);
  const samples = [];
  try {
    for (let pass = 0; pass < repeats; pass += 1) {
      for (const [name, parameters] of Object.entries(selected)) {
        const started = performance.now();
        const result = handle(new URLSearchParams(parameters));
        const elapsed = performance.now() - started;
        const bodyBytes = Buffer.byteLength(JSON.stringify(result.body));
        samples.push({ name, elapsed_ms: elapsed, status: result.status, response_bytes: bodyBytes,
          membership_rows_read: result.body.work?.membership_rows_read ?? null,
          returned: result.body.returned ?? result.body.edges?.length ?? null,
          exact_eligible: result.body.count?.status === 'exact' ? result.body.count.value : null,
          suppressed: result.body.suppressed ?? null,
          error: result.body.error ?? null });
      }
    }
  } finally {
    handle.close();
  }
  if (process.send) process.send({ samples });
}

function runGroup(concurrency, repeats, encoded, options) {
  return new Promise((resolve, reject) => {
    const samples = [];
    let remaining = concurrency;
    for (let index = 0; index < concurrency; index += 1) {
      const child = fork(__filename, ['--worker', '--root', options.root, '--handler', options.handler,
        '--tier', options.tier, '--repeats', String(repeats), '--workloads', encoded],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let errors = '';
      child.stderr.on('data', chunk => { errors += chunk; });
      child.on('message', message => samples.push(...message.samples));
      child.on('error', reject);
      child.on('exit', code => {
        if (code !== 0) return reject(new Error(`benchmark worker exited ${code}: ${errors}`));
        remaining -= 1;
        if (!remaining) resolve(samples);
      });
    }
  });
}

async function main() {
  if (process.argv.includes('--worker')) return worker();
  const options = { root: argument('--root'), handler: path.resolve(argument('--handler')),
    tier: argument('--tier') };
  const receiptPath = argument('--receipt');
  const manifest = JSON.parse(fs.readFileSync(path.join(options.root, 'current.json'), 'utf8'));
  const definitions = workloads(manifest);
  const encoded = Buffer.from(JSON.stringify(definitions)).toString('base64url');
  const groups = [{ concurrency: 1, repeats: 25 }, { concurrency: 5, repeats: 10 },
    { concurrency: 20, repeats: 5 }];
  const receipt = { receipt_schema: 'atlas-scale-reads-v1', synthetic: true,
    tier: options.tier, build_id: manifest.build_id,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    ranking_semantic: 'distinct supporting placement count descending, then candidate ID',
    request_budget: { maximum_per_workload: 200, actual_per_workload: 175 }, results: [] };
  for (const group of groups) {
    const wallStarted = performance.now();
    const samples = await runGroup(group.concurrency, group.repeats, encoded, options);
    const wallMs = performance.now() - wallStarted;
    for (const name of Object.keys(definitions)) {
      const selected = samples.filter(sample => sample.name === name);
      const elapsed = selected.map(sample => sample.elapsed_ms);
      receipt.results.push({ workload: name, concurrency: group.concurrency,
        requests: selected.length, wall_ms: wallMs, p50_ms: percentile(elapsed, 0.5),
        p95_ms: percentile(elapsed, 0.95), max_ms: Math.max(...elapsed),
        response_bytes: { min: Math.min(...selected.map(item => item.response_bytes)),
          max: Math.max(...selected.map(item => item.response_bytes)) },
        membership_rows_read: { min: Math.min(...selected.map(item => item.membership_rows_read ?? 0)),
          max: Math.max(...selected.map(item => item.membership_rows_read ?? 0)) },
        statuses: Object.fromEntries([...new Set(selected.map(item => item.status))]
          .map(status => [status, selected.filter(item => item.status === status).length])),
        returned: [...new Set(selected.map(item => item.returned))],
        exact_eligible: [...new Set(selected.map(item => item.exact_eligible))],
        suppressed: [...new Set(selected.map(item => item.suppressed))],
        errors: [...new Set(selected.map(item => item.error).filter(Boolean))] });
    }
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ tier: options.tier, results: receipt.results.length })}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
