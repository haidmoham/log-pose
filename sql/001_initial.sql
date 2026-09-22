CREATE TABLE IF NOT EXISTS companies (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL REFERENCES companies(id),
    original_url text NOT NULL,
    purpose text NOT NULL,
    UNIQUE(company_id, original_url)
);
CREATE TABLE IF NOT EXISTS snapshots (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES sources(id),
    provider text NOT NULL CHECK (provider = 'wayback'),
    archive_url text NOT NULL,
    captured_at timestamptz NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    status_code integer NOT NULL,
    content_type text NOT NULL,
    raw_html bytea NOT NULL,
    raw_sha256 char(64) NOT NULL,
    normalized_text text NOT NULL,
    text_sha256 char(64) NOT NULL,
    normalizer_version integer NOT NULL,
    UNIQUE(source_id, provider, captured_at)
);
CREATE INDEX IF NOT EXISTS snapshots_cutoff ON snapshots(source_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS ingestion_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES sources(id),
    requested_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    target_cutoff timestamptz NOT NULL,
    requested_capture text,
    resolved_archive_url text,
    outcome text CHECK (outcome IN ('stored','duplicate','missing','failed')),
    detail text
);
