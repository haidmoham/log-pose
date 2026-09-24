CREATE TABLE discovery_artifacts (
    raw_sha256 text PRIMARY KEY CHECK (length(raw_sha256) = 64),
    source text NOT NULL,
    repository text NOT NULL,
    study_year integer NOT NULL CHECK (study_year BETWEEN 2020 AND 2026),
    source_commit text NOT NULL,
    source_committed_at timestamptz NOT NULL,
    source_url text NOT NULL,
    observation_basis text NOT NULL CHECK (observation_basis = 'point_in_time_repository_state'),
    coverage_status text NOT NULL CHECK (coverage_status IN ('dated_inventory_snapshot', 'partial_year_snapshot')),
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    raw_yaml bytea NOT NULL,
    parser_version integer NOT NULL,
    mapping_version text NOT NULL,
    UNIQUE(source, repository, study_year, source_commit)
);

COMMENT ON TABLE discovery_artifacts IS
    'One immutable pinned directory artifact. raw_sha256 identifies exact bytes; source_committed_at is source time and retrieved_at is arrival time.';

CREATE TABLE discovery_occurrences (
    id text PRIMARY KEY CHECK (length(id) = 20),
    artifact_sha256 text NOT NULL REFERENCES discovery_artifacts(raw_sha256),
    source_path integer[] NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    homepage_url text NOT NULL,
    repo_url text NOT NULL,
    source_category text NOT NULL,
    source_subcategory text NOT NULL,
    candidate_tags text[] NOT NULL,
    UNIQUE(artifact_sha256, source_path)
);

CREATE INDEX discovery_occurrences_by_category
    ON discovery_occurrences(source_category, source_subcategory);

COMMENT ON TABLE discovery_occurrences IS
    'One tagged product/project directory row at one source path in one immutable artifact. It is a candidate lead, not a company, U.S. eligibility, or operating-status record.';

CREATE TABLE discovery_inventory_rows (
    id text PRIMARY KEY CHECK (length(id) = 20),
    artifact_sha256 text NOT NULL REFERENCES discovery_artifacts(raw_sha256),
    source_path integer[] NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    homepage_url text NOT NULL,
    repo_url text NOT NULL,
    source_category text NOT NULL,
    source_subcategory text NOT NULL,
    candidate_tags text[] NOT NULL,
    mapping_status text NOT NULL CHECK (mapping_status IN ('mapped_category', 'unmapped_category')),
    record_type text NOT NULL CHECK (record_type IN ('product_or_project_candidate', 'unmapped_directory_row')),
    UNIQUE(artifact_sha256, source_path)
);

CREATE INDEX discovery_inventory_rows_by_artifact_type
    ON discovery_inventory_rows(artifact_sha256, record_type);

COMMENT ON TABLE discovery_inventory_rows IS
    'One parsed dictionary item per original directory source path, including unmapped category rows. Empty candidate_tags and unmapped_directory_row mean no current category mapping; rows are not companies or eligibility decisions.';
