ALTER TABLE ingestion_attempts ADD COLUMN index_attempts integer;
ALTER TABLE ingestion_attempts ADD COLUMN index_rows integer;
ALTER TABLE ingestion_attempts ADD COLUMN compressed_bytes bigint;
ALTER TABLE ingestion_attempts ADD COLUMN elapsed_ms integer;
