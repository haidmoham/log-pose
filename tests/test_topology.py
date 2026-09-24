import copy
import json
from pathlib import Path

import pytest

from log_pose.topology import build_market_neighbor_queue, validate_topology
from scripts.capture_topology_sources import capture_one


ROOT = Path(__file__).resolve().parents[1]


def _topology_and_cohort():
    topology = json.loads((ROOT / "docs/research/market-topology.json").read_text())
    cohort = json.loads((ROOT / "docs/research/pilot-cohort.json").read_text())
    return topology, cohort


def test_reviewed_topology_has_valid_ids_sources_dates_and_artifact_hashes():
    topology, cohort = _topology_and_cohort()
    validate_topology(topology, cohort, repository_root=ROOT)
    assert {claim["predicate"] for claim in topology["claims"]} == {
        "named_competitor_of", "announced_partnership_with", "invested_in",
        "shared_exposure_hypothesis",
    }
    assert all(source["retrieved_on"] == "2026-09-24"
               for claim in topology["claims"] for source in claim["sources"])


def test_topology_rejects_wrong_endpoint_and_unpinned_source():
    topology, cohort = _topology_and_cohort()
    broken = copy.deepcopy(topology)
    broken["claims"][0]["object_slug"] = "unknown-company"
    with pytest.raises(ValueError, match="unresolved or identical endpoints"):
        validate_topology(broken, cohort, repository_root=ROOT)


def test_topology_supports_reviewed_external_company_endpoints():
    topology, cohort = _topology_and_cohort()
    external = copy.deepcopy(topology)
    external["entities"] = [entity for entity in external["entities"] if entity["slug"] != "elastic"]
    external["entities"].append({
        "slug": "elastic-external",
        "name": "Elastic",
        "category": "security_observability",
        "identity_status": "reviewed_company",
    })
    external["claims"][0]["object_slug"] = "elastic-external"
    validate_topology(external, cohort, repository_root=ROOT)

    broken = copy.deepcopy(topology)
    broken["claims"][0]["sources"][0]["artifact_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="artifact hash differs"):
        validate_topology(broken, cohort, repository_root=ROOT)


def test_shared_exposure_requires_two_sources_and_untested_outcome():
    topology, cohort = _topology_and_cohort()
    broken = copy.deepcopy(topology)
    claim = broken["claims"][-1]
    claim["sources"] = claim["sources"][:1]
    with pytest.raises(ValueError, match="needs two sources"):
        validate_topology(broken, cohort, repository_root=ROOT)

    broken = copy.deepcopy(topology)
    broken["claims"][-1]["alternative_or_unknown"] = "Co-movement was observed."
    with pytest.raises(ValueError, match="co-movement is untested"):
        validate_topology(broken, cohort, repository_root=ROOT)


def test_discovery_queue_is_bounded_reproducible_and_never_a_claim():
    discovery = json.loads((ROOT / "web/discovery.json").read_text())
    queue = build_market_neighbor_queue(discovery, limit=100, random_seed=17)
    repeated = build_market_neighbor_queue(discovery, limit=100, random_seed=17)
    assert queue == repeated
    assert queue["candidate_entity_count"] == 1091
    assert len(discovery["candidates"]) == 1111
    assert len(queue["pairs"]) == 100
    assert queue["priority_selection_count"] == 50
    assert queue["source_year_stratified_count"] == 25
    assert queue["random_selection_count"] == 25
    assert all(item["claim"] is None for item in queue["pairs"])
    assert all("needs_company_identity" in item["status"] for item in queue["pairs"])
    assert {item["selection_method"] for item in queue["pairs"]} == {
        "highest_shared_category_and_year_overlap",
        "source_year_stratified_sample",
        "deterministic_random_sample",
    }


def test_discovery_queue_requires_category_overlap_in_the_same_source_and_year():
    discovery = json.loads((ROOT / "web/discovery.json").read_text())
    queue = build_market_neighbor_queue(discovery, limit=100)
    candidates = {item["id"]: item for item in discovery["candidates"]}
    occurrences = {item["id"]: item for item in discovery["occurrences"]}

    def observations(candidate_id):
        result = set()
        for occurrence_id in candidates[candidate_id]["occurrence_ids"]:
            occurrence = occurrences[occurrence_id]
            category = occurrence["source_category"]
            if occurrence.get("source_subcategory"):
                category += f" / {occurrence['source_subcategory']}"
            result.add((occurrence["source"], occurrence["year"], category))
        return result

    for pair in queue["pairs"]:
        shared = (observations(pair["subject_candidate_id"])
                  & observations(pair["object_candidate_id"]))
        assert shared
        assert pair["shared_source_categories"] == sorted({category for _, _, category in shared})
        assert pair["shared_inventory_years"] == sorted({year for _, year, _ in shared})
        assert pair["shared_inventory_sources"] == sorted({source for source, _, _ in shared})
        assert pair["source_year_strata"] == sorted({f"{source}:{year}" for source, year, _ in shared})


def test_source_capture_uses_manifest_time_not_checkout_file_mtime(tmp_path):
    import hashlib

    raw = b"captured evidence"
    artifact = tmp_path / "source.html"
    artifact.write_bytes(raw)
    retrieved_at = "2026-09-24T17:50:30+00:00"
    result = capture_one({
        "id": "source",
        "source_url": "https://example.com/source",
        "artifact_path": "source.html",
        "expected_sha256": hashlib.sha256(raw).hexdigest(),
        "retrieved_at": retrieved_at,
    }, repository_root=tmp_path, max_bytes=1024, retries=0, timeout_seconds=0.1)
    assert result["retrieved_at"] == retrieved_at
    assert result["outcome"] == "verified_existing"
