#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');
const { createPostgresHandler } = require('../api/atlas-postgres.js');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function definitions(manifest, tier) {
  const build_id = manifest.build_id;
  const focus = topK => ({ mode: 'focus', build_id, candidate: 'candidate-000000',
    limit: String(topK), top_k: String(topK) });
  return {
    focus_top_k_20: focus(20),
    focus_top_k_60: focus(60),
    focus_top_k_100: focus(100),
    focus_dense_accumulated: { ...focus(100), source: `synthetic-${tier}`,
      year: String(1990 + manifest.generator.revisions - 1), temporal_mode: 'accumulated' },
    search: { mode: 'search', build_id, query: 'Synthetic Candidate', limit: '60' },
    explain: { mode: 'explain', build_id, candidate: 'candidate-000000',
      neighbor: 'candidate-000001', limit: '10' }
  };
}

async function one(handle, name, fields) {
  const started = performance.now();
  const result = await handle(new URLSearchParams(fields));
  const elapsed = performance.now() - started;
  return { workload: name, elapsed_ms: elapsed, status: result.status,
    response_bytes: Buffer.byteLength(JSON.stringify(result.body)),
    membership_rows_read: result.body.work?.membership_rows_read ?? null,
    returned: result.body.returned ?? result.body.edges?.length ?? null,
    exact_eligible: result.body.count?.status === 'exact' ? result.body.count.value : null,
    suppressed: result.body.suppressed ?? null, error: result.body.error ?? null };
}

async function group(handle, workloads, concurrency, rounds) {
  const samples = [];
  const started = performance.now();
  for (let round = 0; round < rounds; round += 1) {
    const requests = [];
    for (let client = 0; client < concurrency; client += 1) {
      for (const [name, fields] of Object.entries(workloads)) requests.push(one(handle, name, fields));
    }
    samples.push(...await Promise.all(requests));
  }
  return { samples, wall_ms: performance.now() - started };
}

function summarize(samples, wallMs, concurrency) {
  const elapsed = samples.map(sample => sample.elapsed_ms);
  return { workload: samples[0].workload, concurrency, requests: samples.length, wall_ms: wallMs,
    p50_ms: percentile(elapsed, 0.5), p95_ms: percentile(elapsed, 0.95),
    max_ms: Math.max(...elapsed), raw_samples: samples,
    response_bytes: { min: Math.min(...samples.map(sample => sample.response_bytes)),
      max: Math.max(...samples.map(sample => sample.response_bytes)) },
    membership_rows_read: { min: Math.min(...samples.map(sample => sample.membership_rows_read ?? 0)),
      max: Math.max(...samples.map(sample => sample.membership_rows_read ?? 0)) },
    statuses: Object.fromEntries([...new Set(samples.map(sample => sample.status))]
      .map(status => [status, samples.filter(sample => sample.status === status).length])),
    returned: [...new Set(samples.map(sample => sample.returned))],
    exact_eligible: [...new Set(samples.map(sample => sample.exact_eligible))],
    suppressed: [...new Set(samples.map(sample => sample.suppressed))],
    errors: [...new Set(samples.map(sample => sample.error).filter(Boolean))] };
}

async function main() {
  const databaseUrl = process.env.LOG_POSE_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('LOG_POSE_TEST_DATABASE_URL is required');
  const tier = argument('--tier');
  const fixtureRoot = path.resolve(argument('--fixture-root'));
  const receiptPath = path.resolve(argument('--receipt'));
  const importReceipt = JSON.parse(fs.readFileSync(argument('--import-receipt'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'current.json'), 'utf8'));
  const workloads = definitions(manifest, tier);
  const pool = new Pool({ connectionString: databaseUrl, max: 20,
    connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 });
  const handle = createPostgresHandler(pool);
  const receipt = { receipt_schema: 'atlas-postgres-scale-v1', synthetic: true, tier,
    build_id: manifest.build_id, generator: manifest.generator,
    environment: { node: process.version, platform: process.platform, arch: process.arch,
      cpus: os.cpus().length, memory_bytes: os.totalmem(), postgres: null },
    scope: 'local PostgreSQL representation; no hosted-provider or Railway latency measured',
    ranking_semantic: 'distinct supporting placement count descending, then ASCII candidate ID',
    request_budget: { maximum_per_workload: 100, measured_per_workload: 70,
      cold_additional_focus_top_k_100: 1, maximum_actual_per_workload: 71 },
    import: importReceipt, cold_first_request: null, results: [], query_plans: {} };
  try {
    const metadata = await pool.query(`SELECT version() AS postgres,
      pg_database_size(current_database())::bigint AS database_bytes`);
    receipt.environment.postgres = metadata.rows[0].postgres;
    receipt.database_bytes = Number(metadata.rows[0].database_bytes);
    const sizes = await pool.query(`SELECT relname,pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND relname LIKE 'atlas_%' ORDER BY relname`);
    receipt.relation_bytes = Object.fromEntries(sizes.rows.map(row => [row.relname, Number(row.bytes)]));

    receipt.cold_first_request = await one(handle, 'focus_top_k_100', workloads.focus_top_k_100);
    for (const { concurrency, rounds } of [{ concurrency: 1, rounds: 10 },
      { concurrency: 5, rounds: 4 }, { concurrency: 20, rounds: 2 }]) {
      const measured = await group(handle, workloads, concurrency, rounds);
      for (const name of Object.keys(workloads)) {
        receipt.results.push(summarize(measured.samples.filter(sample => sample.workload === name),
          measured.wall_ms, concurrency));
      }
    }
    const plans = await pool.query(`EXPLAIN (FORMAT JSON) SELECT member.candidate_id,count(*)
      FROM public.atlas_membership focus_membership
      JOIN public.atlas_placement placement ON placement.build_id=focus_membership.build_id
        AND placement.id=focus_membership.placement_id
      JOIN public.atlas_membership member ON member.build_id=placement.build_id
        AND member.placement_id=placement.id AND member.candidate_id<>focus_membership.candidate_id
      WHERE focus_membership.build_id=$1 AND focus_membership.candidate_id='candidate-000000'
      GROUP BY member.candidate_id ORDER BY count(*) DESC,member.candidate_id COLLATE "C" LIMIT 100`,
    [manifest.build_id]);
    receipt.query_plans.focus_top_k_100 = plans.rows[0]['QUERY PLAN'];
  } finally {
    await handle.close();
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ tier, build_id: manifest.build_id,
    database_bytes: receipt.database_bytes, results: receipt.results.length })}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
