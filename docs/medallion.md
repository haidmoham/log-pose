# medallion record contract · first migration

The first implementation is migration `013_medallion_read_layers.sql`. It gives each durable domain table one stable read path under `raw`, `bronze`, `silver`, or `gold`. Views expose the existing rows without copying them. The `public` tables still accept writes and own constraints and foreign keys. `warehouse` remains a legacy joined read seam until consumers move to the named layers. `schema_migrations` is migration control metadata, not research data.

| layer relation | row grain and key | clocks and provenance |
| --- | --- | --- |
| `raw.snapshots` | one immutable provider capture; `id` | `captured_at`, `ingested_at`, provider record ID, archive URL, raw/text hashes |
| `raw.ingestion_attempts` | one source request; `id` | request/finish times, target cutoff, outcome and failure detail |
| `raw.market_files` | one exact Cboe CSV; `id` | study year, source URL, raw hash, parser version |
| `raw.sec_artifacts` | one SEC ZIP version; `artifact_version` | `observed_at`, source URL, ETag, Last-Modified, byte length |
| `raw.sec_companyfacts` | one ZIP member and CIK; `id` | `retrieved_at`, parent artifact version, member name and raw hash |
| `raw.topology_sources` | one source body, snapshot reference, or failed retrieval; `id` | publication, capture, retrieval, URL, publisher, raw hash and status |
| `raw.topology_acquisition_jobs` | one bounded source request; `id` | creation/attempt time, source key, status, attempts and error |
| `raw.discovery_artifacts` | one pinned inventory YAML; `raw_sha256` | source commit time, retrieval time, repository commit and byte hash |
| `bronze.market_daily` | one Cboe participant row; `(file_id, row_number)` | trade date and parent raw file ID; no company return is inferred |
| `bronze.sec_financial_facts` | one parsed SEC fact candidate; `id` | fact period, filed date, accession, parent member ID; filed date does not prove retained ZIP vintage |
| `bronze.discovery_occurrences` | one tagged source row; `id` | parent artifact hash and source path; directory year is observation, not company validity |
| `bronze.discovery_inventory_rows` | one source dictionary item, including unmapped rows; `id` | parent artifact hash and source path; mapping status remains explicit |
| `silver.companies` | one selected pilot company; `id` | slug/name identity; not a representative universe |
| `silver.sources` | one company source URL and purpose; `id` | company ID and original URL; capture time lives on each raw snapshot |
| `silver.topology_entities` | one entity or unresolved lead; `id` | creation time, kind and identity review status |
| `silver.topology_entity_aliases` | one alias claim; `id` | optional valid dates and source ID; alias is not company equivalence by itself |
| `silver.topology_eligibility_reviews` | one dated eligibility decision; `id` | `reviewed_at`, reviewer, source ID and rationale |
| `silver.topology_candidates` | one scoped, ordered relationship proposal; `id` | event/reporting/validity fields, creation time, source ID, basis and interpretation |
| `silver.topology_candidate_evidence` | one additional support or contradiction passage; `id` | source ID, role, event/reporting fields and locator |
| `silver.topology_reviews` | one append-only candidate decision; `id` | `reviewed_at`, reviewer, decision and rationale |
| `gold.topology_graph_builds` | one reproducible graph build; `id` | build and cutoff times, input/output hashes, candidate and accepted counts |

The joined `silver.page_observations` view has one snapshot (`observation_id`) per row and retains source and company identity, capture and ingestion times, and hashes. `silver.sec_fact_observations` has one fact (`fact_id`) per row and retains period, filing, retrieval, artifact observation, and member hash. `gold.market_daily_totals` has one `(file_id, trade_date)` row and a participant count for reconciliation. `gold.topology_current_review` has one candidate (`candidate_id`) row with its latest decision, including unresolved and rejected candidates; source publication, retrieval, and review times remain separate. It is not a historical cutoff query.

## flow and next migration boundary

New acquisition writes exact bytes and attempts before parsing. Bronze adds source-faithful rows with a raw parent. Silver adds explicit identity, scoped claims, and append-only review. Gold may aggregate or select only from identified upstream records and must retain enough IDs, clocks, and version hashes to replay the build. A missing source is recorded as an attempt or unresolved review, never as a false claim.

Current scripts still write `public` tables and the static JSON export still reads its established queries. The next migration can move physical storage and writers one family at a time only after a backfill/reconciliation test proves identical row counts, keys, hashes, and foreign-key targets; changing `search_path` alone would make `INSERT ... ON CONFLICT` behavior and external callers ambiguous. Repository source artifacts and seed JSON must also be inventoried before calling the database the sole home of every record. This first step makes their layer destination explicit without pretending that those files have already moved.
