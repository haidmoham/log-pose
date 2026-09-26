-- PostgreSQL expands SELECT * when a view is created. Refresh the three
-- lossless silver views after migration 016 appended provenance clocks.
CREATE OR REPLACE VIEW silver.topology_entities AS
SELECT * FROM public.topology_entities;

CREATE OR REPLACE VIEW silver.topology_candidates AS
SELECT * FROM public.topology_candidates;

CREATE OR REPLACE VIEW silver.topology_candidate_evidence AS
SELECT * FROM public.topology_candidate_evidence;

-- Migration 015 added publication-readiness columns after the gold view was
-- first declared in migration 014; refresh that lossless view as well.
CREATE OR REPLACE VIEW gold.atlas_snapshot AS
SELECT * FROM public.atlas_snapshot;
