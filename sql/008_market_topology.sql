-- Source artifacts and interpretations have separate grains. An inventory item is
-- a lead, not a company or an asserted relationship.
CREATE TABLE topology_sources (
    id text PRIMARY KEY,
    source_url text NOT NULL,
    publisher text NOT NULL,
    title text NOT NULL,
    source_type text NOT NULL,
    published_on date,
    captured_at timestamptz,
    retrieved_at timestamptz NOT NULL,
    raw_body bytea,
    raw_sha256 char(64),
    snapshot_id bigint REFERENCES snapshots(id),
    retrieval_status text NOT NULL CHECK (retrieval_status IN ('retrieved', 'failed')),
    error text,
    CHECK (source_url ~ '^https://'),
    CHECK (raw_sha256 IS NULL OR raw_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK ((retrieval_status = 'retrieved' AND raw_sha256 IS NOT NULL
            AND (raw_body IS NOT NULL OR snapshot_id IS NOT NULL) AND error IS NULL)
        OR (retrieval_status = 'failed' AND raw_body IS NULL
            AND snapshot_id IS NULL AND raw_sha256 IS NULL AND error IS NOT NULL))
);

COMMENT ON TABLE topology_sources IS
    'One retrieved artifact or failed retrieval. published_on is public source time, captured_at is archive time, and retrieved_at is local arrival time.';

CREATE TABLE topology_entities (
    id text PRIMARY KEY,
    name text NOT NULL,
    entity_kind text NOT NULL CHECK (entity_kind IN ('company', 'product', 'project', 'unresolved')),
    identity_status text NOT NULL CHECK (identity_status IN ('lead', 'reviewed', 'unresolved')),
    pilot_company_id bigint UNIQUE REFERENCES companies(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topology_entity_aliases (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_id text NOT NULL REFERENCES topology_entities(id),
    alias text NOT NULL,
    alias_kind text NOT NULL CHECK (alias_kind IN ('name', 'domain', 'cik', 'source_key')),
    valid_from date,
    valid_to date,
    source_id text REFERENCES topology_sources(id),
    CHECK (valid_to IS NULL OR valid_from IS NOT NULL),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    UNIQUE (entity_id, alias_kind, alias, valid_from)
);

CREATE INDEX topology_alias_lookup ON topology_entity_aliases(alias_kind, alias);

CREATE TABLE topology_eligibility_reviews (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_id text NOT NULL REFERENCES topology_entities(id),
    universe_status text NOT NULL CHECK (universe_status IN ('included', 'excluded', 'unresolved')),
    source_id text NOT NULL REFERENCES topology_sources(id),
    reviewer text NOT NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    rationale text NOT NULL,
    CHECK (length(trim(rationale)) > 0)
);

CREATE INDEX topology_eligibility_latest
    ON topology_eligibility_reviews(entity_id, reviewed_at DESC, id DESC);

CREATE TABLE topology_acquisition_jobs (
    id text PRIMARY KEY,
    source_url text NOT NULL CHECK (source_url ~ '^https://'),
    source_family text NOT NULL,
    source_key text NOT NULL,
    target_entity_id text REFERENCES topology_entities(id),
    status text NOT NULL CHECK (status IN ('pending', 'running', 'retrieved', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_attempt_at timestamptz,
    source_id text REFERENCES topology_sources(id),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_family, source_key, source_url)
);

CREATE INDEX topology_jobs_pending ON topology_acquisition_jobs(status, attempts, created_at);

-- One proposal from one source about an ordered pair, predicate, and scope.
-- The same pair may have competing and collaborative claims at once.
CREATE TABLE topology_candidates (
    id text PRIMARY KEY,
    source_id text NOT NULL REFERENCES topology_sources(id),
    subject_entity_id text NOT NULL REFERENCES topology_entities(id),
    object_entity_id text NOT NULL REFERENCES topology_entities(id),
    predicate text NOT NULL CHECK (predicate IN (
        'possible_substitute_for', 'named_competitor_of', 'integrates_with',
        'announced_partnership_with', 'invested_in', 'shared_exposure_hypothesis')),
    direction text NOT NULL CHECK (direction IN ('subject_to_object', 'object_to_subject', 'symmetric')),
    scope text NOT NULL,
    evidence_locator text NOT NULL,
    evidence_text text NOT NULL,
    interpretation text NOT NULL,
    alternative_or_unknown text NOT NULL,
    event_on date,
    period_start date,
    period_end date,
    proposed_basis text NOT NULL CHECK (proposed_basis IN ('source_statement', 'reviewed_inference', 'hypothesis')),
    generator text NOT NULL,
    generator_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (subject_entity_id <> object_entity_id),
    CHECK (period_end IS NULL OR period_start IS NOT NULL),
    CHECK (period_end IS NULL OR period_end >= period_start)
);

CREATE INDEX topology_candidates_subject ON topology_candidates(subject_entity_id, created_at);
CREATE INDEX topology_candidates_object ON topology_candidates(object_entity_id, created_at);
CREATE INDEX topology_candidates_source ON topology_candidates(source_id);

-- Re-review adds a row. The latest decision at a knowledge cutoff controls a
-- projection without rewriting the candidate or its source artifact.
CREATE TABLE topology_reviews (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id text NOT NULL REFERENCES topology_candidates(id),
    decision text NOT NULL CHECK (decision IN ('accept', 'reject', 'needs_evidence')),
    reviewer text NOT NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    rationale text NOT NULL,
    CHECK (length(trim(rationale)) > 0)
);

CREATE INDEX topology_reviews_latest ON topology_reviews(candidate_id, reviewed_at DESC, id DESC);

CREATE TABLE topology_graph_builds (
    id text PRIMARY KEY,
    built_at timestamptz NOT NULL DEFAULT now(),
    source_date_cutoff date,
    review_cutoff timestamptz NOT NULL,
    generator_version text NOT NULL,
    input_sha256 char(64) NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
    output_sha256 char(64) NOT NULL CHECK (output_sha256 ~ '^[0-9a-f]{64}$'),
    candidate_count integer NOT NULL CHECK (candidate_count >= 0),
    accepted_count integer NOT NULL CHECK (accepted_count >= 0)
);
