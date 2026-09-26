# Atlas Postgres scale verification

These local measurements use deterministic synthetic inventory rows. They test the Postgres gold representation and async Node handler. They do not measure Railway, network latency, browser rendering, real market coverage, or relationship truth.

The 687 MB S1 SQLite snapshot cannot fit the 250 MB Vercel function bundle limit. The external Postgres representation addresses that storage blocker, but these local measurements do not prove hosted connectivity or latency.

Generator `atlas-scale-v2` keeps the prior S1 and S2 shapes while emitting the complete current snapshot manifest. The unchanged production validator checks each SQLite checksum, logical build ID, foreign keys, counts, FTS alignment, placement totals, and retained occurrence rows. Old v1 fixtures and receipts remain unchanged.

## S1 result

S1 contains 10,000 candidates, 1,000,000 memberships, 32 revisions, 2,048 placements, and a 10,000-member dense placement. Building the 687,386,624-byte SQLite fixture took 15.62 seconds. Importing and validating it in PostgreSQL 18.6 took 43.46 seconds. `pg_database_size` was 1,186,617,023 bytes after import.

The original read harness issued 70 measured requests per workload, but it launched all six workloads together. Its concurrency labels therefore meant 6, 30, and 120 mixed-workload requests in flight, with a pool maximum of 20. The table below retains those failed results with corrected labels. One separate first request preceded them. Each workload stayed below the 100-request limit.

| Workload | Actual mixed concurrency | Result | p50 | p95 |
| --- | ---: | --- | ---: | ---: |
| focus k=20/60/100 | 6 | 30/30 explicit 422 | 771–772 ms | 850–917 ms |
| focus k=20/60/100 | 30 | 60/60 explicit 422 | 787–788 ms | 817 ms |
| focus k=20/60/100 | 120 | 120/120 explicit 422 | 807–810 ms | 830–832 ms |
| search | 6 | 10/10 200 | 9.85 ms | 26.85 ms |
| search | 30 | 16 200, 4 422 | 24.84 ms | 785.17 ms |
| search | 120 | 8 200, 32 422 | 806.63 ms | 830.08 ms |
| explain | 6 | 10/10 200 | 33.64 ms | 65.37 ms |
| explain | 30 | 16 200, 4 422 | 58.61 ms | 785.59 ms |
| explain | 120 | 8 200, 32 422 | 807.05 ms | 830.09 ms |

All focus variants exceeded the 750 ms SQL statement bound before returning a ranked page. The failure is explicit and does not silently truncate exact eligibility. Increasing `top_k` did not cause the failure; each variant needs the same exact support aggregation. Under contention, search and explain also reached the shared per-request bound. This local result blocks a claim that the current Postgres representation supports S1 interactive focus within its declared budget.

The first Postgres k=100 focus returned 422 in 788.88 ms. A separate first SQLite request against the same v2 S1 fixture included the new 687 MB SHA-256 validation and returned 200 in 782.36 ms. The SQLite observation explains cold hash cost only; it is not a hosted cold-start measurement.

## S1 publication-ready rerun

A fresh import committed the build as unready, ran `VACUUM (ANALYZE)`, reconciled it again, and only then marked it ready and moved the current pointer. The full import and preparation took 44.16 seconds. The database occupied 1,187,387,071 bytes. The corrected harness ran one workload at a time with a four-connection pool and true batches of 1, 5, and 20 clients.

| Workload | Clients | Result | p50 | p95 |
| --- | ---: | --- | ---: | ---: |
| focus k=20/60/100 | 1 | 30/30 200 | 34.8–35.0 ms | 36.0–47.2 ms |
| focus k=20/60/100 | 5 | 60/60 200 | 35.6–39.1 ms | 70.5–78.0 ms |
| focus k=20/60/100 | 20 | 120/120 200 | 104.4–108.8 ms | 172.8–186.9 ms |
| dense accumulated k=100 | 1 / 5 / 20 | 70/70 200 | 35.3 / 38.1 / 111.3 ms | 40.4 / 75.2 / 182.5 ms |
| search | 1 / 5 / 20 | 70/70 200 | 6.7 / 8.1 / 23.1 ms | 8.8 / 14.6 / 37.3 ms |
| explain | 1 / 5 / 20 | 70/70 200 | 2.6 / 3.6 / 8.4 ms | 3.4 / 5.4 / 13.8 ms |

The first published k=100 request returned 200 in 52.98 ms with 100 of 9,999 exact eligible neighbors. Import validation and maintenance had already read data, so this is the first handler request, not an OS-cold measurement. The prior and new S1 receipts contain 421 requests each, 842 total, while every workload in each frozen run stayed within its 100-request bound. These local results remove the earlier S1 query-time blocker under the corrected load model. They do not establish Railway latency or browser and deployment readiness.

## S2 boundary

S2 generation completed in 115.39 seconds and produced a validated 3,432,722,432-byte SQLite fixture with 50,000 candidates and 5,000,000 memberships. PostgreSQL publication did not complete within the cumulative 30-minute tier budget.

The first import exposed an avoidable exact reconciliation plan: grouping by placement ID and stored member count caused an incremental sort across the joined membership rows. The client was interrupted, but its backend remained active until explicitly terminated. The exact validator now pre-aggregates membership counts by indexed placement ID and joins the small placement table. S1 validation took 2.17 seconds after that change. No check was removed.

The retry included 227 seconds waiting on the stale transaction, then completed COPY and entered the optimized reconciliation. The cumulative S2 build and import attempts reached 30 minutes, so the owned backend was terminated. PostgreSQL rolled back S2, retained S1 as the current pointer, and retained no S2 snapshot row. No S2 read matrix was run. Peak combined storage was 19,725,950,925 bytes, below the 20 GiB ceiling.

The S2 result is incomplete due to the declared time budget. It does not show that the optimized import itself needs 30 minutes, because the cumulative receipt includes the earlier plan and retry lock wait. A future run needs a fresh authorized budget and clean cluster to measure that path.

Raw receipts:

- `docs/research/issue11/postgres-scale-s1.json`
- `docs/research/issue11/postgres-scale-s1-publication-ready.json`
- `docs/research/issue11/postgres-scale-s2-incomplete.json`
- `docs/research/issue11/postgres-scale-sqlite-cold-s1.json`
