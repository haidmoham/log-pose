"""Topology storage checks against an explicitly disposable Postgres database."""

import os
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from log_pose.storage import migrate
from log_pose.topology_store import (
    add_candidate_evidence, claim_acquisitions, ensure_entity, finish_acquisition, plan_acquisition,
    record_eligibility_review, record_review, reviewed_claims, store_candidate,
    store_source,
)


@pytest.fixture
def db():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        migrate(conn)
        with conn.cursor() as cur:
            cur.execute("""TRUNCATE topology_graph_builds, topology_reviews,
                topology_candidates, topology_acquisition_jobs,
                topology_eligibility_reviews, topology_entity_aliases,
                topology_entities, topology_sources CASCADE""")
            cur.execute("""TRUNCATE discovery_inventory_rows, discovery_occurrences,
                discovery_artifacts CASCADE""")
        conn.commit()
        yield conn


def test_immutable_sources_and_reviewed_temporal_projection(db):
    retrieved_at = datetime(2026, 9, 24, tzinfo=timezone.utc)
    source_args = dict(
        source_id="s1", source_url="https://example.com/announcement",
        publisher="Example", title="Announcement", source_type="company announcement",
        published_on=date(2022, 2, 24), retrieved_at=retrieved_at,
        raw_body=b"Example and Other announced an integration.",
    )
    assert store_source(db, **source_args) == "stored"
    assert store_source(db, **source_args) == "duplicate"
    with pytest.raises(ValueError, match="different evidence"):
        store_source(db, **{**source_args, "raw_body": b"changed"})
    db.rollback()

    ensure_entity(db, entity_id="example", name="Example", entity_kind="company")
    ensure_entity(db, entity_id="other", name="Other", entity_kind="company")
    candidate_args = dict(candidate_id="c1", source_id="s1",
                          subject_entity_id="example", object_entity_id="other",
                          predicate="integrates_with", direction="subject_to_object",
                          scope="analytics ingestion", evidence_locator="paragraph 2",
                          evidence_text="Example and Other announced an integration.",
                          exact_quote="Example and Other announced an integration.",
                          interpretation="An integration was announced.",
                          alternative_or_unknown="Ongoing availability is unknown.",
                          temporal_form="event", temporal_basis="Announcement date",
                          proposed_basis="source_statement", generator="manual",
                          generator_version="1", event_on=date(2022, 2, 24))
    assert store_candidate(db, **candidate_args) == "stored"
    assert store_candidate(db, **candidate_args) == "duplicate"
    assert reviewed_claims(db) == []

    # The knowledge cutoff must follow the candidate's actual insertion time.
    accepted_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    record_review(db, candidate_id="c1", decision="accept", reviewer="test",
                  rationale="Exact statement in retained artifact", reviewed_at=accepted_at)
    assert reviewed_claims(db, source_date_cutoff=date(2021, 12, 31)) == []
    assert reviewed_claims(db, review_cutoff=datetime(2026, 9, 23, tzinfo=timezone.utc)) == []
    rows = reviewed_claims(db, source_date_cutoff=date(2022, 12, 31),
                           review_cutoff=accepted_at, entity_id="other")
    assert len(rows) == 1
    assert rows[0]["event_on"] == date(2022, 2, 24)
    assert rows[0]["published_on"] == date(2022, 2, 24)
    assert rows[0]["retrieved_at"] == retrieved_at
    assert rows[0]["temporal_form"] == "event"
    assert rows[0]["exact_quote"] == "Example and Other announced an integration."
    assert rows[0]["valid_from"] is None

    rejected_at = accepted_at + timedelta(days=1)
    record_review(db, candidate_id="c1", decision="needs_evidence", reviewer="test",
                  rationale="Duration is not established", reviewed_at=rejected_at)
    assert len(reviewed_claims(db, review_cutoff=accepted_at)) == 1
    assert reviewed_claims(db, review_cutoff=rejected_at) == []


def test_broad_category_does_not_create_an_edge(db):
    ensure_entity(db, entity_id="one", name="One", entity_kind="company")
    ensure_entity(db, entity_id="two", name="Two", entity_kind="company")
    assert reviewed_claims(db, entity_id="one") == []
    with pytest.raises(ValueError, match="invalid neighborhood page"):
        reviewed_claims(db, limit=501)


