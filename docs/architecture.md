# architecture and extension map

Log Pose has two browser surfaces with different runtime contracts.

- `npm run dashboard` serves the read-only research console from saved JSON exports. `web/index.html` loads `research-model.js` for validation, calculations, deterministic graph coordinates, and URL state; `console-ui.js` for DOM and chart primitives; `explore-view.js` for lead and evidence search; `topology-view.js` for the reviewed claim map and inspector; `topology-webgl.js` for its optional 3D renderer; and `app.js` for state, data loading, and route composition. It does not require Postgres.
- `npm run dev` runs the local evidence inventory from Postgres. The server maps `/` to `web/live-index.html`, `/app.js` to `web/live-app.js`, and `/style.css` to the existing shared stylesheet. The console stylesheet is separate so dashboard changes cannot silently restyle the live inventory.

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

`scripts/build_sec_analysis.py` applies the named policy in `src/log_pose/sec_analysis.py` to candidate facts from `warehouse.sec_fact_observations`. Its versioned JSON report is the analytical selection layer. `scripts/build_dashboard.py` verifies those selections and evidence IDs against the observation views before writing `web/dashboard.json`. The browser calculates only descriptive growth and same-period margin from already selected cells.

`web/discovery.json` is a separate lead index. Directory candidate IDs and reviewed provider relationships are not conformed company identities. They become company evidence only through the explicit pilot links carried in the export.

The canonical `/` route opens the source inventory. It derives its 2020–2026 years and row counts from `web/discovery.json` artifacts and loads one `web/discovery-inventory/{source}-{year}.json` partition on demand. The inventory source, year, and query state is addressable in the URL. The `?view=overview` selected company study retains its separate 2021–2024 page and SEC period series in `web/dashboard.json`; changing an inventory year does not change a financial period. Raw source rows, tagged occurrences, candidate keys, reviewed providers, selected companies, and accepted topology claims have different grains. The map renders only accepted claims from `market_topology`, never directory overlap.

`docs/research/topology-review-queue.json` has one row per unordered inventory candidate pair, keyed by `id`. Its years are inventory observation years, not relationship dates. Each row retains the candidate IDs, shared pinned source categories and years, selection method, and explicit unreviewed status. The queue is a discovery worklist and contributes no graph edge. `docs/research/market-topology.json` has one reviewed seed claim per `claims[].id`; each claim retains its ordered endpoints, source publication and retrieval dates, source hash, evidence location and passage, basis, interpretation, and unknowns. The dashboard export verifies those claims against accepted database reviews before embedding them.

Migrations `008`–`011` add topology sources, identity and eligibility review, an acquisition queue, candidate claims with separate summaries and exact passages, extra evidence references, reviews, and build records. The [topology ontology](topology-ontology.md) defines predicate readings and what the time fields establish. A source-publication cutoff is not a relationship-validity query. A reviewed hypothesis remains a hypothesis; the system does not turn strength or confidence into a scalar edge weight. A source artifact remains in Postgres or the retained research artifacts; the static export contains the attributed summary and source reference, not raw HTML.

## safe extension seams

- add a new source by retaining its immutable payload and provider identity first, then expose a read view with grain, key, source time, arrival time, and provenance.
- add a reported metric by extending SEC candidate retention and selection policy before exporting it. Do not derive an unlabeled metric in the browser.
- add a dashboard comparison in `research-model.js`, including missing-value and duplicate-grain tests, then compose it in `app.js` with period and source labels.
- add schema through a new tested migration. Do not rewrite applied migrations or replace raw evidence.
- add a topology predicate only after defining its direction, scope, evidence rule, and non-implications in the ontology. Keep different claims between the same entities separate and preserve each source premise.
- keep 3D graph positions and projection deterministic in `research-model.js`. The WebGL module owns canvas geometry, interaction, and cleanup; `topology-view.js` retains filters, the claim index, evidence inspector, and a flat SVG fallback. Depth and distance are navigation aids, not quantitative encodings.

## checks

```bash
npm run test:dashboard
node --check web/app.js
node --check web/console-ui.js
node --check web/explore-view.js
node --check web/research-model.js
node --check web/topology-view.js
.venv/bin/python -m pytest -q
LOG_POSE_TEST_DATABASE_URL='postgresql:///disposable_db' .venv/bin/python -m pytest -q tests/test_postgres.py tests/test_topology_postgres.py
```

The Postgres test URL must point to a disposable database. The integration fixture clears its source tables.
