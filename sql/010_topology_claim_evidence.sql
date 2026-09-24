-- One candidate may need several independent premises. Keep each source and
-- passage separate; the primary source remains on topology_candidates.
CREATE TABLE topology_candidate_evidence (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id text NOT NULL REFERENCES topology_candidates(id),
    source_id text NOT NULL REFERENCES topology_sources(id),
    evidence_role text NOT NULL CHECK (evidence_role IN ('support', 'contradict')),
    evidence_locator text NOT NULL,
    evidence_summary text NOT NULL,
    exact_quote text,
    event_on date,
    period_start date,
    period_end date,
    added_at timestamptz NOT NULL DEFAULT now(),
    CHECK (period_end IS NULL OR period_start IS NOT NULL),
    CHECK (period_end IS NULL OR period_end >= period_start),
    UNIQUE (candidate_id, source_id, evidence_role, evidence_locator)
);

COMMENT ON TABLE topology_candidate_evidence IS
    'One additional source passage for a candidate. Evidence summaries are paraphrases; exact_quote is only for retained verbatim text.';
