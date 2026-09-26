# architecture and extension map

Log Pose opens a bounded atlas at `/` and keeps the full research desk at
`/index.html`. Both read retained exports. `/atlas.html` remains an atlas URL.
Legacy `/?view=...` links still open the research desk: the local Node and
Python servers dispatch them directly, and the static atlas document redirects
them to `/index.html` with the query and fragment intact.

- `npm run dashboard` serves the atlas at `/` and the read-only research desk at `/index.html` from saved JSON exports and bounded read handlers. The atlas initially focuses a pinned Datadog/CNCF 2024 example with a bounded neighbor page; explicit source or year links keep their own frame. Source regions, search, exact co-listing premises, and reviewed claims remain available through their separate selections. `web/index.html` loads `research-model.js` for validation, deterministic layouts and URL state; `console-ui.js` for DOM and chart primitives; `data-view.js` for full cross-source search and retained-record inspection; `explore-view.js` for source audits; `discovery-topology-view.js` for the full retained field; `temporal-graph.js` and `temporal-topology-view.js` for the server-backed temporal atlas; `topology-view.js` for standalone reviewed claims; and `app.js` for state and route composition. It does not require Postgres.
- `npm run dev` serves the same atlas, research desk, scripts, styles, and lazy data partitions. It does not migrate the database or fetch new evidence when opening the interface. An explicit `DATABASE_URL` enables the retained read-only `/api/companies` and `/api/overview` endpoints; the desk itself does not require Postgres. Static paths are confined to `web/`. `/api/market-field` uses the same precomputed graph query module as the production Node function, without a database connection.
- The temporal route reads a versioned pinned artifact timeline and requests one bounded source/year frame at a time. `api/market-field.js` owns frame eligibility, accumulation, exact overlap sets, and deltas. The browser owns selection, evidence inspection, and rendering. The precomputed candidate layout provides stable display addresses; it is not an evidence measure. The optional 3d view derives stable display depth from candidate IDs in `research-model.js` and projects it through the temporal renderer; depth is presentation only and does not change the retained graph.
- `temporal-graph.js` owns the accessible SVG, fixed hit targets, and bounded population entrance. New observed nodes spring around their fixed anchors; selecting an edge does not replay the population. The GPU attaches after the entrance settles and caches geometry between interaction updates. Its animation loop changes light only and stops when hidden, offscreen, disconnected, or switched off. Reduced motion sets the initial motion control to off; an explicit user choice can enable it. SVG remains the fallback. See [the visual pass and capture procedure](graph-visuals.md).
- `app.js` activates the temporal view only on the temporal atlas layer and disposes it on route exit. Disposal stops playback; pending responses can fill the view's cache but cannot paint another route. The URL model keeps an edge selection only with its focus candidate, and the search draft follows committed URL changes.
- Temporal control changes update the mounted view without replacing `#view` or the range input. While a requested frame loads, the last accepted graph and inspector remain together under their displayed source and year; a separate status names the requested stop. One accepted response replaces the complete evidence view. Only three accepted frames are cached for quick reversal; no adjacent frames are fetched in advance. Missing stops and errors remain explicit.

## data contracts

`web/atlas.html` is the bounded membership-first entry point, including at `/`. it loads only the
atlas model, view and shared DOM/graph primitives; it does not load the console
catalog or the legacy pair corpus. `/api/atlas` queries immutable gold snapshots
through `atlas-runtime.js`: bundled SQLite, indexed Postgres, or an HTTPS proxy
to the same Postgres reader. the Postgres evidence core remains canonical.
the Python preview delegates to the same Node handler. candidate positions are
stable, versioned display addresses. top-k ranks exact shared placements and
fetches retained rows only when an edge is inspected. the selected source,
revision, inventory-year clock and build govern every accepted frame.
`api/atlas-protocol.js` owns the shared error, hash, bounded parameter, cursor,
and stable-position primitives. inventory and reviewed providers retain their
own selector rules, cursor budgets, work limits, messages, and snapshot policy.

membership normalization lives in `atlas_membership.py`; immutable publication
and incremental database updates live in `atlas_snapshot.py`. the browser's
pure frame adaptation and byte cache live in `atlas-model.js`. `atlas-client.js`
owns query serialization, cache access, JSON transport, HTTP errors, and the
pinned-build response guard shared by both atlas layers. each view keeps its own
abort, retry, disposal, URL, accepted-frame, inspector, and rendering lifecycle.
`atlas-view.js` composes those controls using `console-ui.js` and `temporal-graph.js`.
see [the query contract](atlas-service.md), [record grains](atlas-membership.md),
[publication contract](atlas-snapshots.md), and [measured frontier](atlas-scale.md).

