# Log Pose

Log Pose stores dated primary-source evidence about software companies. The current pilot follows 20 selected companies across 2021–2024, with SEC facts for ten public companies and market-wide Cboe activity. It does not infer markets, customers, or winners. A page is an observation, not a classification.

This is an independent public experiment inspired by a conversation about investor research at Telescope Partners. It is not affiliated with Telescope and contains no internal Telescope material.

The existing [public evidence preview](https://log-pose.shin86dev.chatgpt.site) may still show the earlier six-capture export. The larger local dashboard is a static, read-only export; the local read API and Postgres database are not hosted with it.

## Run locally

Requirements: Python 3.11+, Docker with Compose, and network access to the Internet Archive.

```bash
docker compose up -d db
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
export DATABASE_URL=postgresql://logpose:logpose@localhost:5432/logpose
log-pose migrate
log-pose ingest
log-pose inspect weights-and-biases --year 2021
log-pose serve --port 8000
```

The read endpoint is `GET http://127.0.0.1:8000/api/companies/weights-and-biases?cutoff=2021-12-31T23:59:59Z`. Any timezone-aware ISO 8601 cutoff works. The older `log-pose export` command still writes `web/evidence.json`. To rebuild the pilot dashboard, run:

```bash
export DATABASE_URL=postgresql://127.0.0.1:55434/logpose_pilot
PYTHONPATH=src .venv/bin/python scripts/build_dashboard.py
PYTHONPATH=src .venv/bin/python scripts/build_discovery_index.py
python -m http.server 8080 --directory web
```

Visit `http://localhost:8080`. Search loads `web/discovery.json`, a reproducible pull from eight pinned CNCF and LF AI & Data historical inventories across 2021–2024. It searches product/project leads, shows each source occurrence, and aggregates the current result set by candidate tag and observed year. These records are **not** verified companies or a U.S. market census. The separate 20-company pilot provides dated pages, SEC facts for ten public registrants, and four selected first-party financing announcements. Announcement amounts and valuations are company claims, not a complete financing history. The pilot export reads the saved ingestion and SEC selection reports, checks their selected capture IDs against Postgres, and aggregates stored Cboe files. Raw HTML, full extracted text, original CSVs, and cached landscape YAML stay outside the static export. Rebuild the two pilot reports first if that database has changed. The [universe research note](docs/research/us-company-universe-plan.md) explains the eligibility and identity work still needed.

`scripts/build_discovery_index.py` caches raw pinned YAML under ignored `data/discovery/`. Run it again with `--offline` to reproduce the export from those exact local bytes. Each exported occurrence retains its original category path, row position, pinned Git URL, and artifact SHA-256. The category mapping in `src/log_pose/discovery.py` nominates leads for review; it does not infer a vendor, U.S. location, launch date, financing, or traction.

Run focused checks with:

```bash
pytest -q
# For the SQL integration test, use a disposable database:
LOG_POSE_TEST_DATABASE_URL=postgresql://logpose:logpose@localhost:5432/logpose pytest -q tests/test_postgres.py
```

The integration test clears its target database. Never point it at a database you care about. The normal ingestion does not clear data.

## Data flow and invariants

`sources.json` is a small, reviewed list of original URLs and verified capture identifiers. `acquire.py` fetches raw Wayback HTML and rejects off-source redirects, captures after the requested cutoff, non-HTML responses, oversized bodies, and empty visible text. `core.py` normalizes visible page text. `storage.py` persists the original response body, both hashes, archive URL, source URL, `captured_at`, and independent `ingested_at` in Postgres. Each attempt is recorded separately, including failure and duplicate outcomes. Run ingestion again to retry failures; existing captures cannot be silently overwritten.

The cutoff query selects the latest stored capture for each curated source with `captured_at <= cutoff`. It does not select by ingestion date and does not fetch a current page when a capture is absent. A missing cell says only that this system lacks eligible evidence. The response includes the raw content hash; the public export includes only a 320-character text preview, while the local API returns normalized text. Raw HTML remains in Postgres.

The schema separates `companies`, `sources`, `snapshots`, and `ingestion_attempts`. Interpretations will be a separate layer referencing immutable snapshot IDs. It is intentionally a manually curated batch process, not a crawler platform.

## Verified source coverage

The following six raw captures were fetched and normalized during setup (UTC). Their archive URLs are generated from `sources.json`.

| Company | 2021 capture | 2024 capture | Source |
| --- | --- | --- | --- |
| dbt Labs | 2021-12-01 10:04:35 | 2024-12-14 01:06:20 | `https://www.getdbt.com/` |
| Weights & Biases | 2021-12-14 13:28:09 | 2024-12-16 07:57:51 | `https://wandb.ai/site` |
| Confluent | 2021-12-14 08:31:32 | 2024-12-14 13:43:55 | `https://www.confluent.io/` |

On the verified batch run, all six captures stored successfully; an immediate rerun reported six duplicates and stored no additional captures. The SQL integration test passed after fixing UTC formatting. Captures are days or weeks before the month-end comparison cutoff; the UI exposes exact dates rather than implying a December 31 observation. Homepages can change independently of product positioning, and these six pages are insufficient to infer the entire market.

## Pre-existing source options

The [Internet Archive CDX index](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server) can find more candidate captures for curated URLs, but a hit in the index is not proof that the archived HTML is retrievable. [Common Crawl](https://commoncrawl.org/cdxj-index) publishes a monthly URL index and WARC records with capture timestamps; this is the next candidate acquisition adapter if Wayback coverage is thin. [YC's public company directory](https://www.ycombinator.com/companies) may help enumerate company identities and current categories, but current directory descriptions cannot establish what a company sold in 2021. Treat any firmographic dataset similarly unless each field has an as-of date and underlying evidence.

## Failures and next slice

Archive availability, redirects, blocked responses, timeout, body limits, and text extraction are visible as per-source attempts. A candidate Snowflake homepage returned HTTP 403 for its 2024 capture, so it was not selected for the sample. This demo has only one page per company per year and no automated source discovery. The next small slice is a few manually reviewed observations of product and buyer language, each tied to a snapshot ID and quoted text span, with a tiny evaluation set before automated classification.
