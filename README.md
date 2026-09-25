# Log Pose

Log Pose stores dated primary-source evidence about software companies. Its broader discovery layer now retains 14 pinned CNCF and LF AI & Data inventories from 2020–2026: 18,076 product, project, and directory rows, including 6,096 tagged occurrences. The separate pilot follows 20 selected companies across 2021–2024, with SEC facts for ten public companies and market-wide Cboe activity. A small reviewed topology layer records scoped relationship claims and an explicit shared-exposure hypothesis. Directory rows and pages are observations, not company classifications; the topology does not infer market share, shared customers, or winners.

This is an independent public experiment inspired by a conversation about investor research at Telescope Partners. It is not affiliated with Telescope and contains no internal Telescope material.

The [public dashboard](https://logpose.mhaider.dev/) is a static, read-only export backed by `web/dashboard.json`. Vercel builds the repository's `web/` files from each push to `main`; `vercel.json` maps public URLs to those files. Cloudflare keeps the `logpose` CNAME in DNS-only mode and points it at the target shown in Vercel's domain settings. The local read API and Postgres database are not hosted with the dashboard.

## Export-backed research dashboard

Run `npm run dashboard`, then open `http://127.0.0.1:8080/`. This serves the saved dashboard and discovery exports without starting Postgres or changing evidence. Run `npm run test:dashboard` for the pure calculation, missing-data, chart-scale, URL-state, and export-contract checks. Overview, compare, and explore state is encoded in the URL for reloads and browser navigation.

The dashboard and local development server now serve the same research console. The retained-data catalog adds all 89 snapshots, 369 normalized SEC candidates, and 19,093 Cboe participant rows through lazy typed partitions; its compact inventory search covers all 18,076 source rows. See the [data contract](docs/data-contract.md) for rebuild and local full-text commands. Explore loads the full source/year inventory partitions on demand, including rows without a candidate tag. The topology view offers an interactive 3D WebGL map of reviewed claims, a flat fallback, and the same source inspector and claim index. The [architecture and extension map](docs/architecture.md) documents their modules plus the database view grains, timestamps, provenance, and safe extension seams.

## Market topology research

The topology tab and company detail show reviewed claims as a local map and source inspector. The first reviewed seed covers Datadog naming Elastic as a scoped competitor; dbt Labs and Snowflake announcing a partnership and Snowflake's participation in dbt Labs' financing; and an untested Datadog–Snowflake shared business-driver hypothesis. These are distinct claims, even when one source supports more than one. Their source summaries, attribution, evidence locations, dates, interpretations, and remaining unknowns stay visible. A missing link means this slice has not recorded a supported claim. The map's placement, line style, and claim basis are not relationship strength, probability, or measured performance correlation.

The [topology ontology](docs/topology-ontology.md) gives each predicate a precise reading and describes source, event, reporting, validity, and review time. The [source and review method](docs/research/topology-method.md) separates the reviewed seed from a broader U.S. software research queue. The queue nominates product/project pairs from pinned inventory overlap; it does not establish company identity, U.S. eligibility, or a relationship. Reviewed claims require retained source artifacts and a dated review. Raw HTML remains outside the static `web/` export.

To reproduce the bounded review queue from the pinned discovery export and check the saved source artifacts:

```bash
PYTHONPATH=src .venv/bin/python scripts/build_topology_review_queue.py
.venv/bin/python scripts/capture_topology_sources.py
```

With a disposable or intended local Postgres database selected through `DATABASE_URL`, apply migrations and import the reviewed seed before rebuilding `web/dashboard.json`:

```bash
log-pose migrate
PYTHONPATH=src .venv/bin/python scripts/import_topology_seed.py
PYTHONPATH=src .venv/bin/python scripts/build_dashboard.py
```

The import verifies source hashes and restores the prior dated seed review with an explicit import rationale; it performs no new source review, fetches no missing artifacts, and cannot supersede an existing review decision. The capture command reports failures rather than converting a URL or directory overlap into a claim.

## Local live preview

Run `npm run dev` from the repository root, then open `http://127.0.0.1:8000/`. The command prepares the Python environment and serves the same research console as the static deployment. It reads saved exports and does not start Postgres, migrate tables, or fetch sources. Stop it with Ctrl-C.

Set `DATABASE_URL` to enable the existing read-only `/api/companies`, `/api/overview`, and `/api/companies/{slug}?cutoff=...` routes. Database setup, evidence acquisition, and rebuilding exports are explicit commands. The [data contract](docs/data-contract.md) gives the full retained-data rebuild and an optional local console with complete normalized page text.

## Run locally

The manual path below uses Docker Compose, Python 3.11+, and network access to the Internet Archive.

```bash
docker compose up -d db
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
export PYTHONPATH="$PWD/src"
export DATABASE_URL=postgresql://logpose:logpose@localhost:5432/logpose
log-pose migrate
log-pose ingest
log-pose inspect weights-and-biases --year 2021
log-pose serve --port 8000
```

The read endpoint is `GET http://127.0.0.1:8000/api/companies/weights-and-biases?cutoff=2021-12-31T23:59:59Z`. Any timezone-aware ISO 8601 cutoff works. The older `log-pose export` command still writes `web/evidence.json`. To rebuild the pilot dashboard, apply all additive migrations first, including the read-only `warehouse` observation views, then run:

```bash
export DATABASE_URL=postgresql://127.0.0.1:55434/logpose_pilot
log-pose migrate
PYTHONPATH=src .venv/bin/python scripts/build_dashboard.py
PYTHONPATH=src .venv/bin/python scripts/build_discovery_index.py
python -m http.server 8080 --directory web
```

Visit `http://localhost:8080`. Search loads `web/discovery.json`, a reproducible index from 14 pinned CNCF and LF AI & Data inventories across 2020–2026. It searches tagged product/project leads, shows each source occurrence, and aggregates the current result set by candidate tag and observed year. The full inventory browser loads one of 14 `web/discovery-inventory/` partitions at a time and includes 11,980 untagged source rows. The 2026 files are partial-year snapshots. A 20-record identity challenge links 22 raw candidate keys to first-party provider or project evidence; three Weaviate keys share one reviewed identity. The separate provider-candidate view contains 15 reviewed provider leads, including five with dated U.S. base evidence. Every provider lead still has unreviewed company eligibility. These records are **not** a verified U.S. company census. The separate 20-company pilot provides dated pages, SEC facts for ten public registrants, four selected first-party financing announcements, and 12 dated U.S. location reviews. Eleven reviews document a U.S. headquarters or principal executive office; GitLab remains unresolved under this location rule. This selected set is not a market sample, and a 2024 office does not prove every prior year. Announcement amounts and valuations are company claims, not a complete financing history. The pilot export reads the saved ingestion and SEC selection reports, checks their selected capture IDs against Postgres, and aggregates stored Cboe files. Raw HTML, full extracted text, original CSVs, and cached landscape YAML stay outside the static export. Rebuild the two pilot reports first if that database has changed. The [universe research note](docs/research/us-company-universe-plan.md) explains the eligibility and identity work still needed.

`scripts/build_discovery_index.py` reads the pinned YAML retained in `docs/research/source-artifacts/discovery/`. Run it again with `--offline` to reproduce the same export bytes. Each exported row retains its original category path, row position, pinned Git URL, and artifact SHA-256. The category mapping in `src/log_pose/discovery.py` nominates leads for review; the manual identity layer is separate and does not infer U.S. location, launch date, financing, or traction. To populate the database inventory layer, run `log-pose migrate`, then `PYTHONPATH=src .venv/bin/python scripts/import_discovery_extension.py` with `DATABASE_URL` set to the intended Postgres database. The import is idempotent and checks retained artifact hashes.

Run focused checks with:

```bash
pytest -q
# For the SQL integration test, use a disposable database:
LOG_POSE_TEST_DATABASE_URL=postgresql://logpose:logpose@localhost:5432/logpose pytest -q tests/test_postgres.py
```

The integration test clears its target database. Never point it at a database you care about. The normal ingestion does not clear data.

## Data flow and invariants

`sources.json` is a small, reviewed list of original URLs and verified capture identifiers. `acquire.py` fetches raw Wayback HTML and rejects off-source redirects, captures after the requested cutoff, non-HTML responses, oversized bodies, and empty visible text. `core.py` normalizes visible page text. `storage.py` persists the original response body, both hashes, archive URL, source URL, `captured_at`, and independent `ingested_at` in Postgres. Each attempt is recorded separately, including failure and duplicate outcomes. Run ingestion again to retry failures; existing captures cannot be silently overwritten.

The legacy API cutoff query selects the latest stored capture for each curated source with `captured_at <= cutoff`. It does not select by ingestion date and does not fetch a current page when a capture is absent. A missing cell says only that this system lacks eligible evidence. The response includes the raw content hash; the legacy `evidence.json` export includes a 320-character preview. The retained-data catalog includes up to 6,000 plain-text characters per snapshot with explicit truncation fields; the local API and optional local catalog retain complete normalized text. Raw HTML remains in Postgres.

The schema separates `companies`, `sources`, `snapshots`, and `ingestion_attempts`. Interpretations will be a separate layer referencing immutable snapshot IDs. It is intentionally a manually curated batch process, not a crawler platform.

## Verified source coverage

The following six raw captures were fetched and normalized during setup (UTC). Their archive URLs are generated from `sources.json`.

| Company | 2021 capture | 2024 capture | Source |
| --- | --- | --- | --- |
| dbt Labs | 2021-12-01 10:04:35 | 2024-12-14 01:06:20 | `https://www.getdbt.com/` |
| Weights & Biases | 2021-12-14 13:28:09 | 2024-12-16 07:57:51 | `https://wandb.ai/site` |
| Confluent | 2021-12-14 08:31:32 | 2024-12-14 13:43:55 | `https://www.confluent.io/` |

On the verified batch run, all six captures stored successfully; an immediate rerun reported six duplicates and stored no additional captures. The SQL integration test passed after fixing UTC formatting. Captures are days or weeks before the month-end comparison cutoff; the UI exposes exact dates rather than implying a December 31 observation. Homepages can change independently of product positioning, and these six pages are insufficient to infer the entire market.

## Other source options

The [Internet Archive CDX index](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server) can find more candidate captures for curated URLs, but a hit in the index is not proof that the archived HTML is retrievable. [Common Crawl](https://commoncrawl.org/cdxj-index) publishes a monthly URL index and WARC records with capture timestamps; the pilot already uses it for bounded archived-page retrieval. [YC's public company directory](https://www.ycombinator.com/companies) may help enumerate company identities and current categories, but current directory descriptions cannot establish what a company sold in 2021. Treat any firmographic dataset similarly unless each field has an as-of date and underlying evidence.

## Failures and next slice

Archive availability, redirects, blocked responses, timeout, body limits, and text extraction are visible as per-source attempts. A candidate Snowflake homepage returned HTTP 403 for its 2024 capture, so it was not selected for that early sample. The 20-company pilot has one selected homepage per company per year; the separate 14-inventory discovery pull spans 2020–2026. The next research slice is reviewed product-to-company identity and historical U.S. evidence for a small set, with unresolved links left explicit.
