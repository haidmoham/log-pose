"""Topology storage checks against an explicitly disposable Postgres database."""

import os
from datetime import date, datetime, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from log_pose.storage import migrate
from log_pose.topology_store import (
    claim_acquisitions, ensure_entity, finish_acquisition, plan_acquisition,
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
                          interpretation="An integration was announced.",
                          alternative_or_unknown="Ongoing availability is unknown.",
                          proposed_basis="source_statement", generator="manual",
                          generator_version="1", event_on=date(2022, 2, 24))
    assert store_candidate(db, **candidate_args) == "stored"
    assert store_candidate(db, **candidate_args) == "duplicate"
    assert reviewed_claims(db) == []

    accepted_at = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
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

    rejected_at = datetime(2026, 9, 25, tzinfo=timezone.utc)
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
