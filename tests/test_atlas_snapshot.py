import copy
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from log_pose.atlas_snapshot import (
    build_atlas_snapshot,
    publish_current,
    rollback_snapshot,
    validate_snapshot,
)


def fixture_projection():
    artifact = {"source": "catalog", "year": 2024, "repository": "owner/catalog",
                "commit": "revision-1", "commit_at": "2024-04-01T00:00:00Z",
                "observation_basis": "point_in_time_repository_state",
                "coverage_status": "dated_inventory_snapshot", "url": "https://example.test/source",
                "raw_sha256": "a" * 64, "artifact_path": "source/revision-1.json",
                "partition_path": "inventory/revision-1.json"}

    def node(identifier, category):
        row_id = f"row-{identifier}"
        observation = {"source": "catalog", "year": 2024, "source_category": category,
                       "artifact_sha256": "a" * 64,
                       "partition_path": "inventory/revision-1.json",
                       "occurrence_ids": [row_id],
                       "rows": [{"id": row_id, "name": identifier,
                                 "description": f"evidence for {identifier}",
                                 "source_path": [1, len(identifier)],
                                 "homepage_url": "", "repo_url": ""}]}
        return {"id": identifier, "candidate_id": identifier, "name": identifier.title(),
                "description": f"{identifier} summary", "record_type": "product_or_project_candidate",
                "candidate_tags": ["developer_tools"], "observed_years": [2024],
                "sources": ["catalog"], "homepage_url": "", "repo_url": "",
                "occurrence_ids": [row_id], "identity_review": None, "navigation_match": None,
                "company_eligibility": "unreviewed", "relationship_status": "unreviewed",
                "observations": [observation]}

    return {"build_id": "projection-v1", "status": "unreviewed_inventory_overlap",
            "node_grain": "one product or project candidate", "provenance": {
                "discovery_sha256": "d" * 64, "queue_sha256": "q" * 64},
            "artifacts": [artifact], "nodes": [node("alpha", "Tools"),
                                                node("beta", "Tools"),
                                                node("gamma", "Data")],
            "edges": [{"id": "worklist-only"}]}


def read_current(root):
    return json.loads((root / "current.json").read_bytes())


