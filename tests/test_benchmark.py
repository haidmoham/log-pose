from __future__ import annotations

import json
from pathlib import Path

import pytest

from log_pose.benchmark import (
    ArtifactReceipt,
    BenchmarkError,
    _case_label,
    agent_case_view,
    brier_score,
    classify_claim,
    load_artifact,
    load_cases,
    load_labels,
    log_score,
    ranking_metrics,
    resolve_binary_outcome,
    run_benchmark,
    scored_ranking_metrics,
    temporal_eligibility,
)


ROOT = Path(__file__).resolve().parents[1]


def cases_and_labels():
    cases = load_cases(ROOT)["cases"]
    labels = load_labels(ROOT)["labels"]
    return cases, labels


def find_case(case_id):
    cases, labels = cases_and_labels()
    case = next(item for item in cases if item["id"] == case_id)
    return case, labels[case_id]


def test_manifest_has_twenty_versioned_cases_and_keeps_evaluator_refs_hidden():
    cases, labels = cases_and_labels()
    assert len(cases) == 20
    assert all(case["version"] == 1 for case in cases)
    assert all(case["allowed_artifact_ids"] == [ref["artifact_id"] for ref in labels[case["id"]]["artifacts"]] for case in cases)
    for case in cases:
        visible = agent_case_view(case)
        assert "hidden_answer_or_outcome_ref" not in visible
        assert "artifacts" not in visible
        assert "evaluator_artifact_refs" not in visible
        assert all("sha256" not in artifact_id for artifact_id in visible["allowed_artifact_ids"])
    assert labels["case-18"]["objective_status"] == "contradictory_pair_not_retained"


def test_case_hashes_are_pinned_to_source_and_partition_bytes():
    cases, labels = cases_and_labels()
    page_case = next(case for case in cases if case["id"] == "case-01")
    receipt = load_artifact(ROOT, labels[page_case["id"]]["artifacts"][0])
    assert receipt.sha256
    assert receipt.content
    assert len(receipt.sha256) == 64


def test_public_availability_and_system_known_apply_different_clocks():
    case, label = find_case("case-08")
    receipt = load_artifact(ROOT, label["artifacts"][0])
    assert receipt.availability_at.startswith("2024-12-14")
    assert receipt.ingested_at.startswith("2026-")
    assert temporal_eligibility(receipt, case["cutoff"], "public_availability") == (True, "eligible_historical_reconstruction")
    assert temporal_eligibility(receipt, case["cutoff"], "system_known") == (False, "ingested_after_cutoff")


def test_event_publication_and_ingestion_times_are_not_interchangeable():
    case, label = find_case("case-13")
    receipt = load_artifact(ROOT, label["artifacts"][0])
    assert receipt.event_at == "2022-02-24"
    assert receipt.availability_at == "2022-02-24"
    assert receipt.ingested_at.startswith("2026-")
    assert temporal_eligibility(receipt, case["cutoff"], "public_availability") == (False, "content_version_not_proven_at_cutoff")
    assert temporal_eligibility(receipt, case["cutoff"], "system_known") == (False, "ingested_after_cutoff")


def test_post_cutoff_filing_and_later_derived_review_are_rejected():
    case, label = find_case("case-10")
    filing = load_artifact(ROOT, label["artifacts"][0])
    assert temporal_eligibility(filing, case["cutoff"], "public_availability") == (False, "not_available_by_cutoff")
    review_case, review_label = find_case("case-14")
    review = next(ref for ref in review_label["artifacts"] if ref["artifact_type"] == "review_bundle")
    review_receipt = load_artifact(ROOT, review)
    assert temporal_eligibility(review_receipt, review_case["cutoff"], "system_known") == (False, "missing_historical_proof")


def test_strict_replay_fails_closed_without_historical_proof_and_date_cutoff_includes_day():
    receipt = ArtifactReceipt("unknown", "page", "x", "hash", "2024-12-31T18:00:00Z", None, None, "none")
    assert temporal_eligibility(receipt, "2024-12-31", "public_availability") == (False, "missing_historical_proof")
    dated_archive = ArtifactReceipt("archive", "page", "x", "hash", "2024-12-31T18:00:00Z", None, None, "archive_capture")
    assert temporal_eligibility(dated_archive, "2024-12-31", "public_availability") == (True, "eligible_historical_reconstruction")


