# retained-data catalog

the static console reads `web/data/index.json`. all paths in this contract are relative to the served `web/` root. the catalog is compact JSON; partition files load when a user opens a record or source family. the fourteen discovery inventory partitions continue to use their existing contract.

| field | meaning |
| --- | --- |
| `schema_version` | `1.0` for this catalog contract |
| `build_id` | SHA-256 of the deterministic catalog contents before this field is added |
| `counts` | exact retained record counts; `pages`, `sec`, `market_rows`, `inventory_rows`, and `topology_claims` are primary UI denominators |
| `companies` | the existing pilot company metadata, linked by reviewed slug/CIK |
| `datasets` | source family, row grain, count, and partition paths |
| `pages` | one metadata entry per retained snapshot, including observations outside the selected 80 pilot cells |
| `sec` | one metadata entry per retained normalized SEC candidate, with selected/alternative state |
| `market` | one metadata entry per retained Cboe source file, with participant names and date/row counts |
| `topology` | accepted database claims, reviewed endpoints, exact passages, per-claim review, and complete review history |
| `discovery.search_path` | compact metadata search index covering every source row, including untagged rows |
| `partitions` | exact SHA-256 and byte length of each newly generated typed partition |
| `provenance` | applied migrations, selected SEC policy/cutoff, discovery input hash, and text limit |
| `research` | reviewed quotations, selected financing announcements, and dated location reviews |

## typed records

- `data/pages/{company_slug}.json`: `{schema_version, family, company_slug, grain, records}`. IDs are `page:{snapshot_id}`. each record retains observation/source identifiers, source URL, provider record locator, source capture and ingestion times, raw/text hashes, extraction/truncation provenance, selected-pilot status, reviewed quote if present, and `normalized_text`. `text_characters` is the full retained source length; `displayed_characters` and `text_truncated` describe the exported text. source text is plain text and must never be injected as HTML.
- `data/sec/{company_slug}.json`: `{schema_version, family, company_slug, grain, records, policy, policy_version, as_of}`. IDs are `sec:{fact_id}`. each record retains taxonomy/tag, unit, exact decimal value, fact period, filing date/accession, fiscal fields, source-member hash, artifact version, and selection state. `retained_alternative` means the named policy chose another candidate; it is not a factual rejection. only the three normalized concepts retained by ingestion are analytical candidates. full source companyfacts members remain in Postgres.
- `data/market/{year}-{file_id}.json`: `{schema_version, family, grain, source, daily, participants}`. file IDs are `market-file:{file_id}`; day IDs are `market-day:{file_id}:{trade_date}`; row IDs are `market-row:{file_id}:{row_number}`. `daily` has totals per file/date; `participants` contains every parsed source row with tape A/B/C and total shares, notional, and trade counts. notional values remain decimal strings. all values describe U.S. equity venue activity; no company or ticker attribution is inferred. attribute the source to Cboe Exchange, Inc.
- `data/inventory-search.json`: `{schema_version, records}`. each row has the existing inventory ID, name, full source description, source/year/category, mapping status, candidate key where the tagged occurrence has one, and the full partition path. a candidate key is not a reviewed company relationship.

`topology.claims` retains the existing browser shape (`id`, endpoints, predicate, direction, scope, basis, interpretation, unknowns, dates, `sources`) and adds `database_id`, `created_at`, and `review`. `review` contains `id`, `reviewer`, `reviewed_at`, `rationale`, `decision`, and `date_precision`. `sources[].role` is `support` or `contradict`; every passage and hash stays visible. seed-compatible public IDs preserve existing URLs. actual database IDs remain authoritative. no accepted claims means an empty graph, even when the seed file still lists earlier claims.

## reproducible local build

use `DATABASE_URL` for the retained evidence database or a local clone. the catalog exporter is read-only. the broader rebuild updates generated files and does not make network requests:

```sh
PYTHONPATH=src:. .venv/bin/python scripts/rebuild_data.py
```

to prepare an existing local clone whose schema predates the discovery/topology tables, explicitly request migration and pinned discovery import. restoring prior curated seed reviews is a separate explicit flag:

```sh
PYTHONPATH=src:. .venv/bin/python scripts/rebuild_data.py --prepare-local-database --import-reviewed-seed
```

this never turns inventory pairs or new acquisition results into accepted claims. imports compare immutable evidence and preserve existing review decisions. a later rejection survives reimport.

to make a local-only copy of the same console with full retained normalized page text:

```sh
mkdir -p site/local
cp -R web/. site/local/
PYTHONPATH=src .venv/bin/python scripts/build_data_catalog.py --web-root site/local
python3 -m http.server 8081 --bind 127.0.0.1 --directory site/local
```

`site/` is ignored by Git. the default export includes all retained normalized page text. set `--page-text-limit` to a positive character count to make a smaller excerpt export. neither mode exports raw HTML. opening `npm run dev` serves the retained export and performs no acquisition or schema writes; `/api/*` remains available when a database URL is supplied.

## verification

the export validates selected SEC observations against their report, inventory rows against the retained database, topology hashes and quotations against source bodies, reviewed endpoint identity, and daily market totals against unique participant rows. source decimals are serialized exactly. serialization completes before destination replacement, and the catalog is replaced last. the host publishes a complete Git deployment; local builds should complete before reloading the console.

`LOG_POSE_CATALOG_TEST_DATABASE_URL` enables a read-only export reconciliation test against a prepared clone. `LOG_POSE_TEST_DATABASE_URL` enables destructive fixture tests and must name a separate disposable database. never use the evidence clone for the latter.
