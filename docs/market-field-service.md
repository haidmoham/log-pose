# market-field read service

the market field uses one reproducible graph and one read-only endpoint on the existing Vercel project. no additional database, account, or paid service is required by this design. ingestion, source retention, identity review, and accepted claims keep their existing explicit write paths.

## boundary and evidence

the build reads the retained topology projection. each edge is one unordered candidate pair with at least one exact `(source, year, source_category)` key. the graph stores placement-key indices and indexed adjacency. the browser receives candidate summaries, filtered counts and group flows, then a selected neighborhood. it fetches source rows only for an inspector selection.

the pinned input contains 1,240 eligible candidates and 47,288 complete graph pairs. the 100 sampled review pairs are a separate worklist. these are verified input properties, not fixed values in the query implementation. an edge remains an unreviewed inventory co-listing. it is not a company identity, competition claim, accepted relationship, or traction measure.

the graph build ID hashes the deterministic projection, including input fingerprints. the source inventory year and retained artifact commit time keep their original meanings; deployment time does not become source time. detail responses retain both candidates' source-row IDs, exact placement keys, and artifact hashes. source bytes and evidence identifiers are not rewritten.

## reads and versioning

`GET /api/market-field` accepts these operations:

| mode | result |
| --- | --- |
| `summary` | current build ID, total counts, facets, and candidate summaries for deterministic field placement |
| `query` | matching candidate IDs, a candidate page, aggregate pair and placement counts, group flows, and an optional focus neighborhood |
| `detail` | selected candidate source placements and optional neighbor comparison with both retained source rows |

`query` and `detail` require the summary's `build_id`. a mismatch returns `409 build_version_mismatch`. the client refreshes the summary before using another build. request generations prevent late responses from overwriting newer selections.

query parameters preserve the URL's source, year, exact category, research tag, identity status, and text search. `candidate` selects a focus and `neighbor` selects an inspected overlap. candidate pages use `offset` and `limit` with a maximum of 100 rows. neighborhood pages use `neighbor_offset` and `neighbor_limit` with a maximum of 500 rows. next-offset fields distinguish a complete result from another available page. candidates sort by name then stable ID; neighbors sort by shared-key count, name, then ID.

the field is explicitly bounded at build time to 5,000 candidates and 250,000 pairs. exceeding either bound fails the build; it does not publish a silently truncated field. increasing those bounds requires new response-size and performance evidence or a different rendering/query contract.

## temporal inventory frames

`GET /api/market-field?mode=timeline` returns the 14 retained provider/year artifacts, their pinned commit timestamps and hashes, and coverage labels. The timeline uses `inventory_year` at year precision; `commit_at` is shown as source-revision metadata, not as the active clock. The UI includes only retained stops. A request for a year without an artifact returns `missing_snapshot` and does not treat the gap as an exit.

`mode=frame` requires `build_id`, `source` (`cncf` or `lfai`), `year`, and may include `temporal_mode` (`snapshot` or `accumulated`), `compare_year`, `category`, `query`, `candidate`, `neighbor`, `offset`, and `limit`. Snapshot mode joins exact `(source, year, source_category)` placements in one artifact. Its default comparison is the previous retained artifact from the same provider. Accumulated mode unions exact placements observed at or before the selected inventory-year stop; the UI calls these “previously observed” and does not infer validity or persistence today. Category filtering remains exact, and search is a candidate lookup rather than a hidden change to a focused neighborhood.

Candidate frames are bounded to 60 neighbors by default and 100 maximum; `offset` and `next_offset` page larger neighborhoods. The no-focus overview returns eligible candidate summaries and at most 2,500 exact peer connections, with total and truncation counts. Both graph and evidence views use stable positions from the current pinned build. Frame IDs include the build, query version, source, year, comparison, mode, filters, focus, and page so a deep link addresses a reproducible request.

Selected edges resolve to both retained rows, occurrence IDs, exact placement keys, pinned artifact URL/hash, and a comparison explanation. Candidate names and identity keys are unreviewed leads. Reviewed-claim overlays are intentionally unsupported in this historical view because those claims do not have a compatible historical knowledge clock; the separate reviewed-claims view remains available on its own evidence and review filters. Requests for event, validity, ingestion, or review clocks are rejected rather than approximated.

cache keys consist of the endpoint, operation, all filter/focus/page parameters, and build ID. summary responses have a short shared cache lifetime because they discover the current version. versioned reads have a longer shared cache lifetime; errors are not cached. a deployment publishes the graph and detail projection together. old versioned requests cannot silently read a new graph.

## local operation and rebuild

`npm run dashboard` serves the saved console and the same Node read handler used by Vercel. `npm run dev` retains the Python preview and its optional database reads while exposing the market-field handler. a plain static HTTP server cannot provide the new market-field endpoint.

the graph rebuild runs from retained inputs without network acquisition. run `npm run build:market-field` (Python 3.11 or later) and the retained-data rebuild procedure in [data-contract.md](data-contract.md). complete the rebuild before restarting a local server: Node caches its loaded graph for the process lifetime. commit the graph and matching source projection together.

## deployment and costs

`vercel.json` routes `/api/market-field` to the Node function before the static catch-all. the function bundles the graph and retained source projection through literal imports. static assets continue to come from `web/`. this keeps one source repository, one host project, and one publication path.

