"""Offline, fail-closed replay checks for the frozen research benchmark."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BENCHMARK_DIR = Path(__file__).resolve().parent
CASE_MANIFEST = BENCHMARK_DIR / "data" / "cases-v1.json"
LABEL_MANIFEST = BENCHMARK_DIR / "data" / "evaluator-labels-v1.json"
PREDICTION_FIXTURES = BENCHMARK_DIR / "data" / "prediction-fixtures-v1.json"


class BenchmarkError(ValueError):
    """Raised when an input does not satisfy the versioned benchmark contract."""


@dataclass(frozen=True)
class ArtifactReceipt:
    artifact_id: str
    artifact_type: str
    path: str
    sha256: str
    availability_at: str | None
    event_at: str | None
    ingested_at: str | None
    historical_proof: str
    content: str | None = None
    source_statement: bool = False


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    if len(value) == 10:
        return datetime.combine(date.fromisoformat(value), datetime.max.time(), tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _before_or_on(value: str | None, cutoff: datetime) -> bool:
    parsed = _parse_time(value)
    return parsed is not None and parsed <= cutoff


def _load_json(root: Path, relative_path: str) -> Any:
    try:
        return json.loads((root / relative_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchmarkError(f"cannot load {relative_path}: {exc}") from exc


def load_cases(root: Path, manifest_path: Path = CASE_MANIFEST) -> dict[str, Any]:
    manifest = _load_json(root, str(manifest_path))
    if manifest.get("schema_version") != "1.0" or manifest.get("version") != "benchmark-cases-v1":
        raise BenchmarkError("unsupported case manifest version")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or len(cases) != 20:
        raise BenchmarkError("the frozen benchmark must contain exactly 20 cases")
    ids = [case.get("id") for case in cases]
    if len(set(ids)) != len(ids) or any(not value for value in ids):
        raise BenchmarkError("case IDs must be present and unique")
    for case in cases:
        if "hidden_answer_or_outcome_ref" in case or "answer" in case or "expected_claim" in case:
            raise BenchmarkError(f"agent-visible case {case['id']} contains a hidden answer")
        if case.get("version") != 1:
            raise BenchmarkError(f"case {case['id']} has an unsupported version")
    return manifest


def load_labels(root: Path, label_path: Path = LABEL_MANIFEST) -> dict[str, Any]:
    labels = _load_json(root, str(label_path))
    if labels.get("schema_version") != "1.0" or labels.get("version") != "evaluator-labels-v1":
        raise BenchmarkError("unsupported evaluator label manifest version")
    return labels


def agent_case_view(case: dict[str, Any]) -> dict[str, Any]:
    """Return only fields an evaluated agent may see; never include evaluator refs."""
    forbidden = {"hidden_answer_or_outcome_ref", "answer", "expected_claim", "expected_status", "artifacts", "evaluator_artifact_refs"}
    return {key: value for key, value in case.items() if key not in forbidden}


def _partition_record(root: Path, partition_path: str, artifact_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    index = _load_json(root, "web/data/index.json")
    partition_meta = index.get("partitions", {}).get(partition_path)
    if not partition_meta:
        raise BenchmarkError(f"partition is absent from catalog: {partition_path}")
    payload = (root / "web" / partition_path).read_bytes()
    actual_partition_hash = hashlib.sha256(payload).hexdigest()
    if actual_partition_hash != partition_meta.get("sha256"):
        raise BenchmarkError(f"partition hash mismatch: {partition_path}")
    partition = json.loads(payload)
    matches = [record for record in partition.get("records", []) if record.get("id") == artifact_id]
    if len(matches) != 1:
        raise BenchmarkError(f"expected one {artifact_id} in {partition_path}, found {len(matches)}")
    return matches[0], partition_meta


def load_artifact(root: Path, reference: dict[str, Any]) -> ArtifactReceipt:
    artifact_type = reference["artifact_type"]
    relative_path = reference["path"]
    artifact_id = reference["artifact_id"]
    expected_hash = reference["sha256"]
    if artifact_type in {"page", "sec_fact"}:
        record, partition_meta = _partition_record(root, relative_path, artifact_id)
        if partition_meta.get("sha256") != reference.get("partition_sha256"):
            raise BenchmarkError(f"pinned partition hash mismatch: {relative_path}")
        actual_hash = record.get("text_sha256") if artifact_type == "page" else record.get("raw_sha256")
        if artifact_type == "page":
            text = record.get("normalized_text", "")
            if hashlib.sha256(text.encode("utf-8")).hexdigest() != record.get("text_sha256"):
                raise BenchmarkError(f"normalized text hash mismatch: {artifact_id}")
            if record.get("raw_sha256") != reference.get("source_hash"):
                raise BenchmarkError(f"pinned source digest metadata mismatch: {artifact_id}")
        else:
            text = None
        if actual_hash != expected_hash:
            raise BenchmarkError(f"artifact hash mismatch: {artifact_id}")
        return ArtifactReceipt(
            artifact_id=artifact_id,
            artifact_type=artifact_type,
            path=relative_path,
            sha256=expected_hash,
            availability_at=record.get("captured_at") if artifact_type == "page" else record.get("filed_date"),
            event_at=record.get("end_date") if artifact_type == "sec_fact" else None,
            ingested_at=record.get("ingested_at") if artifact_type == "page" else record.get("retrieved_at"),
            historical_proof="archive_capture" if artifact_type == "page" and record.get("archive_url") else "none",
            content=text,
            source_statement=artifact_type == "page",
        )
    path = root / relative_path
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise BenchmarkError(f"cannot read artifact {relative_path}: {exc}") from exc
    if hashlib.sha256(payload).hexdigest() != expected_hash:
        raise BenchmarkError(f"artifact hash mismatch: {artifact_id}")
    if artifact_type == "topology_html":
        availability = reference.get("published_at")
        event_at = reference.get("event_at")
        ingested = reference.get("retrieved_at")
        historical_proof = "publication_record_only" if availability else "none"
        return ArtifactReceipt(artifact_id, artifact_type, relative_path, expected_hash, availability, event_at, ingested, historical_proof, payload.decode("utf-8", errors="replace"), True)
    if artifact_type == "discovery_snapshot":
        availability = reference.get("commit_at")
        return ArtifactReceipt(artifact_id, artifact_type, relative_path, expected_hash, availability, None, None, "immutable_repository_commit", payload.decode("utf-8", errors="replace"), False)
    if artifact_type == "review_bundle":
        return ArtifactReceipt(artifact_id, artifact_type, relative_path, expected_hash, reference.get("recorded_at"), None, reference.get("recorded_at"), "none", payload.decode("utf-8", errors="replace"), False)
    raise BenchmarkError(f"unsupported artifact type {artifact_type}")


def temporal_eligibility(receipt: ArtifactReceipt, cutoff_value: str, replay_mode: str) -> tuple[bool, str]:
    cutoff = _parse_time(cutoff_value)
    if cutoff is None:
        raise BenchmarkError("case cutoff is required")
    if replay_mode == "system_known":
        if receipt.historical_proof == "none":
            return False, "missing_historical_proof"
        if not _before_or_on(receipt.availability_at, cutoff):
            return False, "not_available_by_cutoff"
        if receipt.ingested_at is None:
            return False, "missing_ingestion_time"
        if not _before_or_on(receipt.ingested_at, cutoff):
            return False, "ingested_after_cutoff"
        return True, "eligible_system_known"
    if replay_mode not in {"public_availability", "historical_reconstruction"}:
        raise BenchmarkError(f"unknown replay mode: {replay_mode}")
    if receipt.historical_proof == "none":
        return False, "missing_historical_proof"
    if not _before_or_on(receipt.availability_at, cutoff):
        return False, "not_available_by_cutoff"
    if receipt.historical_proof == "publication_record_only":
        return False, "content_version_not_proven_at_cutoff"
    return True, "eligible_historical_reconstruction"


def lexical_span(text: str | None, terms: Iterable[str]) -> str | None:
    """Return the first exact line containing every requested term, case-insensitively."""
    if not text:
        return None
    normalized_terms = tuple(term.casefold() for term in terms if term.strip())
    if not normalized_terms:
        return None
    for line in text.splitlines():
        folded = line.casefold()
        if all(term in folded for term in normalized_terms):
            first_match = min(folded.find(term) for term in normalized_terms)
            left = max(0, first_match - 80)
            right = min(len(line), left + 240)
            return line[left:right].strip()
    return None


def brier_score(predictions: Iterable[tuple[float, int | None]]) -> dict[str, Any]:
    rows = [(float(probability), outcome) for probability, outcome in predictions]
    resolved = [(probability, outcome) for probability, outcome in rows if outcome is not None]
    if not resolved:
        return {"value": None, "denominator": 0, "unresolved": sum(1 for _, outcome in rows if outcome is None)}
    if any(not 0 <= probability <= 1 or outcome not in (0, 1) for probability, outcome in resolved):
        raise BenchmarkError("Brier inputs require probabilities in [0, 1] and binary resolved outcomes")
    return {
        "value": sum((probability - outcome) ** 2 for probability, outcome in resolved) / len(resolved),
        "denominator": len(resolved),
        "unresolved": sum(1 for _, outcome in rows if outcome is None),
    }


def log_score(predictions: Iterable[tuple[float, int | None]], epsilon: float = 1e-15) -> dict[str, Any]:
    rows = [(float(probability), outcome) for probability, outcome in predictions]
    resolved = [(probability, outcome) for probability, outcome in rows if outcome is not None]
    if not resolved:
        return {"value": None, "denominator": 0, "unresolved": sum(1 for _, outcome in rows if outcome is None)}
    if epsilon <= 0 or epsilon >= 0.5:
        raise BenchmarkError("epsilon must be between 0 and 0.5")
    if any(not 0 <= probability <= 1 or outcome not in (0, 1) for probability, outcome in resolved):
        raise BenchmarkError("log-score inputs require probabilities in [0, 1] and binary resolved outcomes")
    total = 0.0
    for probability, outcome in resolved:
        clipped = min(1 - epsilon, max(epsilon, probability))
        total -= outcome * math.log(clipped) + (1 - outcome) * math.log(1 - clipped)
    return {"value": total / len(resolved), "denominator": len(resolved), "unresolved": sum(1 for _, outcome in rows if outcome is None), "epsilon": epsilon}


def ranking_metrics(ranked_ids: list[str], relevant_ids: set[str], k: int) -> dict[str, Any]:
    if k <= 0:
        raise BenchmarkError("K must be positive")
    if len(ranked_ids) != len(set(ranked_ids)):
        raise BenchmarkError("ranking IDs must be unique; resolve ties before evaluation")
    if not relevant_ids:
        return {"precision_at_k": None, "recall_at_k": None, "denominator": 0, "status": "undefined_no_positives", "k": k}
    selected = ranked_ids[:k]
    hits = sum(item in relevant_ids for item in selected)
    precision_denominator = min(k, len(ranked_ids))
    return {"precision_at_k": hits / precision_denominator if precision_denominator else None, "recall_at_k": hits / len(relevant_ids), "precision_denominator": precision_denominator, "recall_denominator": len(relevant_ids), "denominator": len(relevant_ids), "status": "defined", "k": k}


def scored_ranking_metrics(scored_items: list[tuple[str, float]], relevant_ids: set[str], k: int) -> dict[str, Any]:
    """Resolve equal scores by stable ID order before calculating top-K metrics."""
    if len({item_id for item_id, _ in scored_items}) != len(scored_items):
        raise BenchmarkError("ranking IDs must be unique")
    ordered = sorted(scored_items, key=lambda item: (-item[1], item[0]))
    result = ranking_metrics([item_id for item_id, _ in ordered], relevant_ids, k)
    result["tie_policy"] = "descending_score_then_ascending_id"
    result["ranked_ids"] = [item_id for item_id, _ in ordered]
    return result


def resolve_binary_outcome(status: str) -> int | None:
    """Map declared resolution states to binary labels without coercing censoring."""
    if status == "event_observed":
        return 1
    if status == "horizon_complete_no_event":
        return 0
    if status in {"unknown", "censored", "identity_unresolved", "horizon_unelapsed"}:
        return None
    raise BenchmarkError(f"unsupported outcome resolution state: {status}")


def classify_claim(claim: dict[str, Any]) -> str:
    """Return an epistemic category without treating one as another."""
    if claim.get("kind") == "source_statement":
        return "attributed_statement"
    if claim.get("kind") == "economic_truth":
        return "economic_truth"
    if claim.get("kind") == "graph_hypothesis":
        if claim.get("review_status") == "accepted_hypothesis":
            return "reviewed_hypothesis"
        return "unreviewed_hypothesis"
    if claim.get("kind") == "relationship_absence":
        return "unknown_absence_of_evidence" if claim.get("observed_edge") is None else "observed_negative_evidence"
    return "unknown"


def _case_label(label_map: dict[str, Any], case_id: str) -> dict[str, Any]:
    try:
        return label_map[case_id]
    except KeyError as exc:
        raise BenchmarkError(f"missing evaluator-only label for {case_id}") from exc


def _run_control(case: dict[str, Any], root: Path, control: str, label: dict[str, Any]) -> dict[str, Any]:
    evidence_receipts = []
    references = label.get("artifacts", [])
    if {reference.get("artifact_id") for reference in references} != set(case.get("allowed_artifact_ids", [])):
        raise BenchmarkError(f"allowed artifact IDs do not match evaluator references for {case['id']}")
    for reference in references:
        receipt = load_artifact(root, reference)
        eligible, reason = temporal_eligibility(receipt, case["cutoff"], case["replay_mode"])
        if control == "capture_aware_exact_span" and not eligible:
            continue
        if control == "publication_date_only" and reason in {"missing_historical_proof", "content_version_not_proven_at_cutoff", "ingested_after_cutoff", "not_available_by_cutoff"}:
            # This named comparison control ignores archive/version and ingestion proofs.
            if _before_or_on(receipt.availability_at, _parse_time(case["cutoff"])):
                eligible = True
                reason = "date_only_eligible_missing_proof"
            elif receipt.availability_at is None and _before_or_on(reference.get("published_at"), _parse_time(case["cutoff"])):
                eligible = True
                reason = "date_only_eligible_missing_version_proof"
        terms = case.get("query_terms", [])
        span = lexical_span(receipt.content, terms) if receipt.content else None
        if control == "supplied_prediction_fixture":
            fixture = label.get("supplied_prediction", {})
            citation_ids = list(fixture.get("artifact_ids", []))
            if receipt.artifact_id not in citation_ids or not eligible:
                continue
            span = lexical_span(receipt.content, terms)
            reason = "supplied_fixture"
        if eligible and (span or control == "supplied_prediction_fixture"):
            evidence_receipts.append({"artifact_id": receipt.artifact_id, "span": span, "eligibility": reason, "artifact_sha256": receipt.sha256})
    if control == "supplied_prediction_fixture" and label.get("supplied_prediction", {}).get("abstain"):
        evidence_receipts = []
    violations = []
    for evidence in evidence_receipts:
        if evidence["eligibility"] not in {"eligible_historical_reconstruction", "eligible_system_known", "supplied_fixture"}:
            violations.append(evidence["eligibility"])
    return {
        "case_id": case["id"],
        "status": "answered" if evidence_receipts else "abstained",
        "evidence": evidence_receipts,
        "temporal_violations": violations,
        "semantic_label_status": case.get("semantic_label_status", "unavailable"),
        "objective_status": label.get("objective_status", "unresolved"),
        "evaluation_note": label.get("note"),
        "semantic_correctness": None,
        "cost": {"model_calls": 0, "tokens": 0, "latency_ms": None},
    }


def run_benchmark(root: Path, output_dir: Path) -> dict[str, Any]:
    cases_manifest = load_cases(root)
    labels_manifest = load_labels(root)
    label_map = labels_manifest.get("labels", {})
    controls = ["capture_aware_exact_span", "publication_date_only", "supplied_prediction_fixture"]
    results: dict[str, list[dict[str, Any]]] = {}
    for control in controls:
        results[control] = [_run_control(case, root, control, _case_label(label_map, case["id"])) for case in cases_manifest["cases"]]

    case_manifest_hash = canonical_sha256(cases_manifest)
    prediction_fixture = _load_json(root, str(PREDICTION_FIXTURES))
    if prediction_fixture.get("version") != "prediction-fixtures-v1" or prediction_fixture.get("fixture_type") != "synthetic_metric_contract_only":
        raise BenchmarkError("prediction fixture must be explicitly synthetic")
    prediction_rows = [(row["probability"], resolve_binary_outcome(row["resolution_status"])) for row in prediction_fixture["predictions"]]
    score_rule_fixture = {
        "purpose": "synthetic metric contract smoke check; not company evidence or model performance",
        "brier": brier_score(prediction_rows),
        "log_loss": log_score(prediction_rows),
        "rows": len(prediction_rows),
    }
    control_summaries = {}
    for control, rows in results.items():
        violation_count = sum(len(row["temporal_violations"]) for row in rows)
        answer_count = sum(row["status"] == "answered" for row in rows)
        control_summaries[control] = {
            "run": {
                "case_manifest_hash": case_manifest_hash,
                "code_commit": _git_commit(root),
                "model_or_policy_version": control + "-v1",
                "prompt_hash": canonical_sha256([case["question"] for case in cases_manifest["cases"]]),
                "representation_version": "retained-normalized-text-v1",
                "seed": None,
                "observed_artifact_ids": sorted({item["artifact_id"] for row in rows for item in row["evidence"]}),
                "action_trace": [{"case_id": row["case_id"], "action": row["status"], "artifact_ids": [item["artifact_id"] for item in row["evidence"]]} for row in rows],
                "predictions_or_answers": [{"case_id": row["case_id"], "status": row["status"], "spans": [item["span"] for item in row["evidence"]]} for row in rows],
                "cost_and_latency": {"model_calls": 0, "tokens": 0, "latency_ms": None},
                "grader_version": "mechanical-temporal-and-provenance-v1",
                "violations": [row["case_id"] for row in rows if row["temporal_violations"]],
            },
            "case_count": len(rows),
            "answered": answer_count,
            "abstained": len(rows) - answer_count,
            "coverage": answer_count / len(rows) if rows else None,
            "temporal_violations": violation_count,
            "semantic_scores": "not_scored_independent_review_unavailable",
            "cost": {"model_calls": 0, "tokens": 0, "latency_ms": None},
            "cases": rows,
        }
    report = {
        "schema_version": "1.0",
        "benchmark_version": cases_manifest["version"],
        "case_manifest_sha256": case_manifest_hash,
        "code_commit": _git_commit(root),
        "execution": "offline_deterministic_controls_only",
        "credentialed_models_executed": False,
        "synthetic_score_rule_fixture": score_rule_fixture,
        "counts": {
            "cases": len(cases_manifest["cases"]),
            "semantic_labels_provisional_or_blocked": sum(case.get("semantic_label_status") != "independently_reviewed" for case in cases_manifest["cases"]),
            "companies": len({company for case in cases_manifest["cases"] for company in case.get("entity_ids", [])}),
        },
        "unmeasured": ["semantic claim correctness", "forecast skill and calibration", "diligence ranking utility", "research policy value", "investment returns", "causal effects"],
        "blocked": ["contradiction case lacks a retained contradictory source pair", "independent semantic review is unavailable", "historical SEC companyfacts version is not proven as-of its filing date", "portfolio entry terms, ownership, dilution, cash flows, and liquidity are absent"],
        "verification_limits": ["Common Crawl raw WARC payloads are referenced but not vendored; the harness recomputes normalized-text and partition hashes and checks the cataloged raw-source digest metadata. Exact source-byte verification needs the retained WARC payload."],
        "prospective_forecasting": {"decision": "no-go", "reason": "no append-only forecast registry or independent resolution process is in place"},
        "historical_portfolio_evaluation": {"decision": "no-go", "data_blockers": ["entry security and price", "allocation access", "dated contributions and distributions", "dilution and follow-on rules", "liquidation preferences", "realized liquidity", "fees and carry", "mature outcome/censoring rules"]},
        "controls": control_summaries,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "benchmark-scorecard.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output_dir / "benchmark-scorecard.md").write_text(render_markdown(report), encoding="utf-8")
    return report


def _git_commit(root: Path) -> str | None:
    import subprocess

    result = subprocess.run(
        ["git", "log", "-1", "--format=%H", "--", "experiments/ml/benchmark/runner.py", "experiments/ml/benchmark/run.py"],
        cwd=root, text=True, capture_output=True, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Benchmark scorecard",
        "",
        f"- Benchmark: `{report['benchmark_version']}`",
        f"- Case manifest SHA-256: `{report['case_manifest_sha256']}`",
        f"- Code commit: `{report['code_commit'] or 'unknown'}`",
        f"- Run: `{report['execution']}`; credentialed models executed: `{str(report['credentialed_models_executed']).lower()}`",
        f"- Cases: {report['counts']['cases']} across {report['counts']['companies']} companies; semantic labels provisional or blocked: {report['counts']['semantic_labels_provisional_or_blocked']}",
        "",
        "## Controls",
        "",
        "| Control | Answered | Abstained | Coverage | Temporal violations | Calls / tokens / ms | Semantic score |",
        "| --- | ---: | ---: | ---: | ---: | --- | --- |",
    ]
    for name, summary in report["controls"].items():
        cost = summary["cost"]
        latency = cost["latency_ms"] if cost["latency_ms"] is not None else "not measured"
        lines.append(f"| `{name}` | {summary['answered']} | {summary['abstained']} | {summary['coverage']:.3f} | {summary['temporal_violations']} | {cost['model_calls']} / {cost['tokens']} / {latency} | not scored |")
    for name, summary in report["controls"].items():
        lines.extend(["", f"## Case receipts: `{name}`", "", "| Case | Run status | Evidence | Temporal violations | Evaluator status | Semantic label |", "| --- | --- | --- | --- | --- | --- |"])
        for row in summary["cases"]:
            evidence = ", ".join(item["artifact_id"] for item in row["evidence"]) or "—"
            violations = ", ".join(row["temporal_violations"]) or "—"
            lines.append(f"| `{row['case_id']}` | {row['status']} | {evidence} | {violations} | {row['objective_status']} | {row['semantic_label_status']} |")
    lines.extend(["", "## Unmeasured", "", *[f"- {item}" for item in report["unmeasured"]], "", "## Blocked", "", *[f"- {item}" for item in report["blocked"]], "", "## Verification limits", "", *[f"- {item}" for item in report["verification_limits"]], "", "## Gates", "", f"- Prospective forecasting: **{report['prospective_forecasting']['decision']}** — {report['prospective_forecasting']['reason']}", f"- Historical portfolio evaluation: **{report['historical_portfolio_evaluation']['decision']}** — {', '.join(report['historical_portfolio_evaluation']['data_blockers'])}", ""])
    return "\n".join(lines)
