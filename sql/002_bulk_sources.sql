ALTER TABLE snapshots DROP CONSTRAINT snapshots_provider_check;
ALTER TABLE snapshots ADD CONSTRAINT snapshots_provider_check
    CHECK (provider IN ('wayback', 'commoncrawl'));
ALTER TABLE snapshots ADD COLUMN provider_record_id text;
ALTER TABLE snapshots ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE snapshots SET provider_record_id = archive_url WHERE provider = 'wayback';
CREATE UNIQUE INDEX snapshots_provider_identity
    ON snapshots(source_id, provider, provider_record_id)
    WHERE provider_record_id IS NOT NULL;

CREATE TABLE market_files (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider text NOT NULL CHECK (provider = 'cboe'),
    source_url text NOT NULL,
    study_year integer NOT NULL CHECK (study_year BETWEEN 2021 AND 2024),
    raw_csv bytea NOT NULL,
    raw_sha256 char(64) NOT NULL,
    parser_version integer NOT NULL,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider, source_url, raw_sha256)
);

CREATE TABLE market_daily (
    file_id bigint NOT NULL REFERENCES market_files(id),
    row_number integer NOT NULL,
    trade_date date NOT NULL,
    market_participant text NOT NULL,
    tape_a_shares bigint NOT NULL,
    tape_b_shares bigint NOT NULL,
    tape_c_shares bigint NOT NULL,
    total_shares bigint NOT NULL,
    tape_a_notional numeric NOT NULL,
    tape_b_notional numeric NOT NULL,
    tape_c_notional numeric NOT NULL,
    total_notional numeric NOT NULL,
    tape_a_trade_count bigint NOT NULL,
    tape_b_trade_count bigint NOT NULL,
    tape_c_trade_count bigint NOT NULL,
    total_trade_count bigint NOT NULL,
    PRIMARY KEY(file_id, row_number),
    UNIQUE(file_id, trade_date, market_participant)
);
CREATE INDEX market_daily_by_date ON market_daily(trade_date);
