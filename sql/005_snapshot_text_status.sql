ALTER TABLE snapshots ADD COLUMN text_status text NOT NULL DEFAULT 'extractable'
    CHECK (text_status IN ('extractable', 'short'));
UPDATE snapshots SET text_status = 'short' WHERE length(normalized_text) < 100;
