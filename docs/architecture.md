# architecture and extension map

Log Pose serves one research console from retained exports.

- `npm run dashboard` serves the read-only research console from saved JSON exports. `web/index.html` loads `research-model.js` for validation, calculations, deterministic graph coordinates, and URL state; `console-ui.js` for DOM and chart primitives; `data-view.js` for cross-source search and retained-record inspection; `explore-view.js` for source audits; `topology-view.js` for the reviewed claim map and inspector; `topology-webgl.js` for its optional 3D renderer; and `app.js` for state, data loading, and route composition. It does not require Postgres.
- `npm run dev` serves the same `web/index.html`, scripts, styles, and lazy data partitions. It does not migrate the database or fetch new evidence when opening the interface. An explicit `DATABASE_URL` enables the retained read-only `/api/companies` and `/api/overview` endpoints; the console itself does not require Postgres. Static paths are confined to `web/`.

## data contracts

The database remains the durable evidence store. Migration `007_warehouse_views.sql` adds read-only observation views; it does not create a new ingestion platform or claim a dimensional warehouse.

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

Page partitions contain complete normalized plain text by default, never raw HTML. An explicit positive `--page-text-limit` creates a smaller excerpt catalog with exact source length, displayed length, and a truncation flag. Full retained source bytes remain in Postgres. Decimal financial and notional values remain decimal strings in the typed partitions; chart code explicitly converts values for display.

`web/discovery.json` is a separate lead index. Directory candidate IDs and navigation matches are not conformed company identities. The research desk uses an explicit identity review for a reviewed company relationship and labels other navigation matches as unreviewed leads.

The canonical `/` route opens the research desk. It searches metadata across all five retained record families, then loads full detail on selection. Company, family, source or period year, selected record, market date, measure, participant, topology filters, and selected claim have URL state. The older `?view=explore` source audit loads one `web/discovery-inventory/{source}-{year}.json` partition on demand. The `?view=overview` selected company study retains its separate 2021–2024 page and SEC period series in `web/dashboard.json`; changing an inventory year does not change a financial period. Raw source rows, tagged occurrences, candidate keys, reviewed providers, selected companies, and accepted topology claims have different grains. The map renders only accepted claims from `market_topology`, never directory overlap.

`docs/research/topology-review-queue.json` has one row per unordered inventory candidate pair, keyed by `id`, and an exact `input_sha256` of the discovery index. Its years are inventory observation years, not relationship dates. Each row retains the candidate IDs, shared pinned source categories and years, selection method, and explicit unreviewed status. The queue is a discovery worklist and contributes no graph edge. `docs/research/market-topology.json` is a reviewed seed import artifact. The dashboard and catalog now project current accepted database reviews through `topology_export.py`; the seed file no longer selects published claims. Each exported claim retains its database ID, actual review record, all supporting and contradicting passages, exact source hashes, time meanings, basis, and unknowns. Unreviewed endpoint identities fail publication. The seed importer restores the prior dated review with explicit day precision and an import rationale; it never appends another acceptance when any review already exists.

Migrations `008`–`011` add topology sources, identity and eligibility review, an acquisition queue, candidate claims with separate summaries and exact passages, extra evidence references, reviews, and build records. The [topology ontology](topology-ontology.md) defines predicate readings and what the time fields establish. A source-publication cutoff is not a relationship-validity query. A reviewed hypothesis remains a hypothesis; the system does not turn strength or confidence into a scalar edge weight. A source artifact remains in Postgres or the retained research artifacts; the static export contains the attributed summary and source reference, not raw HTML.

## safe extension seams

- add a new source by retaining its immutable payload and provider identity first, then expose a read view with grain, key, source time, arrival time, and provenance.
- add a reported metric by extending SEC candidate retention and selection policy before exporting it. Do not derive an unlabeled metric in the browser.
- add a dashboard comparison in `research-model.js`, including missing-value and duplicate-grain tests, then compose it in `app.js` with period and source labels.
- add schema through a new tested migration. Do not rewrite applied migrations or replace raw evidence.
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
