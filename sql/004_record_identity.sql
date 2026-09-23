ALTER TABLE snapshots DROP CONSTRAINT snapshots_source_id_provider_captured_at_key;
DROP INDEX snapshots_provider_identity;
ALTER TABLE snapshots ALTER COLUMN provider_record_id SET NOT NULL;
CREATE UNIQUE INDEX snapshots_provider_identity
    ON snapshots(provider, provider_record_id);
