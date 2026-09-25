import copy
import json
from pathlib import Path

import pytest

from log_pose.market_field_graph import build_market_field_graph


ROOT = Path(__file__).parents[1]


def fixture_projection():
    def observation(source, year, category, row_id):
        return {"source": source, "year": year, "source_category": category,
                "artifact_sha256": "a" * 64, "occurrence_ids": [row_id],
                "rows": [{"id": row_id}]}

    def candidate(identifier, observations):
        return {"id": identifier, "name": identifier, "description": "",
                "candidate_tags": ["developer_tools"], "observed_years": [2024],
                "sources": ["cncf"], "homepage_url": "", "repo_url": "",
                "identity_review": None, "observations": observations}

    return {"build_id": "projection-v1", "status": "unreviewed_inventory_overlap",
            "provenance": {"discovery_sha256": "a" * 64, "queue_sha256": "b" * 64},
            "artifacts": [{"source": "cncf", "year": 2024,
                           "url": "https://example.org/original-pinned-source"}],
            "nodes": [candidate("a", [observation("cncf", 2024, "A", "a1")]),
                      candidate("b", [observation("cncf", 2024, "A", "b1")]),
                      candidate("c", [observation("cncf", 2024, "B", "c1")])],
            "edges": [], "counts": {"nodes": 3, "observations": 3,
                                      "possible_pairs": 1, "edges": 0}}


def test_exact_key_deduplicates_placements_and_is_stable():
    projection = fixture_projection()
    projection["nodes"][0]["observations"][0]["rows"].append({"id": "a2"})
    projection["nodes"][0]["observations"][0]["occurrence_ids"].append("a2")
    graph = build_market_field_graph(projection)
    assert graph["pairs"] == [[0, 1, [0]]]
    assert graph["adjacency"] == [[0], [0], []]
    assert graph["candidate_key_indices"] == [[0], [0], [1]]
    assert build_market_field_graph(copy.deepcopy(projection)) == graph
    reversed_nodes = copy.deepcopy(projection)
    reversed_nodes["nodes"].reverse()
    reordered_graph = build_market_field_graph(reversed_nodes)
    for field in ("keys", "candidates", "pairs", "adjacency"):
        assert reordered_graph[field] == graph[field]
    assert reordered_graph["build_id"] != graph["build_id"]
    changed = copy.deepcopy(projection)
    changed["nodes"][2]["observations"][0]["source_category"] = "C"
    assert build_market_field_graph(changed)["build_id"] != graph["build_id"]


def test_count_mismatch_blocks_publication():
    projection = fixture_projection()
    projection["counts"]["possible_pairs"] = 2
    with pytest.raises(ValueError, match="differs"):
        build_market_field_graph(projection)


def test_duplicate_projected_key_requires_normalized_rows():
    projection = fixture_projection()
    projection["nodes"][0]["observations"].append(
        copy.deepcopy(projection["nodes"][0]["observations"][0]))
    with pytest.raises(ValueError, match="duplicate projected observation"):
        build_market_field_graph(projection)


def test_shipped_artifact_rebuilds_from_pinned_projection():
    projection = json.loads((ROOT / "web/data/topology-discovery.json").read_text())
    graph = json.loads((ROOT / "api/data/market-field-graph.json").read_text())
    assert build_market_field_graph(projection) == graph


def test_detail_only_changes_renew_graph_id_even_with_stale_projection_id():
    projection = fixture_projection()
    first = build_market_field_graph(projection)
    changed_row = copy.deepcopy(projection)
    changed_row["nodes"][0]["observations"][0]["rows"][0]["id"] = "different-source-row"
    changed_artifact = copy.deepcopy(projection)
    changed_artifact["artifacts"][0]["url"] = "https://example.org/new-pinned-source"
    for changed in (changed_row, changed_artifact):
        assert changed["build_id"] == projection["build_id"]
        rebuilt = build_market_field_graph(changed)
        assert rebuilt["input_hashes"]["projection_sha256"] != first["input_hashes"]["projection_sha256"]
        assert rebuilt["build_id"] != first["build_id"]
