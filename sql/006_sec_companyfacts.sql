CREATE TABLE sec_artifacts (
    artifact_version char(64) PRIMARY KEY,
    source_url text NOT NULL,
    etag text NOT NULL,
    last_modified text NOT NULL,
    content_length bigint NOT NULL CHECK (content_length > 0),
    observed_at timestamptz NOT NULL,
    UNIQUE (source_url, etag, last_modified, content_length)
);

CREATE TABLE sec_companyfacts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    artifact_version char(64) NOT NULL REFERENCES sec_artifacts(artifact_version),
    cik char(10) NOT NULL CHECK (cik ~ '^[0-9]{10}$'),
    member_name text NOT NULL,
    entity_name text NOT NULL,
    raw_json bytea NOT NULL,
    raw_sha256 char(64) NOT NULL,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (artifact_version, cik),
    UNIQUE (artifact_version, member_name)
);

CREATE TABLE sec_financial_facts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    companyfacts_id bigint NOT NULL REFERENCES sec_companyfacts(id),
    concept_group text NOT NULL CHECK (concept_group IN ('revenue', 'net_income', 'assets')),
    taxonomy text NOT NULL,
    tag text NOT NULL,
    unit text NOT NULL,
    fact_index integer NOT NULL CHECK (fact_index >= 0),
    value numeric NOT NULL,
    start_date date,
    end_date date NOT NULL,
    filed_date date NOT NULL,
    accession_number text,
    form text,
    fy integer,
    fp text,
    frame text,
    CHECK ((concept_group = 'assets' AND start_date IS NULL)
        OR (concept_group <> 'assets' AND start_date IS NOT NULL)),
    UNIQUE (companyfacts_id, taxonomy, tag, unit, fact_index)
);

CREATE INDEX sec_financial_facts_by_period
    ON sec_financial_facts(concept_group, end_date, filed_date);
CREATE INDEX sec_companyfacts_by_cik
    ON sec_companyfacts(cik, artifact_version);
