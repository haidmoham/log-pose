"""Publication must retain the ontology guard when database reviews select claims."""

import copy
import json
from pathlib import Path

import pytest

from log_pose.topology_export import validate_projected_topology


ROOT = Path(__file__).parents[1]


@pytest.fixture
def reviewed_projection():
    projection = json.loads((ROOT / "web/dashboard.json").read_text())["market_topology"]
    cohort = json.loads((ROOT / "docs/research/pilot-cohort.json").read_text())
    return projection, cohort


def test_valid_projection_keeps_hashes_quotes_reviews_and_empty_graph(reviewed_projection):
    projection, cohort = reviewed_projection
    original = copy.deepcopy(projection)
    validate_projected_topology(projection, cohort)
    assert projection == original
    validate_projected_topology(dict(projection, entities=[], claims=[], reviewed_at=None), cohort)


@pytest.mark.parametrize("field,value", [
    ("predicate", "related_to"), ("direction", "unknown"), ("claim_status", "certain"),
    ("scope", " "), ("interpretation", ""), ("alternative_or_unknown", None),
    ("temporal_basis", " "), ("temporal_form", "active_forever"),
])
def test_projection_rejects_invalid_claim_semantics(reviewed_projection, field, value):
    projection, cohort = reviewed_projection
    projection["claims"][0][field] = value
    with pytest.raises(ValueError):
        validate_projected_topology(projection, cohort)


@pytest.mark.parametrize("field,value", [
    ("source_date", None), ("source_date", "2024-02-30"),
    ("retrieved_at", "2026-09-24T12:00:00"), ("source_url", "http://example.com"),
    ("publisher", " "), ("source_type", ""), ("evidence_locator", ""),
    ("evidence_text", " "), ("role", "neutral"), ("role", "contradict"),
])
def test_projection_rejects_invalid_source_contract(reviewed_projection, field, value):
    projection, cohort = reviewed_projection
    projection["claims"][0]["sources"][0][field] = value
    with pytest.raises(ValueError):
        validate_projected_topology(projection, cohort)


@pytest.mark.parametrize("mutation", ["documented", "contradiction", "duplicate_origin", "no_uncertainty"])
def test_hypothesis_requires_its_basis_and_distinct_supporting_premises(reviewed_projection, mutation):
    projection, cohort = reviewed_projection
    claim = next(row for row in projection["claims"] if row["predicate"] == "shared_exposure_hypothesis")
    if mutation == "documented":
        claim["claim_status"] = "documented"
    elif mutation == "contradiction":
        claim["sources"][1]["role"] = "contradict"
    elif mutation == "duplicate_origin":
        for field in ("source_url", "source_date"):
            claim["sources"][1][field] = claim["sources"][0][field]
    else:
        claim["alternative_or_unknown"] = "Co-movement is established."
    with pytest.raises(ValueError):
        validate_projected_topology(projection, cohort)


def test_projection_preserves_contradiction_without_counting_it_as_support(reviewed_projection):
    projection, cohort = reviewed_projection
    claim = next(row for row in projection["claims"] if row["predicate"] == "shared_exposure_hypothesis")
    contradiction = dict(claim["sources"][0], id="denial-source", role="contradict",
                         source_url="https://example.com/denial", evidence_text="An attributed alternative.")
    claim["sources"].append(contradiction)
    validate_projected_topology(projection, cohort)
    assert claim["sources"][-1]["role"] == "contradict"


def test_projection_rejects_missing_review_and_false_pilot_identity(reviewed_projection):
    projection, cohort = reviewed_projection
    projection["claims"][0]["review"]["reviewer"] = ""
    with pytest.raises(ValueError, match="reviewer"):
        validate_projected_topology(projection, cohort)
    projection["claims"][0]["review"]["reviewer"] = "reviewer"
    projection["entities"][0]["name"] = "Different company"
    with pytest.raises(ValueError, match="identity differs"):
        validate_projected_topology(projection, cohort)