the implementation has no credential or database requirement for public reads. function invocations, active CPU, memory, and transfer consume the host plan's allowance. free operation depends on traffic and account eligibility; it is not an unlimited-service promise. check current usage before raising limits. Vercel documents a 4.5 MB function response limit and a 250 MB normal uncompressed Node bundle limit. our bounded responses should remain well below these host limits. [Vercel function limits](https://vercel.com/docs/functions/limitations)

production publication is a reviewed push to `main`. no domain change is needed. after publication, verify the matching deployment, API build ID and counts, `?view=topology` and a candidate/neighbor deep link, exact source inspection, served HTML and `dashboard.json`. a successful local test or Git push alone is not production evidence.

if the read service is unavailable, the field shows an error with retry. it does not fall back to downloading and constructing the complete pair universe. the other retained static views remain available. graph/build mismatches fail visibly instead of mixing versions.

## performance evidence

`scripts/benchmark_market_field.mjs` records three cold-browser-cache trials for a 1440×1000 desktop profile and a 390×844 profile with 4× CPU throttling, 80 ms request latency, and 1 MB/s transfer. the second profile is constrained-device emulation, not a physical phone test. the local server does not compress responses. these measurements do not estimate Vercel CDN latency or cold starts.

the baseline at `3c5390e` is retained in [issue4/baseline-performance.json](research/issue4/baseline-performance.json). median browser graph preparation was 43.4 ms on desktop and 259.2 ms under throttling. the graph input transferred 4,542,298 bytes including browser-reported HTTP overhead. all initial page resources transferred 10,907,104 bytes; other research catalog traffic is outside this issue's graph migration.

the baseline defines the following practical checks: zero browser `prepare`/full-pair scan calls, initial field reads below 1 MB decoded, no client source-row transfer before selection, and filter/focus completion within 1 s on desktop or 2 s under the defined throttling. pass `--enforce` to the benchmark to check the byte, graph-call, browser-error, and latency budgets. filter and focus measurements include request latency and rendering, so they must be reported separately from removed graph work. the benchmark polls at 100 ms; small timings include observation delay.


the local Vercel build passed with CLI 60.0.1. its emitted function uses `nodejs24.x` and includes both the 2 MB graph and the 4.54 MB retained detail projection. executing that bundled handler returned the pinned counts. this verifies local packaging, not production availability.

final local results on Apple M3 / macOS 26.5.2, using the installed Chrome for Testing build (three-run medians):

| measurement | desktop before → after | constrained emulation before → after |
| --- | --- | --- |
| field data, decoded bytes | 4,541,998 → 240,132 | 4,541,998 → 240,132 |
| all initial resources, transferred bytes | 10,907,104 → 6,639,937 | 10,907,104 → 6,639,937 |
| browser graph construction | 43.4 → 0 ms | 259.2 → 0 ms |
| page ready | 467.9 → 168.5 ms | 12,632.9 → 7,292.7 ms |
| year filter completion | 76.0 → 40.7 ms | 275.6 → 166.4 ms |
| focus with source detail | 78.6 → 41.5 ms | 151.8 → 266.4 ms |

field data fell 94.7%. constrained focus added about 115 ms because source detail now requires a read request. that cost is visible and within the 2 s budget. no browser errors or graph preparation/pair/neighbor scan calls occurred. the after-run includes the independently landed research-set route, so all-page byte and time comparisons include that small change; the field-specific byte comparison isolates this migration. local HTTP is uncompressed and same-host; deployment cold starts and real mobile hardware remain separate checks.

raw after measurements: [issue4/after-performance.json](research/issue4/after-performance.json). reproduce against an isolated test browser with remote debugging enabled:

```sh
PORT=8080 npm run dashboard
# Use the loopback debug port reported by the authorized test browser.
node scripts/benchmark_market_field.mjs http://127.0.0.1:9222 http://127.0.0.1:8080 /tmp/market-field-performance.json --enforce
```

final verification: 58 dashboard/API/route tests passed; 95 Python tests passed with 13 database-dependent tests skipped because no disposable test database was supplied. rebuilding the graph produced no diff. its content-bound build ID is `0c15e1ce1a92738173af8d94f7f89a2175d5c267f93e87f35a2b3ec01756d338`. a source inspector check opened retained row `2a3de0564d73c91e7760` with CNCF 2024 category and full artifact hash. production publication and smoke checks have not been performed.

`scripts/capture_market_field_demo.sh` records the real overview, focus, and shared-placement inspector through an isolated browser session, then encodes a 10-second silent H.264 clip with FFmpeg. generated footage stays outside Git in `~/desktop/demos`; the capture script retains its raw intermediate outside the repository. no microphone audio or posting is part of that command.

deployed preview verification for code commit `2b523e1`: Vercel deployment `dpl_2wwZ7QeCfXdf1MPvHHPNsAdG7bcE` reached Ready at `https://log-pose-8hsadv5fw-zarnab.vercel.app`. authenticated `vercel curl` reads returned the expected graph build and 1,240/47,288/100 counts. Kueue's query returned three neighbors; Kueue/Kuberay detail returned two exact placements with both source rows and artifact hashes. the candidate/neighbor deep-link HTML matches the committed file plus Vercel's injected preview toolbar. preview protection remains enabled. production smoke verification is still pending.
