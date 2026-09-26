-- Existing snapshots stay available. A rerun records their maintenance time.
ALTER TABLE public.atlas_snapshot
    ADD COLUMN ready boolean NOT NULL DEFAULT true,
    ADD COLUMN prepared_at timestamptz;

CREATE OR REPLACE VIEW gold.atlas_snapshot AS
SELECT build_id,manifest FROM public.atlas_snapshot WHERE ready;

CREATE OR REPLACE VIEW gold.atlas_current AS
SELECT current_snapshot.singleton,current_snapshot.build_id
FROM public.atlas_current AS current_snapshot
JOIN public.atlas_snapshot AS snapshot
  ON snapshot.build_id=current_snapshot.build_id
WHERE snapshot.ready;

COMMENT ON COLUMN public.atlas_snapshot.ready IS
    'False while a validated immutable build awaits serving-table VACUUM/ANALYZE and final reconciliation.';
COMMENT ON COLUMN public.atlas_snapshot.prepared_at IS
    'Operational publication time after serving-table maintenance; not source time or claim validity time.';
