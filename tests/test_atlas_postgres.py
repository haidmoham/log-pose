"""Atlas Postgres derivative checks against canonical SQLite fixtures."""

import copy
import json
import os
from pathlib import Path

import psycopg
import pytest

from log_pose.atlas_postgres import load_manifest, publish_atlas_snapshot
from log_pose.atlas_snapshot import build_atlas_snapshot
from log_pose.storage import migrate
from tests.test_atlas_snapshot import fixture_projection


@pytest.fixture
def atlas_db():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    with psycopg.connect(url) as connection:
        migrate(connection)
        with connection.cursor() as cursor:
            cursor.execute("""TRUNCATE public.atlas_current,public.atlas_membership,
                public.atlas_placement,public.atlas_artifact,public.atlas_candidate,
                public.atlas_snapshot CASCADE""")
        connection.commit()
        yield connection


def make_snapshot(root: Path, projection: dict | None = None) -> dict:
    manifest, _ = build_atlas_snapshot(projection or fixture_projection(), root)
    return manifest


def test_manifest_must_bind_validated_sqlite(tmp_path):
    manifest = make_snapshot(tmp_path)
    assert load_manifest(tmp_path) == manifest
    database = tmp_path / manifest["database"]
    data = database.read_bytes()
    database.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
    with pytest.raises(ValueError, match="checksum"):
        load_manifest(tmp_path)


@pytest.mark.parametrize("batch_size", [0, 50_001])
def test_batch_size_is_bounded_before_database_use(tmp_path, batch_size):
    make_snapshot(tmp_path)
    with pytest.raises(ValueError, match="batch_size"):
        publish_atlas_snapshot(None, tmp_path, batch_size=batch_size)


def test_import_reconciles_rows_search_and_retained_evidence(atlas_db, tmp_path):
    manifest = make_snapshot(tmp_path)
    result = publish_atlas_snapshot(atlas_db, tmp_path, batch_size=1)
    assert result == {"status": "imported", "build_id": manifest["build_id"],
                      "counts": manifest["counts"], "current": True}
    with atlas_db.cursor() as cursor:
        cursor.execute("SELECT build_id FROM gold.atlas_current WHERE singleton")
        assert cursor.fetchone()[0] == manifest["build_id"]
        cursor.execute("""SELECT id FROM gold.atlas_candidate
            WHERE build_id=%s AND search_text @@ plainto_tsquery('simple','developer tools')
            ORDER BY id""", (manifest["build_id"],))
        assert [row[0] for row in cursor.fetchall()] == ["alpha", "beta", "gamma"]
        cursor.execute("""SELECT detail_json FROM gold.atlas_membership
            WHERE build_id=%s AND candidate_id='alpha'""", (manifest["build_id"],))
        detail = cursor.fetchone()[0]
        assert detail["occurrence_ids"] == ["row-alpha"]
        assert detail["rows"][0]["source_path"] == [1, 5]
        cursor.execute("SELECT summary_json FROM gold.atlas_candidate WHERE build_id=%s LIMIT 1",
                       (manifest["build_id"],))
        assert "observations" not in cursor.fetchone()[0]


def test_validation_rejects_changed_placement_member_count(atlas_db, tmp_path):
    manifest = make_snapshot(tmp_path)
    publish_atlas_snapshot(atlas_db, tmp_path)
    with atlas_db.cursor() as cursor:
        cursor.execute("""UPDATE public.atlas_placement SET member_count=member_count+1
            WHERE build_id=%s AND id=(SELECT min(id) FROM public.atlas_placement WHERE build_id=%s)""",
                       (manifest["build_id"], manifest["build_id"]))
    atlas_db.commit()
    with pytest.raises(ValueError, match="member count"):
        publish_atlas_snapshot(atlas_db, tmp_path)


def test_reimport_is_idempotent_and_never_rewrites_build(atlas_db, tmp_path):
    manifest = make_snapshot(tmp_path)
    publish_atlas_snapshot(atlas_db, tmp_path)
    repeated = publish_atlas_snapshot(atlas_db, tmp_path)
    assert repeated["status"] == "existing_immutable_build"
    with atlas_db.cursor() as cursor:
        cursor.execute("UPDATE public.atlas_snapshot SET manifest=manifest || '{\"tampered\":true}'::jsonb WHERE build_id=%s",
                       (manifest["build_id"],))
    atlas_db.commit()
    with pytest.raises(ValueError, match="different manifest"):
        publish_atlas_snapshot(atlas_db, tmp_path)
    with atlas_db.cursor() as cursor:
        cursor.execute("SELECT manifest->>'tampered' FROM public.atlas_snapshot WHERE build_id=%s",
                       (manifest["build_id"],))
        assert cursor.fetchone()[0] == "true"


def test_failed_import_preserves_old_build_and_current_pointer(atlas_db, tmp_path):
    first = make_snapshot(tmp_path)
    publish_atlas_snapshot(atlas_db, tmp_path)
    changed = copy.deepcopy(fixture_projection())
    changed["nodes"][0]["observations"][0]["rows"][0]["description"] = "corrected evidence"
    second = make_snapshot(tmp_path, changed)
    database = tmp_path / second["database"]
    database.write_bytes(database.read_bytes()[:-8])
    with pytest.raises(ValueError, match="byte count"):
        publish_atlas_snapshot(atlas_db, tmp_path, build_id=second["build_id"])
    with atlas_db.cursor() as cursor:
        cursor.execute("SELECT build_id FROM public.atlas_current WHERE singleton")
        assert cursor.fetchone()[0] == first["build_id"]
        cursor.execute("SELECT count(*) FROM public.atlas_snapshot")
        assert cursor.fetchone()[0] == 1


def test_import_without_pointer_keeps_current(atlas_db, tmp_path):
    first = make_snapshot(tmp_path)
    publish_atlas_snapshot(atlas_db, tmp_path)
    changed = copy.deepcopy(fixture_projection())
    changed["nodes"][1]["description"] = "new summary"
    second = make_snapshot(tmp_path, changed)
    result = publish_atlas_snapshot(atlas_db, tmp_path, build_id=second["build_id"],
                                    publish_current=False)
    assert result["current"] is False
    with atlas_db.cursor() as cursor:
        cursor.execute("SELECT build_id FROM public.atlas_current WHERE singleton")
        assert cursor.fetchone()[0] == first["build_id"]
        cursor.execute("SELECT count(*) FROM public.atlas_snapshot")
        assert cursor.fetchone()[0] == 2