`layer=reviewed` loads `atlas-reviewed-view.js` only after layer selection. the
runtime routes it to `atlas-reviewed.js` and an independent bundled SQLite build,
including when an external inventory provider is configured. its builder reads
the accepted topology export and explicit reviewed identity links, verifies
retained source bodies, and publishes a gold derivative. it never writes reviews.
the browser uses the pure `reviewedGraphFrame` adapter and the shared renderer's
optional labels and fit scale. inventory defaults stay compatible. source
publication, current accepted review state, and inventory observation year are
separate contracts; switching layers starts a new document and query context.
focus groups claims by neighbor for bounded navigation; the inspector preserves
each predicate, direction, premise, source hash and review. a source cutoff never
asserts relationship activity or historical review replay. see
[reviewed atlas snapshots](atlas-reviewed.md).

`atlas_postgres.py` validates and streams an immutable snapshot into the additive
`014_atlas_postgres.sql` schema. migration `015` gates serving readiness: an
import commits as unpublished, runs explicit VACUUM/ANALYZE, then reconciles
again before marking ready and switching the current pointer atomically.
failed maintenance leaves a resumable build hidden from snapshot discovery.
`atlas-postgres.js` reads the six `gold.atlas_*` views in a read-only transaction.
the [Railway service](atlas-railway.md) is optional infrastructure for this
provider; the frontend remains on Vercel. `atlas_read.py` consumes the same
bounded contract for saved investigations. its Python adapter routes inventory
and reviewed reads through the existing runtime, validates their distinct
clock/mode/build bindings, and preserves the current accepted review lens.
`read_atlas_record` pins each request to its returned immutable build.
`export_layered_investigation` stores independent request/response records with
one build per layer; it does not invent a common clock or infer a relationship
from a cross-layer path. legacy inventory-only exports remain supported. see
[the research-read contract](atlas-research.md). experimental model attachments live
under `experiments/ml/atlas/` and never load during ordinary application startup.

The database remains the durable evidence store. Migration `007_warehouse_views.sql` adds read-only observation views. Migration `013_medallion_read_layers.sql` starts a medallion-inspired read path across **raw → bronze → silver → gold**. It exposes every domain table, including topology evidence, identity, candidates, reviews, and graph builds, through one named layer. The existing `public` tables remain the canonical write storage in this first step. The layer views do not copy or relabel records, change IDs, or move foreign keys. New consumers can use the layer paths while existing ingestion and exports continue to work. A later physical move must update all writers, SQL migrations, foreign keys, and test fixtures together; this migration does not claim that move has happened.

[The layer contract](medallion.md) lists every relation's grain, key, clocks, and provenance and defines the next migration boundary.

| layer | record grain and role | source time, arrival time, and provenance |
| --- | --- | --- |
| `raw` | one retained source payload or acquisition attempt: snapshots, SEC member/artifact, Cboe file, discovery artifact, topology source, and attempt/job | keep byte hashes, provider IDs, capture/publication times, retrieval/ingestion times, and failed attempts |
| `bronze` | one source-faithful parsed row: SEC candidate fact, Cboe participant day, discovery occurrence or inventory row | preserve source row/index and parent raw ID; parsing does not create reviewed company or relationship truth |
| `silver` | one explicit identity, source link, scoped topology candidate/evidence/review, or joined page/SEC observation | retain stable IDs, source IDs, review time, and separate event/reporting/source/arrival clocks; a candidate and its review remain distinct |
| `gold` | one reproducible analytical build, daily aggregate, or current topology review projection | keep input/build IDs and denominators; current review is not historical replay, relation strength, or probability |

`gold.topology_current_review` has one row per topology candidate, including candidates without a review and those whose latest review is not `accept`. Its key is `candidate_id`. It exposes the latest review ID, decision, reviewer, rationale, and time alongside source publication and retrieval. A consumer must filter by decision explicitly and must not infer relationship validity from the current view. The existing `reviewed_claims` query remains the time-aware publication path because it also checks supporting premises and review cutoffs.

The ML operations study is a bounded versioned analytical export, not a new database entity or canonical ontology. Its `members` grain is one of eight fixed leads keyed by `id`; `evidence` has one retained passage keyed by `id`. Each evidence row carries the source URL, publication or displayed update date, capture/arrival time where available, artifact SHA-256, and an optional retained record ID. An inventory occurrence is a project listing, not a provider or adoption observation. Lead roles may overlap. The reviewed-identity numerator is over the eight frozen leads, including unresolved and comparator members; no UI filter changes that denominator. Gate decisions remain separate from provider identity and from memo priorities.

