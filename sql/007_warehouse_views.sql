CREATE SCHEMA IF NOT EXISTS warehouse;

CREATE VIEW warehouse.page_observations AS
SELECT
    snapshot.id AS observation_id,
    company.id AS company_id,
    company.slug AS company_slug,
    company.name AS company_name,
    source.id AS source_id,
    source.original_url,
    source.purpose AS source_purpose,
    snapshot.provider,
    snapshot.provider_record_id,
    snapshot.archive_url,
    snapshot.captured_at,
    snapshot.ingested_at,
    snapshot.status_code,
    snapshot.content_type,
    snapshot.raw_sha256,
    snapshot.text_sha256,
    snapshot.normalizer_version,
    snapshot.provenance,
    snapshot.text_status,
    snapshot.normalized_text
FROM snapshots AS snapshot
JOIN sources AS source ON source.id = snapshot.source_id
JOIN companies AS company ON company.id = source.company_id;

COMMENT ON VIEW warehouse.page_observations IS
    'One row per immutable snapshot observation. observation_id is the key; captured_at is source time, ingested_at is warehouse arrival time, and provider_record_id plus hashes preserve provenance.';

CREATE VIEW warehouse.sec_fact_observations AS
SELECT
    fact.id AS fact_id,
    member.id AS companyfacts_id,
    member.cik,
    member.entity_name,
    member.member_name,
    member.raw_sha256,
    member.retrieved_at,
    artifact.artifact_version,
    artifact.source_url AS artifact_source_url,
    artifact.etag AS artifact_etag,
    artifact.last_modified AS artifact_last_modified,
    artifact.observed_at AS artifact_observed_at,
    fact.concept_group,
    fact.taxonomy,
    fact.tag,
    fact.unit,
    fact.fact_index,
    fact.value,
    fact.start_date,
    fact.end_date,
    fact.filed_date,
    fact.accession_number,
    fact.form,
    fact.fy,
    fact.fp,
    fact.frame
FROM sec_financial_facts AS fact
JOIN sec_companyfacts AS member ON member.id = fact.companyfacts_id
JOIN sec_artifacts AS artifact ON artifact.artifact_version = member.artifact_version;

COMMENT ON VIEW warehouse.sec_fact_observations IS
    'One row per retained SEC fact candidate. fact_id is the key; start_date/end_date are fact period time, filed_date is filing time, retrieved_at is arrival time, and artifact metadata identifies the immutable source ZIP.';

CREATE VIEW warehouse.market_daily_totals AS
SELECT
    daily.file_id,
    daily.trade_date,
    count(*)::bigint AS participant_rows,
    sum(daily.total_shares) AS total_shares,
    sum(daily.total_notional) AS total_notional,
    sum(daily.total_trade_count) AS total_trade_count,
    sum(daily.total_shares) FILTER (
        WHERE daily.market_participant LIKE 'FINRA /%'
    ) AS trf_shares
FROM market_daily AS daily
GROUP BY daily.file_id, daily.trade_date;

COMMENT ON VIEW warehouse.market_daily_totals IS
    'One row per source file and trade date. (file_id, trade_date) is the key; measures sum participant rows exactly once and retain participant_rows for reconciliation to the source file.';
