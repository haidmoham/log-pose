# Atlas backend scale measurements

These local measurements use synthetic inventory memberships. They test the
SQLite read derivative and Node query path. They do not establish real market
coverage, relationship truth, browser rendering capacity, deployment support,
or completion of S1/S2 product and research criteria.

## Fixture contract

Generator `atlas-scale-v1` creates deterministic candidates, immutable source
revisions, exact artifact/category placements, and one retained synthetic row
per membership. Every record is labeled synthetic. S1 uses seed 1101, 10,000
candidates, 1,000,000 memberships, 32 revisions, and 64 category labels. S2
uses seed 1102, 50,000 candidates, 5,000,000 memberships, 64 revisions, and 128
category labels. Each candidate has 100 unique memberships. In both tiers,
10,000 candidates share one dense placement.

The writer streams rows directly into the serving schema. It checks SQLite
integrity, foreign keys, distinct candidate/placement keys, membership totals,
and placement member counts. This path avoids constructing five million Python
objects and therefore does not measure the canonical exporter's memory limit.
It also does not implement incremental derivation.

The machine was WSL2 Linux 6.18 on an AMD Ryzen 7 5800X with 16 logical CPUs
and 16 GiB visible RAM. Python was 3.13.14 for the recorded fixture builds,
SQLite was 3.53.1, and Node was 22.23.1. Each tier stayed below the local limits
of 8 GiB RAM, 20 GiB disk, and 30 minutes.

## Build measurements

| Tier | Wall time | Peak RSS | SQLite bytes | Membership table | Reverse index |
| --- | ---: | ---: | ---: | ---: | ---: |
| S1 | 16.52 s | 300,531,712 | 687,386,624 | 579,874,816 | 101,359,616 |
| S2 | 112.91 s | 301,998,080 | 3,432,722,432 | 2,898,796,544 | 504,143,872 |

The membership table and its reverse index account for about 99% of each
database. Storage grew approximately linearly from S1 to S2. Query plans use
the membership primary key for candidate-to-placement reads and the covering
`membership_placement_candidate` index for placement-to-candidate reads. FTS5
uses its virtual-table match plan.

## Read measurements

The harness used separate bounded Node worker processes as clients. It issued
175 requests per workload: 25 at concurrency 1, 50 at concurrency 5, and 100 at
concurrency 20. This is below the 200-request workload budget. Each worker used
the production `createAtlasHandler` against the immutable local fixture.

At concurrency 1, S1 top-k focus p95 was 92.07 ms for k=20, 91.22 ms for k=60,
and 117.76 ms for k=100. S2 p95 was 58.31 ms, 72.96 ms, and 83.97 ms. At
concurrency 20, S1 p95 was 370.78 ms, 337.12 ms, and 432.36 ms; S2 p95 was
356.08 ms, 353.89 ms, and 415.56 ms. Explain p95 stayed below 8 ms and search
p95 stayed below 137 ms across both tiers and all tested concurrency levels.

Top-k ranking is exact distinct supporting-placement count descending, then
candidate ID. S1 had 9,999 exact eligible neighbors and S2 had 10,967. Returned
pages were bounded at 20, 60, and 100. The k=100 responses were about 669 KiB
for S1 and 674 KiB for S2, below the 1 MiB decoded response cap. Focus still
read 60,025–68,025 membership rows at S1 and 72,513–80,513 at S2. Top-k bounds
the result and sorting set; it does not remove the exact support scan.

One of 100 S1 k=100 requests at concurrency 20 hit the 750 ms query work budget
and returned an explicit 422 error. All S1 dense accumulated requests and all
S2 requests completed within their work budgets in this run. The failure is a
contention observation, not a deterministic capacity threshold.

## Practical boundary

S2 did not exhaust the authorized local build or read budgets. The next visible
bottlenecks are bundled snapshot size, linear membership/index storage, exact
focus scan fan-out, and response size near the 1 MiB cap. The 3.43 GB S2 file is
not evidence that it is suitable for Vercel bundling or cold starts. A larger
local fixture would add little decision value before deployment packaging,
cold-open behavior, incremental snapshot equivalence, and browser rendering
are measured.

Raw receipts:

- `docs/research/issue11/scale-s1-build.json`
- `docs/research/issue11/scale-s1-reads.json`
- `docs/research/issue11/scale-s2-build.json`
- `docs/research/issue11/scale-s2-reads.json`
