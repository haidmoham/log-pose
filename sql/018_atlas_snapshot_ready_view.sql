-- Gold serves only snapshots that completed publication maintenance. Keep the
-- readiness columns visible without exposing an unpublished immutable build.
CREATE OR REPLACE VIEW gold.atlas_snapshot AS
SELECT build_id,manifest,ready,prepared_at
FROM public.atlas_snapshot
WHERE ready;
