import copy
import json
from pathlib import Path

import pytest

from log_pose.atlas_membership import (
    build_atlas_membership,
    iter_exact_pairs,
    matching_placement_indices,
    materialize_pair_oracle,
    select_candidate_neighborhood,
    validate_atlas_membership,
)


ROOT = Path(__file__).parents[1]


def artifact(*, commit="revision-1", year=2024, raw_sha256="a" * 64):
    return {"source": "catalog", "year": year, "repository": "owner/catalog",
            "commit": commit, "commit_at": f"{year}-01-01T00:00:00Z",
            "observation_basis": "point_in_time_repository_state",
            "coverage_status": "dated_inventory_snapshot", "url": "https://example.test/source",
            "raw_sha256": raw_sha256, "artifact_path": f"source/{commit}.json",
            "partition_path": f"inventory/{commit}.json"}


def observation(candidate_id, *, category="Tools", year=2024, raw_sha256="a" * 64,
                suffix="1"):
    row_id = f"{candidate_id}-row-{suffix}"
    return {"source": "catalog", "year": year, "source_category": category,
            "artifact_sha256": raw_sha256, "partition_path": f"inventory/{year}.json",
            "occurrence_ids": [row_id],
            "rows": [{"id": row_id, "name": candidate_id, "description": "evidence",
                      "source_path": [1, int(suffix)], "homepage_url": "", "repo_url": ""}]}


def candidate(candidate_id, observations):
    return {"id": candidate_id, "candidate_id": candidate_id, "name": candidate_id,
            "description": "summary", "record_type": "product_or_project_candidate",
            "candidate_tags": ["developer_tools"], "observed_years": [2024],
            "sources": ["catalog"], "homepage_url": "", "repo_url": "",
            "occurrence_ids": [item for row in observations for item in row["occurrence_ids"]],
            "identity_review": None, "navigation_match": None,
            "company_eligibility": "unreviewed", "relationship_status": "unreviewed",
            "observations": observations}


def projection(nodes, artifacts=None, edges=None):
    return {"build_id": "projection", "status": "unreviewed_inventory_overlap",
            "node_grain": "one candidate", "provenance": {"discovery_sha256": "d" * 64,
            "queue_sha256": "q" * 64}, "artifacts": artifacts or [artifact()],
            "nodes": nodes, "edges": edges or []}


def test_membership_deduplicates_observations_and_preserves_all_rows():
    first = observation("a", suffix="1")
    second = observation("a", suffix="2")
    index = build_atlas_membership(projection([
        candidate("a", [first, second]), candidate("b", [observation("b")])]))

    assert index["counts"] == {"artifacts": 1, "placements": 1, "candidates": 2,
                               "memberships": 2, "supporting_occurrences": 3,
                               "input_worklist_pairs": 0}
    assert index["candidate_placement_indices"] == [[0], [0]]
    assert index["placement_members"] == [[0, 1]]
    assert index["memberships"][0]["occurrence_ids"] == ["a-row-1", "a-row-2"]
    assert index["memberships"][0]["rows"] == [first["rows"][0], second["rows"][0]]
    validate_atlas_membership(index)


def test_artifact_revision_is_part_of_exact_placement_identity():
    repeated_bytes = "c" * 64
    artifacts = [artifact(commit="revision-1", raw_sha256=repeated_bytes),
                 artifact(commit="revision-2", raw_sha256=repeated_bytes)]
    ambiguous = projection([candidate("a", [observation("a", raw_sha256=repeated_bytes)])], artifacts)
    with pytest.raises(ValueError, match="ambiguous"):
        build_atlas_membership(ambiguous)

    explicit = copy.deepcopy(ambiguous)
    explicit["nodes"][0]["observations"][0]["artifact_commit"] = "revision-1"
    second_observation = observation("b", raw_sha256=repeated_bytes)
    second_observation["artifact_commit"] = "revision-2"
    explicit["nodes"].append(candidate("b", [second_observation]))
    identified = build_atlas_membership(explicit)
    assert len(identified["placements"]) == 2
    assert list(iter_exact_pairs(identified)) == []
    explicit["nodes"][0]["observations"][0]["artifact_commit"] = "not-retained"
    with pytest.raises(ValueError, match="unknown artifact"):
        build_atlas_membership(explicit)

    second_hash = "d" * 64
    artifacts[1] = artifact(commit="revision-2", raw_sha256=second_hash)
    index = build_atlas_membership(projection([
        candidate("a", [observation("a", raw_sha256=repeated_bytes)]),
        candidate("b", [observation("b", raw_sha256=second_hash)]),
    ], artifacts))
    assert len(index["placements"]) == 2
    assert len({row["id"] for row in index["artifacts"]}) == 2
    assert [row["raw_sha256"] for row in index["artifacts"]] == [repeated_bytes, second_hash]
    assert list(iter_exact_pairs(index)) == []


