"""Scoped topology reconstruction against an explicitly disposable database."""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row

from log_pose.storage import migrate
from log_pose.topology_export import export_topology
from log_pose.topology_reconstruction import reconstruct_topology
from log_pose.topology_store import reviewed_claims


@pytest.fixture
def db():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    with psycopg.connect(url, row_factory=dict_row) as connection:
        migrate(connection)
        with connection.cursor() as cursor:
            cursor.execute("""TRUNCATE topology_reconstruction_records,
                topology_reconstruction_batches, topology_graph_builds, topology_reviews,
                topology_candidate_evidence, topology_candidates, topology_acquisition_jobs,
                topology_eligibility_reviews, topology_entity_aliases, topology_entities,
                topology_sources CASCADE""")
        connection.commit()
        yield connection


def inputs(root: Path) -> dict:
    return {"repository_root": root, "projection_path": root / "docs/research/issue11/topology-reconstruction-input.json",
            "packet_path": root / "docs/research/issue11/integration-review-packet.json"}


def test_reconstruction_is_exact_idempotent_and_appends_only_accepted_integration(db):
    root = Path(__file__).parents[1]
    arrival = datetime(2026, 9, 26, 17, 0, tzinfo=timezone.utc)
    first = reconstruct_topology(db, **inputs(root), reconstructed_at=arrival)
    assert first["counts"] == {"sources": 3, "entities": 4, "candidates": 4,
        "evidence": 1, "reviews": 4, "integration_candidates": 1,
        "integration_reviews": 1}
    second = reconstruct_topology(db, **inputs(root),
                                  reconstructed_at=datetime(2026, 9, 27, tzinfo=timezone.utc))
    assert all(value == 0 for value in second["counts"].values())
    assert second["reconstructed_at"] == arrival.isoformat()

    current = reviewed_claims(db, limit=100)
    assert len(current) == 5
    assert {row["id"] for row in current if row["id"].startswith("seed-claim:")} == {
        claim["database_id"] for claim in json.loads((root / "docs/research/issue11/topology-reconstruction-input.json").read_text())
        ["topology"]["claims"]}
    integration = next(row for row in current if row["predicate"] == "integrates_with")
    assert integration["scope"] == (
        "dbt data-transformation workloads with Snowflake products; editions and versions unspecified")
    assert integration["reviewed_at"].astimezone(timezone.utc).isoformat() == (
        "2026-09-26T15:38:50.335653+00:00")

    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM gold.topology_reconstruction_status")
        status = cursor.fetchone()
        assert status["record_count"] == 18
        assert status["unknown_arrival_count"] == 9
        cursor.execute("""SELECT original_created_at,reconstruction_arrived_at
            FROM topology_entities WHERE id='dbt-labs'""")
        entity = cursor.fetchone()
        assert entity["original_created_at"] is None
        assert entity["reconstruction_arrived_at"] == arrival


def test_unknown_secondary_evidence_arrival_fails_closed_for_review_cutoff(db):
    root = Path(__file__).parents[1]
    reconstruct_topology(db, **inputs(root),
                         reconstructed_at=datetime(2026, 9, 26, 17, tzinfo=timezone.utc))
    current = reviewed_claims(db, limit=100)
    assert any(row["predicate"] == "shared_exposure_hypothesis" for row in current)
    historical = reviewed_claims(db,
        review_cutoff=datetime(2030, 1, 1, tzinfo=timezone.utc), limit=100)
    assert not any(row["predicate"] == "shared_exposure_hypothesis" for row in historical)
    assert any(row["predicate"] == "integrates_with" for row in historical)


def test_reconstruction_rejects_conflicts_without_overwriting(db):
    root = Path(__file__).parents[1]
    arrival = datetime(2026, 9, 26, 17, tzinfo=timezone.utc)
    reconstruct_topology(db, **inputs(root), reconstructed_at=arrival)
    candidate_id = "seed-claim:dbt-labs-announced-partnership-snowflake-2022:14301c1bd839"
    with db.cursor() as cursor:
        cursor.execute("UPDATE topology_candidates SET scope='conflicting scope' WHERE id=%s",
                       (candidate_id,))
    db.commit()
    with pytest.raises(ValueError, match="conflicts with retained reconstruction"):
        reconstruct_topology(db, **inputs(root), reconstructed_at=arrival)
    with db.cursor() as cursor:
        cursor.execute("SELECT scope FROM topology_candidates WHERE id=%s", (candidate_id,))
        assert cursor.fetchone()["scope"] == "conflicting scope"


