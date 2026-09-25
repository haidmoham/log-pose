import copy
import hashlib
import json
from collections import defaultdict
from itertools import combinations
from pathlib import Path

import pytest

from log_pose.topology_discovery import export_topology_discovery


ROOT = Path(__file__).parents[1]


@pytest.fixture(scope="module")
def inputs():
    discovery_bytes = (ROOT / "web/discovery.json").read_bytes()
    queue_bytes = (ROOT / "docs/research/topology-review-queue.json").read_bytes()
    return (json.loads(discovery_bytes), json.loads(queue_bytes),
            {"discovery_sha256": hashlib.sha256(discovery_bytes).hexdigest(),
             "queue_sha256": hashlib.sha256(queue_bytes).hexdigest()})


@pytest.fixture(scope="module")
def projection(inputs):
    discovery, queue, hashes = inputs
    return export_topology_discovery(discovery, queue, **hashes)


def test_full_frame_and_exact_observations_reconstruct_all_possible_pairs(inputs, projection):
    discovery, queue, _ = inputs
    assert projection["counts"]["nodes"] == queue["candidate_entity_count"] == 1240
    assert len(projection["edges"]) == len(queue["pairs"]) == 100
    occurrences = {row["id"]: row for row in discovery["occurrences"]}
    candidates = {row["id"]: row for row in discovery["candidates"]}
    artifacts = {row["raw_sha256"]: row for row in projection["artifacts"]}
    groups = defaultdict(set)
    node_observations = {}
    for node in projection["nodes"]:
        node_observations[node["id"]] = {}
        resolved_ids = []
        for observation in node["observations"]:
            key = (observation["source"], observation["year"], observation["source_category"])
            groups[key].add(node["id"])
            node_observations[node["id"]][key] = observation
            assert observation["partition_path"] == artifacts[observation["artifact_sha256"]]["partition_path"]
            assert (ROOT / "web" / observation["partition_path"]).is_file()
            assert observation["occurrence_ids"] == [row["id"] for row in observation["rows"]]
            for row in observation["rows"]:
                original = occurrences[row["id"]]
                assert all(original[field] == value for field, value in row.items())
                category = original["source_category"]
                if original["source_subcategory"]:
                    category += " / " + original["source_subcategory"]
                assert key == (original["source"], original["year"], category)
                assert observation["artifact_sha256"] == original["artifact_sha256"]
                resolved_ids.append(row["id"])
        assert sorted(resolved_ids) == sorted(candidates[node["id"]]["occurrence_ids"])
    possible_pairs = {pair for members in groups.values() for pair in combinations(sorted(members), 2)}
    assert len(possible_pairs) == projection["counts"]["possible_pairs"] == 47288
    for edge in projection["edges"]:
        subject = node_observations[edge["subject_candidate_id"]]
        object_ = node_observations[edge["object_candidate_id"]]
        expected = subject.keys() & object_.keys()
        assert expected == {(row["source"], row["year"], row["source_category"])
                            for row in edge["observations"]}
        for row in edge["observations"]:
            key = (row["source"], row["year"], row["source_category"])
            assert row["subject_rows"] == subject[key]["rows"]
            assert row["object_rows"] == object_[key]["rows"]


def test_projection_preserves_identity_boundaries_and_no_relationship_claims(inputs, projection):
    discovery, _, _ = inputs
    candidates = {row["id"]: row for row in discovery["candidates"]}
    reviews = {row["id"]: row for row in discovery["identity_reviews"]}
    assert projection["status"] == "unreviewed_inventory_overlap"
    assert projection["counts"]["reviewed_relationships"] == 0
    for node in projection["nodes"]:
        original = candidates[node["id"]]
        assert node["company_eligibility"] == node["relationship_status"] == "unreviewed"
        assert node["navigation_match"] == original.get("pilot_match")
        assert node["identity_review"] == reviews.get(original.get("identity_review_id"))
        assert "slug" not in node
    for edge in projection["edges"]:
        assert edge["claim"] is None
        assert edge["status"] == "needs_company_identity_and_relation_evidence"
        assert "predicate" not in edge and "claim_status" not in edge


@pytest.mark.parametrize("mutation", ["fingerprint", "claim", "overlap"])
def test_stale_or_tampered_queue_cannot_publish(inputs, mutation):
    discovery, queue, hashes = inputs
    changed = copy.deepcopy(queue)
    if mutation == "fingerprint":
        changed["input_sha256"] = "0" * 64
    elif mutation == "claim":
        changed["pairs"][0]["claim"] = "accepted"
    else:
        changed["pairs"][0]["shared_inventory_years"] = [1999]
    with pytest.raises(ValueError, match="stale|deterministic"):
        export_topology_discovery(discovery, changed, **hashes)


def test_projection_is_deterministic_and_generated_file_matches(inputs, projection):
    discovery, queue, hashes = inputs
    assert export_topology_discovery(discovery, queue, **hashes) == projection
    assert json.loads((ROOT / "web/data/topology-discovery.json").read_text()) == projection
