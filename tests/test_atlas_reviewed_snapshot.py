import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from log_pose.atlas_reviewed_snapshot import build_atlas_reviewed, check_current


ROOT = Path(__file__).parents[1]


def test_real_reviewed_snapshot_preserves_exact_evidence_and_identity_links(tmp_path):
    manifest = build_atlas_reviewed(ROOT, tmp_path)
    assert manifest["counts"] == {"entities": 4, "candidate_links": 3, "claims": 4,
                                  "sources": 5, "reviews": 4}
    assert manifest["review_lens"] == "current_accepted_at_build"
    database = sqlite3.connect(tmp_path / manifest["database"])
    try:
        assert database.execute("SELECT entity_id,identity_review_id FROM candidate_link WHERE candidate_id=?",
            ("4d9ade2bfb2aa6cb4afb",)).fetchone() == ("datadog", "identity-review-12")
        dbt = database.execute("SELECT target_kind FROM entity WHERE id='dbt-labs'").fetchone()
        assert dbt == ("reviewed_external_entity",)
        claim = json.loads(database.execute("SELECT detail_json FROM claim WHERE id=?", (
            "datadog-named-competitor-elastic-log-management-2024",)).fetchone()[0])
        assert claim["database_id"] == "seed-claim:datadog-named-competitor-elastic-log-management-2024:929d80cd58d5"
        assert claim["sources"][0]["artifact_sha256"] == "711ee14f238f3e12597a03d889b7d8c29785eee865e1cecd8e20e0578a67facf"
        assert claim["review"]["id"] == 1
    finally:
        database.close()
    assert check_current(tmp_path)["build_id"] == manifest["build_id"]


def test_check_rejects_corrupted_database(tmp_path):
    manifest = build_atlas_reviewed(ROOT, tmp_path)
    database = tmp_path / manifest["database"]
    database.write_bytes(database.read_bytes()[:-16])
    with pytest.raises(ValueError, match="bytes differ"):
        check_current(tmp_path)


def test_existing_database_is_validated_before_missing_manifest_can_be_published(tmp_path):
    manifest = build_atlas_reviewed(ROOT, tmp_path)
    database = tmp_path / manifest["database"]
    (tmp_path / "current.json").unlink()
    (tmp_path / f"{manifest['build_id']}.json").unlink()
    database.write_bytes(database.read_bytes()[:-16])
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        build_atlas_reviewed(ROOT, tmp_path)


def test_rebuild_is_deterministic_and_keeps_immutable_manifest(tmp_path):
    first = build_atlas_reviewed(ROOT, tmp_path)
    second = build_atlas_reviewed(ROOT, tmp_path)
    assert first == second
    assert (tmp_path / f"{first['build_id']}.json").read_bytes() == (tmp_path / "current.json").read_bytes()


def test_check_detects_stale_canonical_identity_export(tmp_path):
    output = tmp_path / "output"
    build_atlas_reviewed(ROOT, output)
    repository = tmp_path / "repository"
    for relative in ("web/data/index.json", "web/data/topology-discovery.json",
                     "docs/research/topology-source-manifest.json"):
        destination = repository / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
    source_root = ROOT / "docs/research/source-artifacts/topology"
    destination_root = repository / "docs/research/source-artifacts/topology"
    shutil.copytree(source_root, destination_root)
    discovery_path = repository / "web/data/topology-discovery.json"
    discovery = json.loads(discovery_path.read_text())
    reviewed = next(node for node in discovery["nodes"]
                    if (node.get("identity_review") or {}).get("pilot_slug") == "datadog")
    reviewed["identity_review"]["id"] += "-changed"
    discovery_path.write_text(json.dumps(discovery))
    with pytest.raises(ValueError, match="stale relative"):
        check_current(output, repository)