def test_neighborhood_filters_and_pair_supports_use_exact_placements():
    nodes = [candidate("a", [observation("a", category="Tools"),
                              observation("a", category="Data", suffix="2")]),
             candidate("b", [observation("b", category="Tools"),
                              observation("b", category="Data", suffix="2")]),
             candidate("c", [observation("c", category="Data")])]
    index = build_atlas_membership(projection(nodes))
    pairs = list(iter_exact_pairs(index))
    pair_ids = {(index["candidates"][left]["id"], index["candidates"][right]["id"]): supports
                for left, right, supports in pairs}
    assert len(pair_ids[("a", "b")]) == 2
    assert len(pair_ids[("a", "c")]) == 1
    tools = matching_placement_indices(index, category="Tools")
    assert len(tools) == 1
    assert len(list(iter_exact_pairs(index, placement_indices=tools))) == 1
    neighborhood = select_candidate_neighborhood(index, "a", category="Data", limit=1)
    assert neighborhood["total"] == 2
    assert neighborhood["truncated"] is True
    assert neighborhood["neighbors"][0]["candidate_id"] == "b"


@pytest.mark.parametrize("member_count", [1_000, 10_000])
def test_dense_bucket_build_and_selected_neighborhood_do_not_expand_pairs(member_count):
    nodes = [candidate(f"candidate-{number:05d}", [observation(f"candidate-{number:05d}")])
             for number in range(member_count)]
    index = build_atlas_membership(projection(nodes))
    assert index["counts"]["memberships"] == member_count
    assert "pairs" not in index
    neighborhood = select_candidate_neighborhood(index, "candidate-00000", limit=3)
    assert neighborhood["total"] == member_count - 1
    assert len(neighborhood["neighbors"]) == 3
    assert neighborhood["truncated"] is True


def test_oracle_requires_explicit_bounds_and_validation_detects_corruption():
    index = build_atlas_membership(projection([
        candidate("a", [observation("a")]), candidate("b", [observation("b")])]))
    assert materialize_pair_oracle(index, max_candidates=2, max_pairs=1) == [[0, 1, [0]]]
    with pytest.raises(ValueError, match="candidate bound"):
        materialize_pair_oracle(index, max_candidates=1, max_pairs=1)
    with pytest.raises(ValueError, match="pair bound"):
        materialize_pair_oracle(index, max_candidates=2, max_pairs=0)
    corrupt = copy.deepcopy(index)
    corrupt["placement_members"] = [[]]
    with pytest.raises(ValueError, match="bidirectional"):
        validate_atlas_membership(corrupt)


def test_real_pinned_s0_matches_every_legacy_pair_and_supporting_placement():
    retained = json.loads((ROOT / "web/data/topology-discovery.json").read_text())
    legacy = json.loads((ROOT / "api/data/market-field-graph.json").read_text())
    index = build_atlas_membership(retained)
    assert index["counts"]["candidates"] == 1_240
    assert index["counts"]["input_worklist_pairs"] == 100

    candidate_index = {candidate["id"]: position
                       for position, candidate in enumerate(index["candidates"])}
    placement_index = {}
    for position, placement in enumerate(index["placements"]):
        artifact_row = index["artifacts"][placement["artifact_index"]]
        legacy_key = (artifact_row["source"], artifact_row["inventory_year"],
                      placement["source_category"])
        assert legacy_key not in placement_index
        placement_index[legacy_key] = position
    expected = []
    for left, right, supports in legacy["pairs"]:
        left_id = legacy["candidates"][left]["id"]
        right_id = legacy["candidates"][right]["id"]
        expected.append((candidate_index[left_id], candidate_index[right_id],
                         tuple(sorted(placement_index[tuple(legacy["keys"][item])]
                                      for item in supports))))
    assert list(iter_exact_pairs(index)) == expected
    assert len(expected) == 47_288

    for category in legacy["facets"]["categories"]:
        selected = matching_placement_indices(index, category=category)
        expected_count = sum(1 for _, _, supports in expected if any(item in selected for item in supports))
        assert len(list(iter_exact_pairs(index, placement_indices=selected))) == expected_count
    for facet, values in (("source", legacy["facets"]["sources"]),
                          ("year", legacy["facets"]["years"])):
        for value in values:
            selected = matching_placement_indices(index, **{facet: value})
            expected_count = sum(1 for _, _, supports in expected
                                 if any(item in selected for item in supports))
            assert len(list(iter_exact_pairs(index, placement_indices=selected))) == expected_count

    for candidate_id in ("004c9f6b7ecc1c48c8e4", legacy["candidates"][-1]["id"]):
        result = select_candidate_neighborhood(index, candidate_id, limit=100_000)
        legacy_position = next(i for i, row in enumerate(legacy["candidates"])
                               if row["id"] == candidate_id)
        expected_neighbors = set()
        for pair_index in legacy["adjacency"][legacy_position]:
            left, right, _ = legacy["pairs"][pair_index]
            neighbor = right if left == legacy_position else left
            expected_neighbors.add(legacy["candidates"][neighbor]["id"])
        assert {row["candidate_id"] for row in result["neighbors"]} == expected_neighbors
