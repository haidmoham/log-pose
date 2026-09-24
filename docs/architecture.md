# architecture and extension map

Log Pose has two browser surfaces with different runtime contracts.

- `npm run dashboard` serves the read-only research console from saved JSON exports. `web/index.html` loads `research-model.js` for validation, calculations, and URL state; `console-ui.js` for DOM and chart primitives; `explore-view.js` for lead and evidence search; and `app.js` for state, data loading, overview, and compare. It does not require Postgres.
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

`scripts/build_sec_analysis.py` applies the named policy in `src/log_pose/sec_analysis.py` to candidate facts from `warehouse.sec_fact_observations`. Its versioned JSON report is the analytical selection layer. `scripts/build_dashboard.py` verifies those selections and evidence IDs against the observation views before writing `web/dashboard.json`. The browser calculates only descriptive growth and same-period margin from already selected cells.

`web/discovery.json` is a separate lead index. Directory candidate IDs and reviewed provider relationships are not conformed company identities. They become company evidence only through the explicit pilot links carried in the export.

## safe extension seams

- add a new source by retaining its immutable payload and provider identity first, then expose a read view with grain, key, source time, arrival time, and provenance.
- add a reported metric by extending SEC candidate retention and selection policy before exporting it. Do not derive an unlabeled metric in the browser.
- add a dashboard comparison in `research-model.js`, including missing-value and duplicate-grain tests, then compose it in `app.js` with period and source labels.
- add schema through a new tested migration. Do not rewrite applied migrations or replace raw evidence.

## checks

```bash
npm run test:dashboard
node --check web/app.js
node --check web/console-ui.js
node --check web/explore-view.js
node --check web/research-model.js
.venv/bin/python -m pytest -q
LOG_POSE_TEST_DATABASE_URL='postgresql:///disposable_db' .venv/bin/python -m pytest -q tests/test_postgres.py
```

The Postgres test URL must point to a disposable database. The integration fixture clears its source tables.