def test_semantic_categories_do_not_collapse_into_truth_or_probability():
    assert classify_claim({"kind": "source_statement"}) == "attributed_statement"
    assert classify_claim({"kind": "economic_truth"}) == "economic_truth"
    assert classify_claim({"kind": "graph_hypothesis", "review_status": "accepted_hypothesis"}) == "reviewed_hypothesis"
    assert classify_claim({"kind": "relationship_absence", "observed_edge": None}) == "unknown_absence_of_evidence"
    assert classify_claim({"kind": "relationship_absence", "observed_edge": "negative_source_evidence"}) == "observed_negative_evidence"
    assert classify_claim({"kind": "unrecognized"}) == "unknown"


def test_unknown_and_censored_outcomes_are_not_false():
    assert resolve_binary_outcome("event_observed") == 1
    assert resolve_binary_outcome("horizon_complete_no_event") == 0
    for state in ("unknown", "censored", "identity_unresolved", "horizon_unelapsed"):
        assert resolve_binary_outcome(state) is None
    with pytest.raises(BenchmarkError):
        resolve_binary_outcome("failed_to_find_source")


def test_proper_score_denominators_clipping_and_unresolved_labels():
    rows = ((p, y) for p, y in [(0.75, 1), (0.4, 0), (0.6, None)])
    assert brier_score(rows) == {"value": pytest.approx(0.11125), "denominator": 2, "unresolved": 1}
    clipped = log_score([(0.0, 1), (0.5, None)])
    assert clipped["denominator"] == 1
    assert clipped["unresolved"] == 1
    assert clipped["epsilon"] == 1e-15
    assert brier_score([(0.1, None)]) == {"value": None, "denominator": 0, "unresolved": 1}
    assert log_score([])["value"] is None
    with pytest.raises(BenchmarkError):
        brier_score([(1.2, 1)])


def test_ranking_ties_have_deterministic_rule_and_undefined_no_positive_case():
    tied = scored_ranking_metrics([("z", 0.8), ("a", 0.8), ("b", 0.2)], {"a"}, 1)
    assert tied["ranked_ids"] == ["a", "z", "b"]
    assert tied["tie_policy"] == "descending_score_then_ascending_id"
    assert tied["precision_at_k"] == 1.0
    assert ranking_metrics(["a", "b"], set(), 1)["status"] == "undefined_no_positives"
    assert ranking_metrics(["a", "b"], set(), 1)["precision_at_k"] is None
    with pytest.raises(BenchmarkError):
        scored_ranking_metrics([("a", 0.8), ("a", 0.2)], {"a"}, 1)


def test_offline_controls_are_deterministic_and_case_receipts_retain_blocks(tmp_path):
    first = run_benchmark(ROOT, tmp_path / "one")
    second = run_benchmark(ROOT, tmp_path / "two")
    assert first == second
    assert (tmp_path / "one" / "benchmark-scorecard.json").read_bytes() == (tmp_path / "two" / "benchmark-scorecard.json").read_bytes()
    assert first["counts"]["cases"] == 20
    assert first["credentialed_models_executed"] is False
    assert first["controls"]["capture_aware_exact_span"]["temporal_violations"] == 0
    assert first["controls"]["publication_date_only"]["temporal_violations"] > 0
    assert first["controls"]["supplied_prediction_fixture"]["case_count"] == 20
    assert first["controls"]["capture_aware_exact_span"]["cost"]["latency_ms"] is None
    assert first["controls"]["capture_aware_exact_span"]["cases"][17]["case_id"] == "case-18"
    assert first["controls"]["capture_aware_exact_span"]["cases"][17]["status"] == "abstained"
    fixture = first["synthetic_score_rule_fixture"]
    assert fixture["purpose"].startswith("synthetic metric contract")
    assert fixture["brier"]["denominator"] == 2
    assert fixture["brier"]["unresolved"] == 2


def test_pinned_partition_mismatch_fails_closed(tmp_path):
    case, label = find_case("case-01")
    reference = dict(label["artifacts"][0])
    reference["partition_sha256"] = "0" * 64
    with pytest.raises(BenchmarkError, match="pinned partition hash mismatch"):
        load_artifact(ROOT, reference)
