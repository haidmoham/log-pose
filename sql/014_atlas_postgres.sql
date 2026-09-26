-- Immutable atlas serving snapshots remain derivatives of retained evidence.
CREATE TABLE public.atlas_snapshot (
    build_id text PRIMARY KEY CHECK (build_id ~ '^[a-f0-9]{64}$'),
    manifest jsonb NOT NULL
);

CREATE TABLE public.atlas_current (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    build_id text NOT NULL REFERENCES public.atlas_snapshot(build_id)
);

CREATE TABLE public.atlas_candidate (
    build_id text NOT NULL REFERENCES public.atlas_snapshot(build_id),
    id text NOT NULL,
    name text NOT NULL,
    summary_json jsonb NOT NULL,
    search_text tsvector NOT NULL,
    PRIMARY KEY (build_id, id)
);

CREATE TABLE public.atlas_artifact (
    build_id text NOT NULL REFERENCES public.atlas_snapshot(build_id),
    id text NOT NULL,
    source text NOT NULL,
    inventory_year integer NOT NULL,
    raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
    detail_json jsonb NOT NULL,
    PRIMARY KEY (build_id, id)
);

CREATE TABLE public.atlas_placement (
    build_id text NOT NULL,
    id text NOT NULL,
    artifact_id text NOT NULL,
    category text NOT NULL,
    member_count integer NOT NULL CHECK (member_count >= 0),
    PRIMARY KEY (build_id, id),
    FOREIGN KEY (build_id, artifact_id)
        REFERENCES public.atlas_artifact(build_id, id)
);

CREATE TABLE public.atlas_membership (
    build_id text NOT NULL,
    candidate_id text NOT NULL,
    placement_id text NOT NULL,
    detail_json jsonb NOT NULL,
    PRIMARY KEY (build_id, candidate_id, placement_id),
    FOREIGN KEY (build_id, candidate_id)
        REFERENCES public.atlas_candidate(build_id, id),
    FOREIGN KEY (build_id, placement_id)
        REFERENCES public.atlas_placement(build_id, id)
);

CREATE INDEX atlas_candidate_search
    ON public.atlas_candidate USING gin(search_text);
CREATE INDEX atlas_artifact_source_year
    ON public.atlas_artifact(build_id, source, inventory_year, id);
CREATE INDEX atlas_placement_artifact_category
    ON public.atlas_placement(build_id, artifact_id, category, id);
CREATE INDEX atlas_membership_placement_candidate
    ON public.atlas_membership(build_id, placement_id, candidate_id);

CREATE VIEW gold.atlas_snapshot AS SELECT * FROM public.atlas_snapshot;
CREATE VIEW gold.atlas_current AS SELECT * FROM public.atlas_current;
CREATE VIEW gold.atlas_candidate AS SELECT * FROM public.atlas_candidate;
CREATE VIEW gold.atlas_artifact AS SELECT * FROM public.atlas_artifact;
CREATE VIEW gold.atlas_placement AS SELECT * FROM public.atlas_placement;
CREATE VIEW gold.atlas_membership AS SELECT * FROM public.atlas_membership;

COMMENT ON TABLE public.atlas_snapshot IS
    'One immutable atlas gold read snapshot. The JSON manifest binds inputs, versions, clocks, counts, and the validated SQLite derivative.';
COMMENT ON TABLE public.atlas_membership IS
    'One candidate membership in one exact artifact/category placement. detail_json preserves source occurrence IDs and rows; this is unreviewed inventory evidence, not a company relationship.';