def test_acquisition_queue_recovers_a_stale_lease_and_keeps_eligibility_separate(db):
    assert plan_acquisition(db, job_id="j1", source_url="https://example.com/a",
                            source_family="first_party", source_key="a") == "stored"
    assert plan_acquisition(db, job_id="j1", source_url="https://example.com/a",
                            source_family="first_party", source_key="a") == "duplicate"
    assert claim_acquisitions(db, limit=1)[0]["attempts"] == 1
    assert claim_acquisitions(db, limit=1) == []
    with db.cursor() as cur:
        cur.execute("""UPDATE topology_acquisition_jobs
            SET last_attempt_at='2020-01-01T00:00:00Z' WHERE id='j1'""")
    db.commit()
    assert claim_acquisitions(db, limit=1)[0]["attempts"] == 2
    finish_acquisition(db, job_id="j1", error="temporary timeout")
    assert claim_acquisitions(db, limit=1)[0]["attempts"] == 3
    assert claim_acquisitions(db, limit=1) == []

    retrieved_at = datetime(2026, 9, 24, tzinfo=timezone.utc)
    store_source(db, source_id="eligibility-source",
                 source_url="https://example.com/about", publisher="Example",
                 title="About", source_type="company page", retrieved_at=retrieved_at,
                 raw_body=b"Example company statement")
    ensure_entity(db, entity_id="unknown", name="Unknown", entity_kind="company",
                  identity_status="unresolved")
    record_eligibility_review(db, entity_id="unknown", universe_status="unresolved",
                              source_id="eligibility-source", reviewer="test",
                              rationale="No dated U.S. location evidence", reviewed_at=retrieved_at)
    with db.cursor() as cur:
        cur.execute("""SELECT entity.identity_status, eligibility.universe_status
            FROM topology_entities AS entity JOIN topology_eligibility_reviews AS eligibility
            ON eligibility.entity_id=entity.id WHERE entity.id='unknown'""")
        assert cur.fetchone() == {"identity_status": "unresolved",
                                  "universe_status": "unresolved"}


def test_shared_exposure_requires_both_source_premises(db):
    observed = datetime(2026, 9, 24, tzinfo=timezone.utc)
    for source_id in ("left-source", "right-source"):
        store_source(db, source_id=source_id,
                     source_url=f"https://example.com/{source_id}",
                     publisher=source_id, title="Filing", source_type="annual filing",
                     published_on=date(2025, 2, 20) if source_id == "left-source"
                     else date(2026, 2, 20), retrieved_at=observed,
                     raw_body=source_id.encode())
    ensure_entity(db, entity_id="left", name="Left", entity_kind="company")
    ensure_entity(db, entity_id="right", name="Right", entity_kind="company")
    store_candidate(db, candidate_id="shared", source_id="left-source",
                    subject_entity_id="left", object_entity_id="right",
                    predicate="shared_exposure_hypothesis", direction="symmetric",
                    scope="customer usage", evidence_locator="risk factors",
                    evidence_text="Left reports usage exposure.",
                    interpretation="Both may be affected by usage changes.",
                    alternative_or_unknown="Effects may differ; no co-movement test.",
                    temporal_form="observed_state", temporal_basis="Two dated filings",
                    proposed_basis="hypothesis", generator="manual", generator_version="1",
                    period_start=date(2024, 1, 1), period_end=date(2024, 12, 31))
    with pytest.raises(ValueError, match="two supporting sources"):
        record_review(db, candidate_id="shared", decision="accept", reviewer="test",
                      rationale="Both filings", reviewed_at=datetime(2026, 9, 25,
                      tzinfo=timezone.utc))
    db.rollback()
    assert add_candidate_evidence(db, candidate_id="shared", source_id="right-source",
                                  evidence_role="support", evidence_locator="business",
                                  evidence_summary="Right reports usage exposure.",
                                  period_start=date(2023, 2, 1),
                                  period_end=date(2024, 1, 31)) == "stored"
    assert add_candidate_evidence(db, candidate_id="shared", source_id="right-source",
                                  evidence_role="support", evidence_locator="business",
                                  evidence_summary="Right reports usage exposure.",
                                  period_start=date(2023, 2, 1),
                                  period_end=date(2024, 1, 31)) == "duplicate"
    record_review(db, candidate_id="shared", decision="accept", reviewer="test",
                  rationale="Two distinct disclosures motivate a hypothesis only",
                  reviewed_at=datetime(2026, 9, 25, tzinfo=timezone.utc))
    claim = reviewed_claims(db)[0]
    assert claim["proposed_basis"] == "hypothesis"
    assert claim["additional_evidence"][0]["source_id"] == "right-source"
    assert claim["additional_evidence"][0]["period_end"] == "2024-01-31"
    assert reviewed_claims(db, source_date_cutoff=date(2025, 12, 31)) == []


