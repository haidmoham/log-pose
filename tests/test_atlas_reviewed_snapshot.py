import json
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


def test_rebuild_is_deterministic_and_keeps_immutable_manifest(tmp_path):
    first = build_atlas_reviewed(ROOT, tmp_path)
    second = build_atlas_reviewed(ROOT, tmp_path)
    assert first == second
    assert (tmp_path / f"{first['build_id']}.json").read_bytes() == (tmp_path / "current.json").read_bytes()
