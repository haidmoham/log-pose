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