| relation | row grain and key | time | provenance |
| --- | --- | --- | --- |
| `snapshots` | one immutable provider record; `id` | `captured_at` is source time; `ingested_at` is arrival time | provider record ID, archive URL, raw and text hashes |
| `warehouse.page_observations` | one snapshot; `observation_id` | carries source and arrival time | joins the source URL and reviewed company identity without copying evidence |
| `sec_financial_facts` | one retained SEC candidate fact; `id` | fact period plus `filed_date` | companyfacts member and pinned SEC artifact |
| `warehouse.sec_fact_observations` | one retained SEC candidate fact; `fact_id` | period, filing, retrieval, and artifact observation time | CIK, member hash, artifact version and HTTP validators |
| `market_daily` | one participant row in a source file; `(file_id, row_number)` | `trade_date` | immutable file ID and row number |
| `warehouse.market_daily_totals` | one file and trade date; `(file_id, trade_date)` | `trade_date` | reconciles to source rows through `participant_rows` |
| `topology_sources` | one retrieved source body or immutable snapshot reference; `id` | publication, capture, and retrieval are separate | original URL, publisher, raw hash or snapshot ID, retrieval outcome |
| `topology_entities` | one identified company, product, project, or unresolved mention; `id` | identity review is separate from source time | alias rows retain source and dates where known |
| `topology_eligibility_reviews` | one dated U.S. software eligibility decision; `id` | `reviewed_at` | reviewer and evidence source IDs; identity alone does not confer eligibility |
| `topology_candidates` | one source-backed scoped claim on an ordered entity pair; `id` | source publication, event, reporting period, and validity have distinct meanings | primary source ID, evidence locator and summary, interpretation, unknowns, generator version |
| `topology_candidate_evidence` | one additional supporting or contradicting source for a candidate; `(candidate_id, source_id, role)` | source-specific event and reporting dates where known | source ID, locator, summary, optional exact quotation |
| `topology_reviews` | one append-only decision on a candidate; `id` | `reviewed_at` | reviewer, decision, and rationale |
| `topology_graph_builds` | one reproducible claim-selection build; `id` | source and review cutoffs | query and ontology versions, input fingerprint |

`scripts/build_sec_analysis.py` applies the named policy in `src/log_pose/sec_analysis.py` to candidate facts from `warehouse.sec_fact_observations`. Its versioned JSON report is the analytical selection layer. `scripts/build_dashboard.py` verifies those selections and evidence IDs against the observation views before writing `web/dashboard.json`; selected cells retain their `fact_id`. The browser calculates only descriptive growth and same-period margin from already selected cells.

`scripts/build_data_catalog.py` reads all retained page observations, normalized SEC candidate facts, Cboe daily totals and participant rows, and accepted topology reviews in one read-only repeatable-read transaction. `web/data/index.json` contains exact counts, stable record identifiers, source metadata, typed partition paths, hashes, and a deterministic build ID. Pages and SEC facts partition by company; Cboe partitions by retained file. `web/data/inventory-search.json` indexes all raw inventory row names and descriptions, including untagged rows, while the fourteen existing full inventory partitions remain lazy. The exporter reconciles inventory records with Postgres and checks daily Cboe totals against their participants. [The data contract](data-contract.md) specifies fields and rebuild commands.

The catalog and analytical builders now read page and SEC observations from `silver`, source payload metadata from `raw`, parsed market and discovery rows from `bronze`, and daily totals from `gold`. The time-aware topology query still uses the underlying tables while its full cutoff logic is retained; the exported topology's direct source, entity, and review checks use layer views. This is a staged consumer migration, not a new source of truth.

Page partitions contain complete normalized plain text by default, never raw HTML. An explicit positive `--page-text-limit` creates a smaller excerpt catalog with exact source length, displayed length, and a truncation flag. Full retained source bytes remain in Postgres. Decimal financial and notional values remain decimal strings in the typed partitions; chart code explicitly converts values for display.

`web/discovery.json` is a separate lead index. Directory candidate IDs and navigation matches are not conformed company identities. The research desk uses an explicit identity review for a reviewed company relationship and labels other navigation matches as unreviewed leads.

