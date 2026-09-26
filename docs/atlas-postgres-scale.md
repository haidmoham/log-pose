# Atlas Postgres scale verification

These local measurements use deterministic synthetic inventory rows. They test the Postgres gold representation and async Node handler. They do not measure Railway, network latency, browser rendering, real market coverage, or relationship truth.

Generator `atlas-scale-v2` keeps the prior S1 and S2 shapes while emitting the complete current snapshot manifest. The unchanged production validator checks each SQLite checksum, logical build ID, foreign keys, counts, FTS alignment, placement totals, and retained occurrence rows. Old v1 fixtures and receipts remain unchanged.

## S1 result

S1 contains 10,000 candidates, 1,000,000 memberships, 32 revisions, 2,048 placements, and a 10,000-member dense placement. Building the 687,386,624-byte SQLite fixture took 15.62 seconds. Importing and validating it in PostgreSQL 18.6 took 43.46 seconds. `pg_database_size` was 1,186,617,023 bytes after import.

The read harness issued 70 measured requests per workload: 10 at concurrency 1, 20 at concurrency 5, and 40 at concurrency 20. One separate first request measured cold behavior. This stayed below the 100-request workload limit.

| Workload | Concurrency | Result | p50 | p95 |
| --- | ---: | --- | ---: | ---: |
| focus k=20/60/100 | 1 | 30/30 explicit 422 | 771–772 ms | 850–917 ms |
| focus k=20/60/100 | 5 | 60/60 explicit 422 | 787–788 ms | 817 ms |
| focus k=20/60/100 | 20 | 120/120 explicit 422 | 807–810 ms | 830–832 ms |
| search | 1 | 10/10 200 | 9.85 ms | 26.85 ms |
| search | 5 | 16 200, 4 422 | 24.84 ms | 785.17 ms |
| search | 20 | 8 200, 32 422 | 806.63 ms | 830.08 ms |
| explain | 1 | 10/10 200 | 33.64 ms | 65.37 ms |
| explain | 5 | 16 200, 4 422 | 58.61 ms | 785.59 ms |
| explain | 20 | 8 200, 32 422 | 807.05 ms | 830.09 ms |

All focus variants exceeded the 750 ms SQL statement bound before returning a ranked page. The failure is explicit and does not silently truncate exact eligibility. Increasing `top_k` did not cause the failure; each variant needs the same exact support aggregation. Under contention, search and explain also reached the shared per-request bound. This local result blocks a claim that the current Postgres representation supports S1 interactive focus within its declared budget.

The first Postgres k=100 focus returned 422 in 788.88 ms. A separate first SQLite request against the same v2 S1 fixture included the new 687 MB SHA-256 validation and returned 200 in 782.36 ms. The SQLite observation explains cold hash cost only; it is not a hosted cold-start measurement.

## S2 boundary

S2 generation completed in 115.39 seconds and produced a validated 3,432,722,432-byte SQLite fixture with 50,000 candidates and 5,000,000 memberships. PostgreSQL publication did not complete within the cumulative 30-minute tier budget.

The first import exposed an avoidable exact reconciliation plan: grouping by placement ID and stored member count caused an incremental sort across the joined membership rows. The client was interrupted, but its backend remained active until explicitly terminated. The exact validator now pre-aggregates membership counts by indexed placement ID and joins the small placement table. S1 validation took 2.17 seconds after that change. No check was removed.

The retry included 227 seconds waiting on the stale transaction, then completed COPY and entered the optimized reconciliation. The cumulative S2 build and import attempts reached 30 minutes, so the owned backend was terminated. PostgreSQL rolled back S2, retained S1 as the current pointer, and retained no S2 snapshot row. No S2 read matrix was run. Peak combined storage was 19,725,950,925 bytes, below the 20 GiB ceiling.

The S2 result is incomplete due to the declared time budget. It does not show that the optimized import itself needs 30 minutes, because the cumulative receipt includes the earlier plan and retry lock wait. A future run needs a fresh authorized budget and clean cluster to measure that path.

Raw receipts:

- `docs/research/issue11/postgres-scale-s1.json`
- `docs/research/issue11/postgres-scale-s2-incomplete.json`
- `docs/research/issue11/postgres-scale-sqlite-cold-s1.json`
