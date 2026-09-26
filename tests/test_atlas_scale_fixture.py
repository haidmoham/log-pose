import importlib.util
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location(
    "benchmark_atlas", ROOT / "scripts/benchmark_atlas.py")
BENCHMARK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCHMARK)


def test_synthetic_scale_fixture_has_exact_grains_and_dense_bucket(tmp_path):
    result = BENCHMARK.build_fixture(tmp_path, "test")
    manifest = result["manifest"]
    assert result["status"] == "built"
    assert manifest["synthetic"] is True
    assert manifest["generator"]["version"] == "atlas-scale-v1"
    assert manifest["counts"] == {"artifacts": 8, "placements": 128, "candidates": 200,
                                  "memberships": 2_000, "supporting_occurrences": 2_000,
                                  "input_worklist_pairs": 0}
    assert result["dense_placement_members"] == 100
    database = sqlite3.connect(tmp_path / manifest["database"])
    try:
        assert database.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert database.execute("PRAGMA foreign_key_check").fetchall() == []
        assert database.execute("SELECT count(*) FROM membership").fetchone() == (2_000,)
        assert database.execute("SELECT max(member_count) FROM placement").fetchone() == (100,)
        assert database.execute("SELECT count(DISTINCT candidate_id||':'||placement_id) FROM membership").fetchone() == (2_000,)
        detail = json.loads(database.execute("SELECT detail_json FROM membership LIMIT 1").fetchone()[0])
        assert detail["rows"][0]["synthetic"] is True
        assert len(detail["occurrence_ids"]) == 1
        assert database.execute("""SELECT count(*) FROM candidate c JOIN candidate_search s
            ON c.id=s.id WHERE c.rowid=s.rowid""").fetchone() == (200,)
    finally:
        database.close()


def test_fixture_reuses_same_frozen_build(tmp_path):
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first = BENCHMARK.build_fixture(first_root, "test")
    reused = BENCHMARK.build_fixture(first_root, "test")
    independent = BENCHMARK.build_fixture(second_root, "test")
    assert reused["status"] == "reused"
    assert reused["manifest"] == first["manifest"]
    assert independent["manifest"]["build_id"] == first["manifest"]["build_id"]
    assert independent["manifest"]["database_sha256"] == first["manifest"]["database_sha256"]