def test_full_rebuild_is_deterministic_and_interoperable_with_sql_contract(tmp_path):
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first, first_status = build_atlas_snapshot(fixture_projection(), first_root)
    second, second_status = build_atlas_snapshot(fixture_projection(), second_root)
    assert first_status == second_status == "full_rebuild"
    assert first["build_id"] == second["build_id"]
    assert first["database_sha256"] == second["database_sha256"]
    assert first["database_bytes"] == second["database_bytes"]
    assert read_current(first_root) == first
    validate_snapshot(first_root, first)

    database = sqlite3.connect(first_root / first["database"])
    try:
        tables = {row[0] for row in database.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
        assert {"candidate", "candidate_search", "artifact", "placement",
                "membership", "metadata"}.issubset(tables)
        assert database.execute("SELECT count(*) FROM candidate").fetchone() == (3,)
        assert database.execute("SELECT count(*) FROM membership").fetchone() == (3,)
        assert database.execute(
            "SELECT id FROM candidate_search WHERE candidate_search MATCH 'developer*' ORDER BY id"
        ).fetchall() == [("alpha",), ("beta",), ("gamma",)]
        assert database.execute("""
            SELECT c.id,c.rowid,s.rowid FROM candidate c
            JOIN candidate_search s ON s.id=c.id ORDER BY c.id
        """).fetchall() == [("alpha", 1, 1), ("beta", 2, 2), ("gamma", 3, 3)]
        detail = json.loads(database.execute(
            "SELECT detail_json FROM membership WHERE candidate_id='alpha'").fetchone()[0])
        assert detail["occurrence_ids"] == ["row-alpha"]
        assert detail["rows"][0]["source_path"] == [1, 5]
        artifact = json.loads(database.execute("SELECT detail_json FROM artifact").fetchone()[0])
        assert artifact["raw_sha256"] == "a" * 64
        assert artifact["inventory_year"] == 2024
    finally:
        database.close()


def test_exact_snapshot_is_reused_after_validation(tmp_path):
    manifest, _ = build_atlas_snapshot(fixture_projection(), tmp_path)
    database_path = tmp_path / manifest["database"]
    first_stat = database_path.stat()
    rebuilt, status = build_atlas_snapshot(fixture_projection(), tmp_path)
    assert rebuilt == manifest
    assert status == "reused_immutable_snapshot"
    assert database_path.stat().st_ino == first_stat.st_ino


def test_evidence_change_creates_new_version_and_keeps_old_snapshot(tmp_path):
    first, _ = build_atlas_snapshot(fixture_projection(), tmp_path)
    changed = fixture_projection()
    changed["nodes"][0]["observations"][0]["rows"][0]["description"] = "corrected evidence"
    second, _ = build_atlas_snapshot(changed, tmp_path)
    assert second["build_id"] != first["build_id"]
    assert second["input_hashes"]["membership_build_id"] != first["input_hashes"]["membership_build_id"]
    assert (tmp_path / first["database"]).is_file()
    assert (tmp_path / f"{first['build_id']}.json").is_file()
    assert read_current(tmp_path) == second


def test_corruption_cannot_switch_current_pointer(tmp_path):
    first, _ = build_atlas_snapshot(fixture_projection(), tmp_path)
    changed = fixture_projection()
    changed["nodes"][0]["name"] = "Changed Alpha"
    second, _ = build_atlas_snapshot(changed, tmp_path, publish=False)
    database_path = tmp_path / second["database"]
    contents = database_path.read_bytes()
    database_path.write_bytes(contents[:-64] + b"corrupt")
    before = (tmp_path / "current.json").read_bytes()
    with pytest.raises(ValueError, match="byte count|checksum"):
        publish_current(tmp_path, second)
    assert (tmp_path / "current.json").read_bytes() == before
    assert read_current(tmp_path)["build_id"] == first["build_id"]


def test_rollback_validates_target_and_atomically_restores_pointer(tmp_path):
    first, _ = build_atlas_snapshot(fixture_projection(), tmp_path)
    changed = fixture_projection()
    changed["nodes"][1]["description"] = "new summary"
    second, _ = build_atlas_snapshot(changed, tmp_path)
    assert read_current(tmp_path)["build_id"] == second["build_id"]
    restored = rollback_snapshot(tmp_path, first["build_id"])
    assert restored == first
    assert read_current(tmp_path) == first


def test_manifest_binds_versions_and_logical_content(tmp_path):
    manifest, _ = build_atlas_snapshot(fixture_projection(), tmp_path)
    assert manifest["versions"] == {"membership": "1.0", "query": "atlas-query-v1",
                                    "layout": "atlas-address-v1",
                                    "snapshot": "atlas-snapshot-v1"}
    assert manifest["clocks"]["inventory"]["precision"] == "year"
    assert manifest["derivation"]["incremental_status"] == "not_implemented"
    logical = {key: manifest[key] for key in (
        "schema_version", "counts", "input_hashes", "versions", "clocks", "derivation")}
    digest = hashlib.sha256(json.dumps(logical, ensure_ascii=False, sort_keys=True,
                                      separators=(",", ":")).encode()).hexdigest()
    assert digest == manifest["build_id"]


def test_real_projection_builds_and_reconciles(tmp_path):
    root = Path(__file__).parents[1]
    projection = json.loads((root / "web/data/topology-discovery.json").read_bytes())
    manifest, status = build_atlas_snapshot(projection, tmp_path)
    assert status == "full_rebuild"
    assert manifest["counts"]["candidates"] == 1_240
    assert manifest["counts"]["memberships"] == 5_964
    assert manifest["counts"]["input_worklist_pairs"] == 100
    validate_snapshot(tmp_path, manifest)