def test_reconstructed_base_projection_matches_the_pinned_public_projection(db):
    root = Path(__file__).parents[1]
    reconstruct_topology(db, **inputs(root),
                         reconstructed_at=datetime(2026, 9, 26, 17, tzinfo=timezone.utc))
    with db.cursor() as cursor:
        cursor.execute("DELETE FROM topology_reviews WHERE candidate_id LIKE 'proposal:%'")
        cursor.execute("DELETE FROM topology_candidates WHERE id LIKE 'proposal:%'")
    db.commit()
    pinned = json.loads((root / "docs/research/issue11/topology-reconstruction-input.json").read_text())["topology"]
    cohort = json.loads((root / "docs/research/pilot-cohort.json").read_text())
    assert export_topology(db, cohort) == pinned


def test_migration_preserves_preexisting_arrival_clocks():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    database_name = f"topology_reconstruction_clock_{uuid.uuid4().hex}"
    admin_url = make_conninfo(url, dbname="postgres")
    created = False
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
        created = True
    root = Path(__file__).parents[1]
    try:
        with psycopg.connect(make_conninfo(url, dbname=database_name)) as connection:
            with connection.cursor() as cursor:
                cursor.execute("CREATE TABLE schema_migrations(version text PRIMARY KEY)")
                for path in sorted((root / "sql").glob("[0-9][0-9][0-9]_*.sql")):
                    if path.name >= "016_topology_reconstruction.sql":
                        break
                    cursor.execute(path.read_text())
                    cursor.execute("INSERT INTO schema_migrations VALUES (%s)", (path.name,))
                cursor.execute("""INSERT INTO topology_sources(id,source_url,publisher,title,
                    source_type,published_on,retrieved_at,raw_body,raw_sha256,retrieval_status)
                    VALUES ('old-source','https://example.com','Example','Old','page','2020-01-01',
                    '2020-01-02T00:00:00Z','old','cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4','retrieved')""")
                cursor.execute("""INSERT INTO topology_entities
                    (id,name,entity_kind,identity_status,created_at) VALUES
                    ('old-a','Old A','company','reviewed','2020-01-03T00:00:00Z'),
                    ('old-b','Old B','company','reviewed','2020-01-04T00:00:00Z')""")
                cursor.execute("""INSERT INTO topology_candidates(id,source_id,subject_entity_id,
                    object_entity_id,predicate,direction,scope,evidence_locator,evidence_text,
                    interpretation,alternative_or_unknown,temporal_form,temporal_basis,
                    proposed_basis,generator,generator_version,created_at)
                    VALUES ('old-candidate','old-source','old-a','old-b','integrates_with',
                    'subject_to_object','scope','locator','summary','interpretation','unknown',
                    'observed_state','published statement','source_statement','test','1',
                    '2020-01-05T00:00:00Z')""")
                cursor.execute("""INSERT INTO topology_candidate_evidence(candidate_id,source_id,
                    evidence_role,evidence_locator,evidence_summary,added_at)
                    VALUES ('old-candidate','old-source','support','second','summary',
                    '2020-01-06T00:00:00Z')""")
                cursor.execute((root / "sql/016_topology_reconstruction.sql").read_text())
                cursor.execute("""SELECT entity.original_created_at,candidate.original_created_at AS candidate_at,
                    evidence.original_added_at FROM topology_entities entity
                    JOIN topology_candidates candidate ON candidate.subject_entity_id=entity.id
                    JOIN topology_candidate_evidence evidence ON evidence.candidate_id=candidate.id
                    WHERE entity.id='old-a'""")
                row = cursor.fetchone()
                assert row[0].astimezone(timezone.utc).isoformat() == "2020-01-03T00:00:00+00:00"
                assert row[1].astimezone(timezone.utc).isoformat() == "2020-01-05T00:00:00+00:00"
                assert row[2].astimezone(timezone.utc).isoformat() == "2020-01-06T00:00:00+00:00"
    finally:
        if created:
            with psycopg.connect(admin_url, autocommit=True) as admin:
                admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database_name)))


def test_import_cli_rejects_nonlocal_or_unscoped_targets():
    from log_pose.topology_reconstruction import validate_reconstruction_target
    validate_reconstruction_target("postgresql://haidm@/topology_reconstruction_ok?"
                    "host=/home/haidm/.cache/log-pose-evidence-recovery-20260926/socket&port=55440")
    with pytest.raises(ValueError, match="prefix"):
        validate_reconstruction_target("postgresql://haidm@/postgres?"
                        "host=/home/haidm/.cache/log-pose-evidence-recovery-20260926/socket")
    with pytest.raises(ValueError, match="Unix socket"):
        validate_reconstruction_target("postgresql://haidm@127.0.0.1/topology_reconstruction_bad")
    with pytest.raises(ValueError, match="alternate libpq routing"):
        validate_reconstruction_target("postgresql://haidm@/topology_reconstruction_bad?"
            "host=/home/haidm/.cache/log-pose-evidence-recovery-20260926/socket&hostaddr=127.0.0.1")