def test_reviewed_seed_import_preserves_source_passages_and_is_idempotent(db, monkeypatch):
    from scripts.import_topology_seed import import_seed
    from scripts.build_dashboard import verify_topology_store

    root = Path(__file__).parents[1]
    cohort = json.loads((root / "docs/research/pilot-cohort.json").read_text())
    topology = json.loads((root / "docs/research/market-topology.json").read_text())
    manifest = json.loads((root / "docs/research/topology-source-manifest.json").read_text())
    with db.cursor() as cur:
        for company in cohort:
            cur.execute("""INSERT INTO companies(slug,name) VALUES (%s,%s)
                ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name""",
                (company["slug"], company["name"]))
    db.commit()
    monkeypatch.setenv("DATABASE_URL", os.environ["LOG_POSE_TEST_DATABASE_URL"])

    first = import_seed(topology, manifest, cohort, repository_root=root,
                        reviewer="test source review")
    assert first["source_assertions_created"] == 4
    assert first["secondary_evidence_links_created"] == 1
    assert first["reviews_appended"] == 4
    assert all(count == 0 for count in import_seed(
        topology, manifest, cohort, repository_root=root,
        reviewer="test source review").values())
    claims = reviewed_claims(db)
    assert len(claims) == 4
    assert all(claim["exact_quote"] for claim in claims)
    hypothesis = next(claim for claim in claims
                      if claim["predicate"] == "shared_exposure_hypothesis")
    assert len(hypothesis["additional_evidence"]) == 1
    assert hypothesis["additional_evidence"][0]["exact_quote"]
    verify_topology_store(topology, db)
    changed = json.loads(json.dumps(topology))
    changed["claims"][0]["interpretation"] = "A changed interpretation"
    with pytest.raises(ValueError, match="differs from reviewed store"):
        verify_topology_store(changed, db)

    from log_pose.topology_export import export_topology
    exported = export_topology(db, cohort)
    assert len(exported["claims"]) == 4
    assert all(claim["review"]["date_precision"] == "day" for claim in exported["claims"])
    assert all(claim["review"]["reviewed_at"].startswith(topology["reviewed_at"])
               for claim in exported["claims"])
    assert all("not a new source review" in claim["review"]["rationale"] for claim in exported["claims"])
    # Review selection cannot bypass the ontology's hypothesis basis rule.
    invalid_rows = reviewed_claims(db, limit=500)
    invalid_hypothesis = next(row for row in invalid_rows
                              if row["predicate"] == "shared_exposure_hypothesis")
    invalid_hypothesis["proposed_basis"] = "source_statement"
    with monkeypatch.context() as patch:
        patch.setattr("log_pose.topology_export.reviewed_claims", lambda *args, **kwargs: invalid_rows)
        with pytest.raises(ValueError, match="hypothesis status"):
            export_topology(db, cohort)
    candidate_id = exported["claims"][0]["database_id"]
    record_review(db, candidate_id=candidate_id, decision="reject", reviewer="later review",
                  rationale="the earlier interpretation needs correction",
                  reviewed_at=datetime(2026, 9, 26, tzinfo=timezone.utc))
    counts = import_seed(topology, manifest, cohort, repository_root=root, reviewer="another importer")
    assert counts["reviews_appended"] == 0
    revised = export_topology(db, cohort)
    assert len(revised["claims"]) == 3
    assert revised["counts"]["rejected"] == 1
    assert len(revised["review_history"]) == 5


def test_discovery_extension_import_is_immutable_and_idempotent(db):
    from log_pose.discovery_store import store_discovery_extension

    root = Path(__file__).parents[1]
    index = json.loads((root / "web/discovery.json").read_text())
    index["inventory_rows"] = []
    for artifact in index["artifacts"]:
        partition_path = root / artifact["inventory_export_path"]
        index["inventory_rows"].extend(json.loads(partition_path.read_text())["rows"])
    counts = store_discovery_extension(db, index, repository_root=root)
    assert counts == {"artifacts_created": 14, "mapped_occurrences_created": 6096,
                      "inventory_rows_created": 18076}
    assert store_discovery_extension(db, index, repository_root=root) == {
        "artifacts_created": 0, "mapped_occurrences_created": 0,
        "inventory_rows_created": 0,
    }
    with db.cursor() as cursor:
        cursor.execute("""SELECT artifact.study_year,artifact.coverage_status,
                count(*) AS inventory_rows,
                count(*) FILTER (WHERE record_type='product_or_project_candidate') AS mapped_rows
            FROM discovery_artifacts AS artifact JOIN discovery_inventory_rows AS inventory
              ON inventory.artifact_sha256=artifact.raw_sha256
            GROUP BY artifact.study_year,artifact.coverage_status ORDER BY artifact.study_year""")
        rows = cursor.fetchall()
    assert rows == [
        {"study_year": 2020, "coverage_status": "dated_inventory_snapshot", "inventory_rows": 1881, "mapped_rows": 598},
        {"study_year": 2021, "coverage_status": "dated_inventory_snapshot", "inventory_rows": 2237, "mapped_rows": 700},
        {"study_year": 2022, "coverage_status": "dated_inventory_snapshot", "inventory_rows": 2561, "mapped_rows": 799},
        {"study_year": 2023, "coverage_status": "dated_inventory_snapshot", "inventory_rows": 2768, "mapped_rows": 901},
        {"study_year": 2024, "coverage_status": "dated_inventory_snapshot", "inventory_rows": 2845, "mapped_rows": 1032},
        {"study_year": 2025, "coverage_status": "dated_inventory_snapshot", "inventory_rows": 2884, "mapped_rows": 1053},
        {"study_year": 2026, "coverage_status": "partial_year_snapshot", "inventory_rows": 2900, "mapped_rows": 1013},
    ]
