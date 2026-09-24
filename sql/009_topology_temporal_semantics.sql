-- A publication date, an event date, a reporting period, and the interval
-- during which a relationship holds are separate clocks.
ALTER TABLE topology_candidates
    ADD COLUMN temporal_form text NOT NULL DEFAULT 'unknown'
        CHECK (temporal_form IN ('event', 'observed_state', 'explicit_interval', 'unknown')),
    ADD COLUMN temporal_basis text NOT NULL DEFAULT 'Not yet reviewed',
    ADD COLUMN valid_from date,
    ADD COLUMN valid_to date,
    ADD CONSTRAINT topology_candidate_temporal_shape CHECK (
        (temporal_form = 'event' AND event_on IS NOT NULL
            AND valid_from IS NULL AND valid_to IS NULL)
        OR (temporal_form = 'explicit_interval' AND valid_from IS NOT NULL
            AND valid_to IS NOT NULL AND valid_to >= valid_from)
        OR (temporal_form IN ('observed_state', 'unknown')
            AND valid_from IS NULL AND valid_to IS NULL));

ALTER TABLE topology_candidates
    ADD CONSTRAINT topology_candidate_temporal_basis_present
    CHECK (length(trim(temporal_basis)) > 0);

COMMENT ON COLUMN topology_candidates.period_start IS
    'Start of a period reported by the source; not relationship validity.';
COMMENT ON COLUMN topology_candidates.period_end IS
    'End of a period reported by the source; not relationship validity.';
COMMENT ON COLUMN topology_candidates.valid_from IS
    'Relationship validity starts here only when the source establishes an explicit interval.';
COMMENT ON COLUMN topology_candidates.valid_to IS
    'Relationship validity ends here only when the source establishes an explicit interval.';
