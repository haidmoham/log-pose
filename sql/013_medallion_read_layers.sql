-- First medallion seam: one read path per durable record family.
-- Existing public tables retain their IDs, writes, constraints, and foreign keys.
CREATE SCHEMA raw;
CREATE SCHEMA bronze;
CREATE SCHEMA silver;
CREATE SCHEMA gold;

-- Raw retains exact source payloads and acquisition attempts, including failures.
CREATE VIEW raw.snapshots AS SELECT * FROM public.snapshots;
CREATE VIEW raw.ingestion_attempts AS SELECT * FROM public.ingestion_attempts;
CREATE VIEW raw.market_files AS SELECT * FROM public.market_files;
CREATE VIEW raw.sec_artifacts AS SELECT * FROM public.sec_artifacts;
CREATE VIEW raw.sec_companyfacts AS SELECT * FROM public.sec_companyfacts;
CREATE VIEW raw.topology_sources AS SELECT * FROM public.topology_sources;
CREATE VIEW raw.topology_acquisition_jobs AS SELECT * FROM public.topology_acquisition_jobs;
CREATE VIEW raw.discovery_artifacts AS SELECT * FROM public.discovery_artifacts;

-- Bronze contains source-faithful parsed rows; it does not assert entity truth.
CREATE VIEW bronze.market_daily AS SELECT * FROM public.market_daily;
CREATE VIEW bronze.sec_financial_facts AS SELECT * FROM public.sec_financial_facts;
CREATE VIEW bronze.discovery_occurrences AS SELECT * FROM public.discovery_occurrences;
CREATE VIEW bronze.discovery_inventory_rows AS SELECT * FROM public.discovery_inventory_rows;

-- Silver holds explicit identity, scoped interpretation, and append-only review.
CREATE VIEW silver.companies AS SELECT * FROM public.companies;
CREATE VIEW silver.sources AS SELECT * FROM public.sources;
CREATE VIEW silver.topology_entities AS SELECT * FROM public.topology_entities;
CREATE VIEW silver.topology_entity_aliases AS SELECT * FROM public.topology_entity_aliases;
CREATE VIEW silver.topology_eligibility_reviews AS SELECT * FROM public.topology_eligibility_reviews;
CREATE VIEW silver.topology_candidates AS SELECT * FROM public.topology_candidates;
CREATE VIEW silver.topology_candidate_evidence AS SELECT * FROM public.topology_candidate_evidence;
CREATE VIEW silver.topology_reviews AS SELECT * FROM public.topology_reviews;
CREATE VIEW silver.page_observations AS SELECT * FROM warehouse.page_observations;
CREATE VIEW silver.sec_fact_observations AS SELECT * FROM warehouse.sec_fact_observations;

-- Gold is a reproducible read model. Build records keep their original IDs.
CREATE VIEW gold.topology_graph_builds AS SELECT * FROM public.topology_graph_builds;
CREATE VIEW gold.market_daily_totals AS SELECT * FROM warehouse.market_daily_totals;

CREATE VIEW gold.topology_current_review AS
SELECT candidate.id AS candidate_id,
       candidate.subject_entity_id,
       candidate.object_entity_id,
       candidate.predicate,
       candidate.scope,
       candidate.proposed_basis,
       candidate.source_id,
       source.published_on,
       source.retrieved_at,
       review.id AS review_id,
       review.decision,
       review.reviewer,
       review.rationale,
       review.reviewed_at
FROM silver.topology_candidates AS candidate
JOIN raw.topology_sources AS source ON source.id = candidate.source_id
LEFT JOIN LATERAL (
    SELECT id, decision, reviewer, rationale, reviewed_at
    FROM silver.topology_reviews
    WHERE candidate_id = candidate.id
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 1
) AS review ON true;

COMMENT ON VIEW gold.topology_current_review IS
    'One row per candidate, including unresolved and rejected candidates. Latest review is a current projection, not historical replay or a probability. Candidate ID is the key; source publication, retrieval, and review times remain separate.';