`topology_discovery.py` projects the discovery index and deterministic review queue into the retained `web/data/topology-discovery.json` evidence projection. `market_field_graph.py` builds the full exact source/year/category graph from that projection before serving. `api/market-field.js` queries its indexed adjacency and returns bounded summaries, filtered counts/group flows, pages, and selected neighborhoods. source rows load only for an inspector selection. deterministic build IDs bind the graph to retained input hashes; version mismatch responses prevent mixed-build reads. the pinned frame has 1,240 candidates and 47,288 graph pairs; the 100 worklist edges remain separate. no new identity or accepted relationship follows from an overlap. [the service contract](market-field-service.md) describes limits, caching, rebuilds, deployment, and degraded behavior.

The canonical `/` route opens the research desk with the full retained 18,542-record index across five families, then loads full detail on selection. `?view=topology` defaults to the full 1,240-candidate source field; its source, year, research tag, exact source category, identity, candidate, and neighbor state persist in the URL. The complete overlap graph is constructed at build time and queried through the read service; the browser keeps layout and interaction only. Aggregate lines indicate co-listing volume between research groups; candidate focus reveals exact neighbors and source rows. `?view=topology&topologyLayer=reviewed` opens the four accepted company claims. The older `?view=explore` source audit loads one `web/discovery-inventory/{source}-{year}.json` partition on demand. The `?view=overview` selected company study retains its separate 2021–2024 page and SEC period series in `web/dashboard.json`; changing an inventory year does not change a financial period. Raw source rows, tagged occurrences, candidate keys, reviewed providers, selected companies, and accepted topology claims have different grains.

`docs/research/topology-review-queue.json` has one row per unordered inventory candidate pair, keyed by `id`, and an exact `input_sha256` of the discovery index. Its years are inventory observation years, not relationship dates. Each row retains the candidate IDs, shared pinned source categories and years, selection method, and explicit unreviewed status. The queue is a discovery worklist and contributes no accepted relationship edge. `docs/research/market-topology.json` is a reviewed seed import artifact. The dashboard and catalog now project current accepted database reviews through `topology_export.py`; the seed file no longer selects published claims. Each exported claim retains its database ID, actual review record, all supporting and contradicting passages, exact source hashes, time meanings, basis, and unknowns. Unreviewed endpoint identities fail publication. The seed importer restores the prior dated review with explicit day precision and an import rationale; it never appends another acceptance when any review already exists.

Migrations `008`–`011` add topology sources, identity and eligibility review, an acquisition queue, candidate claims with separate summaries and exact passages, extra evidence references, reviews, and build records. The [topology ontology](topology-ontology.md) defines predicate readings and what the time fields establish. A source-publication cutoff is not a relationship-validity query. A reviewed hypothesis remains a hypothesis; the system does not turn strength or confidence into a scalar edge weight. A source artifact remains in Postgres or the retained research artifacts; the static export contains the attributed summary and source reference, not raw HTML.

Migration `016` adds the scoped topology-reconstruction provenance seam. It preserves known original candidate and evidence arrival clocks, leaves unavailable entity, evidence, and imported-review row arrivals null, and records reconstruction arrival separately through raw, bronze, silver, and gold views. `scripts/import_topology_reconstruction.py` accepts only the approved local recovery socket and a clearly named reconstruction database. `scripts/export_topology_reconstruction.py` stages the reviewed topology slice, proves that other catalog and dashboard members remain equal, and creates a new immutable reviewed SQLite build while retaining older builds. This seam does not reconstruct other evidence families or authorize publication.

Migration `017` refreshes the lossless silver entity, candidate, and candidate-evidence views after migration `016` appends provenance-clock columns. It also exposes the readiness clocks that migration `015` added to `gold.atlas_snapshot`. PostgreSQL fixes a `SELECT *` view's column list when the view is created, so the additive migration keeps appended columns visible without rewriting an applied migration.

Migration `018` restores `gold.atlas_snapshot` as a readiness-filtered serving projection after the column refresh. It exposes `ready` and `prepared_at` for prepared rows while an unprepared immutable build remains available only in `public` until publication maintenance succeeds.

The [experimental benchmark protocol](../experiments/ml/benchmark/PROTOCOL.md) defines a separate, offline read model over retained artifacts. A versioned case manifest fixes the questions and artifact IDs; evaluator-only answer keys stay outside candidate-visible input. A replay run records its manifest hash, code and control versions, selected evidence IDs, exclusions, and case-level scores. This layer adds no evidence store or migration. Historical availability requires explicit proof from source publication, immutable capture or filing accession, and, for system-known replay, arrival time. Current dashboard selections and review annotations are not historical facts.

