-- Preserve reconstructed topology without pretending that missing historical
-- arrival clocks were observed. Existing rows keep their known write clocks.
ALTER TABLE topology_entities
    ADD COLUMN original_created_at timestamptz,
    ADD COLUMN reconstruction_arrived_at timestamptz;
UPDATE topology_entities SET original_created_at=created_at
WHERE original_created_at IS NULL;
ALTER TABLE topology_entities ALTER COLUMN original_created_at SET DEFAULT now();

ALTER TABLE topology_candidates
    ADD COLUMN original_created_at timestamptz,
    ADD COLUMN reconstruction_arrived_at timestamptz;
UPDATE topology_candidates SET original_created_at=created_at
WHERE original_created_at IS NULL;
ALTER TABLE topology_candidates ALTER COLUMN original_created_at SET DEFAULT now();

ALTER TABLE topology_candidate_evidence
    ADD COLUMN original_added_at timestamptz,
    ADD COLUMN reconstruction_arrived_at timestamptz;
UPDATE topology_candidate_evidence SET original_added_at=added_at
WHERE original_added_at IS NULL;
ALTER TABLE topology_candidate_evidence ALTER COLUMN original_added_at SET DEFAULT now();

CREATE TABLE topology_reconstruction_batches (
    id text PRIMARY KEY,
    projection_sha256 char(64) NOT NULL CHECK (projection_sha256 ~ '^[0-9a-f]{64}$'),
    reconstructed_at timestamptz NOT NULL,
    input_manifest jsonb NOT NULL,
    CHECK (jsonb_typeof(input_manifest) = 'object')
);

CREATE TABLE topology_reconstruction_records (
    batch_id text NOT NULL REFERENCES topology_reconstruction_batches(id),
    record_kind text NOT NULL CHECK (record_kind IN ('source','entity','candidate','evidence','review')),
    record_key text NOT NULL,
    original_id text,
    original_arrival_at timestamptz,
    reconstruction_arrived_at timestamptz NOT NULL,
    unknown_fields text[] NOT NULL DEFAULT '{}',
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (record_kind, record_key),
    CHECK (jsonb_typeof(detail) = 'object')
);

CREATE VIEW raw.topology_reconstruction_batches AS
SELECT * FROM public.topology_reconstruction_batches;
CREATE VIEW raw.topology_reconstruction_records AS
SELECT * FROM public.topology_reconstruction_records;
CREATE VIEW bronze.topology_reconstruction_inputs AS
SELECT batch_id,record_kind,record_key,original_id,original_arrival_at,
       reconstruction_arrived_at,unknown_fields,detail
FROM raw.topology_reconstruction_records;
CREATE VIEW silver.topology_reconstruction_records AS
SELECT * FROM bronze.topology_reconstruction_inputs;
CREATE VIEW gold.topology_reconstruction_status AS
SELECT batch.id,batch.projection_sha256,batch.reconstructed_at,
       count(record.record_key)::integer AS record_count,
       count(record.record_key) FILTER (WHERE record.original_arrival_at IS NULL)::integer AS unknown_arrival_count
FROM raw.topology_reconstruction_batches AS batch
LEFT JOIN silver.topology_reconstruction_records AS record ON record.batch_id=batch.id
GROUP BY batch.id,batch.projection_sha256,batch.reconstructed_at;

COMMENT ON TABLE topology_reconstruction_records IS
    'One reconstructed topology record. original_arrival_at stays NULL when the retained projection did not export that clock; reconstruction_arrived_at is the new local write time.';