## safe extension seams

- add a new source by retaining its immutable payload and provider identity first, then expose a read view with grain, key, source time, arrival time, and provenance.
- add a reported metric by extending SEC candidate retention and selection policy before exporting it. Do not derive an unlabeled metric in the browser.
- add a dashboard comparison in `research-model.js`, including missing-value and duplicate-grain tests, then compose it in `app.js` with period and source labels.
- add a saved research set by first freezing its cohort and source-time cutoff in a versioned build input. Keep source bodies or immutable archive references, review decisions, the export, and a memo together. A browser filter changes the view, not the historical denominator or eligibility decision.
- add schema through a new tested migration. Do not rewrite applied migrations or replace raw evidence.
- assign each new durable record family to exactly one medallion layer, and document grain, key, clocks, and provenance before adding downstream projections. Keep raw bytes and failed acquisition records; keep bronze parsing, silver judgments, and gold aggregates traceable to upstream IDs.
- add a topology predicate only after defining its direction, scope, evidence rule, and non-implications in the ontology. Keep different claims between the same entities separate and preserve each source premise.
- keep 3D graph positions and projection deterministic in `research-model.js`. The WebGL module owns canvas geometry, interaction, and cleanup; `topology-view.js` opens a flat SVG map and retains filters, the claim index, evidence inspector, and optional 3D mode. Depth and distance are navigation aids, not quantitative encodings.

## checks

```bash
npm run test:dashboard
node --check web/app.js
node --check web/console-ui.js
node --check web/explore-view.js
node --check web/data-view.js
node --check web/research-model.js
node --check web/topology-view.js
.venv/bin/python -m pytest -q
LOG_POSE_TEST_DATABASE_URL='postgresql:///disposable_db' .venv/bin/python -m pytest -q tests/test_postgres.py tests/test_topology_postgres.py
```

The Postgres test URL must point to a disposable database. The integration fixture clears its source tables.

## experimental boundary

`experiments/ml/` owns the offline benchmark and the MLOps industry study, including their code, tests, protocols, study-specific raw artifacts, manifests, judgments, and receipts. These modules are outside the installed `log_pose` package and the default pytest test path. Run experimental checks explicitly with `pytest -q experiments/ml` and `npm run test:experimental`.

`web/experimental/index.html` is the labelled browser entry. Its MLOps page has an independent bootstrap, URL model, renderer, stylesheet, and study export under `web/experimental/mlops-2024/`. The ordinary console loads none of those assets; its only study-specific behavior redirects old `?view=research-set` bookmarks while preserving study filters. Experimental pages may reuse shared presentation styles. Use explicit `index.html` URLs so both the local server and static deployment resolve them consistently.

The MLOps builder reads shared retained evidence plus its own source manifest and writes only `experiments/ml/mlops-2024/study.json` and the experimental browser export. Its raw source bodies remain hash-verified. Experimental status does not change the raw → bronze → silver → gold contract: source bodies and acquisition attempts are raw, extracted passages are bronze, reviewed decisions are silver, and study summaries and benchmark scores are gold. These file artifacts are isolated analytical outputs; they are not automatically promoted into the canonical database or reviewed ontology. Promotion requires explicit review and tested integration.

The benchmark runs only through `experiments/ml/benchmark/run.py` with an explicit output directory. Historical scorecards stay preserved; fresh runs write separate receipts. No model training, credentialed inference, or source acquisition runs when opening either interface. See [experimental workspace instructions](../experiments/ml/README.md).


## temporal overview display limits

The temporal overview exposes `temporalNodeLimit` (50, 100, 150, 300, or all) and
`temporalEdgeLimit` (100, 250, 500, 1000, or 2500) in its URL state and timeline
controls. The browser defaults to 150 nodes and 500 connections. `node_limit`
and `edge_limit` are bounded API frame parameters and participate in the frame
identity. Calls that omit both retain the previous full overview contract.

The service ranks nodes by distinct peers in the complete provider/year/category/
search-filtered slice, with candidate ID breaking ties. It then ranks connections
among those displayed nodes by exact shared source/year/category placement count,
with endpoint IDs breaking ties. The two caps do not change retained row coverage,
eligible candidate counts, total connection counts, stable positions, or evidence
identities. Counts show displayed versus eligible totals. Rank is a navigation
choice, not relationship strength or confidence. Search still covers every
matching candidate. Focused evidence keeps its separate 60-record paging contract;
the overview controls reappear when the user returns to the source field.
