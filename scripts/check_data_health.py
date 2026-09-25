#!/usr/bin/env python3
"""Check retained public data exports against their pinned local evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from log_pose.discovery import (
    EXPECTED_SHA256,
    PINS,
    attach_identity_reviews,
    build_candidates,
    build_provider_candidates,
    link_pilot_candidates,
    parse_inventory_rows,
    parse_occurrences,
    source_url,
)
from log_pose.market_field_graph import build_market_field_graph
from log_pose.topology_discovery import export_topology_discovery


REPORT_SCHEMA = "1.0"
EXPECTED_EXPLORATORY_STATUS = "unreviewed_inventory_overlap"
EXPECTED_QUEUE_STATUS = "discovery_leads_unreviewed_for_us_company_eligibility"
EXPECTED_EDGE_STATUS = "needs_company_identity_and_relation_evidence"


class HealthReport:
    def __init__(self) -> None:
        self.checks: list[dict[str, str]] = []

    def add(self, check_id: str, status: str, detail: str) -> None:
        self.checks.append({"id": check_id, "status": status, "detail": detail})

    def checked(self, check_id: str, detail: str) -> None:
        self.add(check_id, "checked", detail)

    def failed(self, check_id: str, detail: str) -> None:
        self.add(check_id, "failed", detail)

    def not_evaluated(self, check_id: str, detail: str) -> None:
        self.add(check_id, "not_evaluated", detail)

    def as_dict(self) -> dict[str, Any]:
        counts = {status: sum(check["status"] == status for check in self.checks)
                  for status in ("checked", "failed", "not_evaluated")}
        return {
            "schema_version": REPORT_SCHEMA,
            "status": "failed" if counts["failed"] else "healthy",
            "summary": counts,
            "checks": self.checks,
        }


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _safe_repo_path(root: Path, relative: str, *, web_only: bool = False) -> Path:
    """Resolve a retained path without allowing absolute paths or traversal."""
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError(f"unsafe retained path: {relative}")
    allowed = (root / "web").resolve() if web_only else root.resolve()
    target = (root / relative_path).resolve()
    if target != allowed and allowed not in target.parents:
        raise ValueError(f"retained path leaves its allowed root: {relative}")
    return target


def _json_payload_hash(payload: Any) -> str:
    encoded = (json.dumps(payload, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":")) + "\n").encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _check_catalog(root: Path, report: HealthReport) -> dict | None:
    check_id = "catalog_partitions"
    try:
        catalog_path = _safe_repo_path(root, "web/data/index.json", web_only=True)
        catalog = _read_json(catalog_path)
        declared_build_id = catalog.get("build_id")
        unsigned = {key: value for key, value in catalog.items() if key != "build_id"}
        actual_build_id = _json_payload_hash(unsigned)
        if declared_build_id != actual_build_id:
            raise ValueError("catalog build_id does not match its canonical contents")
        partitions = catalog.get("partitions")
        if not isinstance(partitions, dict) or not partitions:
            raise ValueError("catalog has no declared partitions")
        checked_files = 0
        for relative, declaration in sorted(partitions.items()):
            path = _safe_repo_path(root, f"web/{relative}", web_only=True)
            raw = path.read_bytes()
            if len(raw) != declaration.get("bytes"):
                raise ValueError(f"partition byte length differs: {relative}")
            if hashlib.sha256(raw).hexdigest() != declaration.get("sha256"):
                raise ValueError(f"partition hash differs: {relative}")
            json.loads(raw)
            checked_files += 1
        datasets = catalog.get("datasets", [])
        dataset_ids = [dataset.get("id") for dataset in datasets]
        if not datasets or len(dataset_ids) != len(set(dataset_ids)):
            raise ValueError("catalog datasets are missing or have duplicate IDs")
        for dataset in datasets:
            if not dataset.get("grain") or not dataset.get("partition_paths") and dataset["id"] != "topology":
                raise ValueError(f"dataset lacks grain or partitions: {dataset.get('id')}")
            if dataset["id"] != "topology":
                declared_paths = set(dataset["partition_paths"])
                if not declared_paths:
                    raise ValueError(f"dataset has no retained partitions: {dataset['id']}")
                if dataset["id"] != "inventory" and not declared_paths <= set(partitions):
                    raise ValueError(f"dataset {dataset['id']} references an undeclared catalog partition")
                actual_count = 0
                for relative in sorted(declared_paths):
                    path = _safe_repo_path(root, f"web/{relative}", web_only=True)
                    payload = _read_json(path)
                    actual_count += len(payload.get("rows", payload.get("records", payload.get("daily", []))))
                    if "participants" in payload:
                        actual_count += len(payload["participants"])
                if dataset["id"] == "inventory":
                    # Inventory's public search partition is the dataset row-count authority.
                    search = _read_json(_safe_repo_path(root, "web/data/inventory-search.json", web_only=True))
                    actual_count = len(search["records"])
                if dataset["id"] == "market":
                    # Market grain is participant rows; daily aggregate rows are a separate table.
                    actual_count = sum(len(_read_json(_safe_repo_path(root, f"web/{path}", web_only=True))["participants"])
                                       for path in declared_paths)
                if actual_count != dataset["count"]:
                    raise ValueError(f"dataset {dataset['id']} count differs: {actual_count} != {dataset['count']}")
        direct_counts = {
            "companies": len(catalog.get("companies", [])),
            "pages": len(catalog.get("pages", [])),
            "page_snapshots": len(catalog.get("pages", [])),
            "sec": len(catalog.get("sec", [])),
            "sec_candidates": len(catalog.get("sec", [])),
            "sec_selected": sum(bool(row.get("selected")) for row in catalog.get("sec", [])),
            "market_files": len(catalog.get("market", [])),
            "topology_claims": len(catalog.get("topology", {}).get("claims", [])),
            "topology_reviews": len(catalog.get("topology", {}).get("review_history", [])),
        }
        for count_name, actual_count in direct_counts.items():
            if catalog.get("counts", {}).get(count_name) != actual_count:
                raise ValueError(f"catalog count {count_name} differs: {actual_count}")
        market_dataset = next(dataset for dataset in datasets if dataset["id"] == "market")
        market_partition_paths = market_dataset["partition_paths"]
        market_daily_count = 0
        for relative in market_partition_paths:
            market_partition = _read_json(_safe_repo_path(root, f"web/{relative}", web_only=True))
            market_daily_count += len(market_partition["daily"])
        if catalog["counts"].get("market_daily_totals") != market_daily_count:
            raise ValueError(f"catalog market_daily_totals differs: {market_daily_count}")
        if catalog["counts"].get("market_participant_rows") != catalog["counts"].get("market_rows"):
            raise ValueError("catalog market participant row aliases differ")
        report.checked(check_id, f"catalog build {declared_build_id}; {checked_files} partition hashes and byte lengths match")
        return catalog
    except Exception as error:  # report a stable failure and continue independent checks
        report.failed(check_id, str(error))
        return None


def _check_raw_discovery(root: Path, report: HealthReport) -> tuple[dict | None, dict[str, list[dict]]]:
    check_id = "pinned_discovery_inputs"
    try:
        discovery_path = _safe_repo_path(root, "web/discovery.json", web_only=True)
        discovery = _read_json(discovery_path)
        expected_keys = {(source, year) for source, pin in PINS.items() for year in pin["commits"]}
        artifacts = {(item["source"], item["year"]): item for item in discovery["artifacts"]}
        if len(artifacts) != len(discovery["artifacts"]) or set(artifacts) != expected_keys:
            raise ValueError("discovery artifact set differs from pinned source/year set")
        expected_artifact_paths = {}
        for source, year in sorted(expected_keys):
            commit = PINS[source]["commits"][year][0]
            expected_artifact_paths[(source, year)] = (
                f"docs/research/source-artifacts/discovery/{source}-{year}-{commit[:12]}.yml")
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", *expected_artifact_paths.values()],
            cwd=root, capture_output=True, text=True, check=False,
        )
        if tracked.returncode:
            raise ValueError("one or more pinned raw source YAML artifacts are not tracked by Git")
        raw_rows_by_hash: dict[str, list[dict]] = {}
        observed_occurrences: list[dict] = []
        inventory_rows_total = 0
        for key in sorted(expected_keys):
            source, year = key
            artifact = artifacts[key]
            commit, commit_at = PINS[source]["commits"][year]
            expected_digest = EXPECTED_SHA256[key]
            expected_artifact_path = expected_artifact_paths[key]
            expected_inventory_path = f"web/discovery-inventory/{source}-{year}.json"
            expected_url = source_url(PINS[source]["repository"], commit, raw=False)
            expected_coverage = "partial_year_snapshot" if year == 2026 else "dated_inventory_snapshot"
            if (artifact["repository"] != PINS[source]["repository"]
                    or artifact["commit"] != commit or artifact["commit_at"] != commit_at
                    or artifact["raw_sha256"] != expected_digest
                    or artifact["artifact_path"] != expected_artifact_path
                    or artifact["inventory_export_path"] != expected_inventory_path
                    or artifact["url"] != expected_url
                    or artifact["observation_basis"] != "point_in_time_repository_state"
                    or artifact["coverage_status"] != expected_coverage):
                raise ValueError(f"pinned source metadata differs for {source} {year}")
            raw_path = _safe_repo_path(root, artifact["artifact_path"])
            raw = raw_path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != expected_digest or len(raw) != artifact["bytes"]:
                raise ValueError(f"retained raw source hash or byte length differs: {artifact['artifact_path']}")
            inventory_rows = parse_inventory_rows(raw, artifact)
            occurrences, raw_item_count = parse_occurrences(raw, artifact)
            if raw_item_count != artifact["raw_item_count"]:
                raise ValueError(f"raw source item count differs: {source} {year}")
            if len(inventory_rows) != artifact["inventory_row_count"]:
                raise ValueError(f"parsed inventory row count differs: {source} {year}")
            if len(occurrences) != artifact["mapped_occurrence_count"]:
                raise ValueError(f"parsed mapped occurrence count differs: {source} {year}")
            if sum(not row["candidate_tags"] for row in inventory_rows) != artifact["unmapped_row_count"]:
                raise ValueError(f"unmapped inventory row count differs: {source} {year}")
            partition_path = _safe_repo_path(root, artifact["inventory_export_path"], web_only=True)
            partition = _read_json(partition_path)
            expected_partition_rows = [row for row in inventory_rows]
            expected_partition_metadata = (source, year, commit, commit_at, artifact["url"], expected_digest,
                                           artifact["observation_basis"], artifact["coverage_status"])
            actual_partition_metadata = (partition.get("source"), partition.get("year"),
                                         partition.get("source_commit"), partition.get("source_committed_at"),
                                         partition.get("source_url"), partition.get("raw_sha256"),
                                         partition.get("observation_basis"), partition.get("coverage_status"))
            if (actual_partition_metadata != expected_partition_metadata
                    or partition.get("rows") != expected_partition_rows):
                raise ValueError(f"retained inventory partition differs from raw source: {source} {year}")
            raw_rows_by_hash[expected_digest] = inventory_rows
            observed_occurrences.extend(occurrences)
            inventory_rows_total += len(inventory_rows)
        if sorted(observed_occurrences, key=lambda row: row["id"]) != sorted(discovery["occurrences"], key=lambda row: row["id"]):
            raise ValueError("discovery occurrences differ from pinned source parse")
        if discovery.get("mapping_version") != "landscape-category-candidates-v1":
            raise ValueError("discovery mapping version differs from the pinned parser contract")
        expected_candidates = build_candidates(observed_occurrences)
        cohort = _read_json(_safe_repo_path(root, "docs/research/pilot-cohort.json"))
        link_pilot_candidates(expected_candidates, cohort)
        expected_review_index = {"candidates": expected_candidates}
        expected_reviews = _read_json(_safe_repo_path(root, "docs/research/challenge-identity-reviews.json"))
        attach_identity_reviews(expected_review_index, expected_reviews, cohort)
        if expected_review_index["identity_reviews"] != discovery["identity_reviews"]:
            raise ValueError("identity review projection differs from retained review inputs")
        candidate_fields = ("id", "name", "description", "homepage_url", "repo_url", "candidate_tags",
                            "observed_years", "sources", "occurrence_ids", "record_type", "pilot_match",
                            "identity_review_id", "company_status", "us_status")
        expected_by_id = {row["id"]: row for row in expected_candidates}
        actual_by_id = {row["id"]: row for row in discovery["candidates"]}
        if (len(expected_by_id) != len(expected_candidates) or len(actual_by_id) != len(discovery["candidates"])
                or expected_by_id.keys() != actual_by_id.keys() or any(
                any(expected_by_id[key].get(field) != actual_by_id[key].get(field) for field in candidate_fields)
                for key in expected_by_id)):
            raise ValueError("discovery candidate projection differs from pinned source parse and review inputs")
        if discovery.get("provider_candidates") != build_provider_candidates(
                {"candidates": expected_candidates, "identity_reviews": discovery["identity_reviews"]},
                _read_json(_safe_repo_path(root, "docs/research/us-location-reviews.json"))):
            raise ValueError("provider lead projection differs from retained identity/location reviews")
        report.checked(check_id,
                       f"{len(expected_keys)} pinned raw sources; {inventory_rows_total} source rows and "
                       f"{len(observed_occurrences)} tagged occurrences rebuilt exactly")
        return discovery, raw_rows_by_hash
    except Exception as error:
        report.failed(check_id, str(error))
        return None, {}


def _check_graph(root: Path, discovery: dict | None, report: HealthReport) -> tuple[dict | None, dict | None]:
    check_id = "topology_projection_and_full_graph"
    if discovery is None:
        report.not_evaluated(check_id, "pinned discovery inputs failed or were unavailable")
        return None, None
    try:
        discovery_path = _safe_repo_path(root, "web/discovery.json", web_only=True)
        queue_path = _safe_repo_path(root, "docs/research/topology-review-queue.json")
        queue = _read_json(queue_path)
        projection = export_topology_discovery(
            discovery, queue,
            discovery_sha256=hashlib.sha256(discovery_path.read_bytes()).hexdigest(),
            queue_sha256=hashlib.sha256(queue_path.read_bytes()).hexdigest(),
        )
        retained_projection = _read_json(_safe_repo_path(root, "web/data/topology-discovery.json", web_only=True))
        if projection != retained_projection:
            raise ValueError("retained topology projection differs from deterministic rebuild")
        if projection.get("status") != EXPECTED_EXPLORATORY_STATUS:
            raise ValueError("topology projection status is not the declared unreviewed inventory overlap")
        if projection["counts"]["reviewed_relationships"] != 0:
            raise ValueError("unreviewed overlap projection declares reviewed relationships")
        if queue.get("reviewed_relationship_count") != 0:
            raise ValueError("review queue declares reviewed relationships in its unreviewed inventory universe")
        if queue.get("universe_status") != EXPECTED_QUEUE_STATUS:
            raise ValueError("review queue universe status no longer declares unreviewed leads")
        if any(node.get("company_eligibility") != "unreviewed" or node.get("relationship_status") != "unreviewed"
               for node in projection["nodes"]):
            raise ValueError("candidate node was promoted beyond its unreviewed status")
        if any(edge.get("claim") is not None for edge in projection["edges"]):
            raise ValueError("review worklist edge contains a relationship claim")
        if any(edge.get("status") != EXPECTED_EDGE_STATUS for edge in projection["edges"]):
            raise ValueError("review worklist edge status no longer requires identity and relation evidence")
        graph = build_market_field_graph(projection)
        retained_graph = _read_json(_safe_repo_path(root, "api/data/market-field-graph.json"))
        if graph != retained_graph:
            raise ValueError("retained full market field graph differs from exact rebuild")
        if graph["input_hashes"]["projection_build_id"] != projection["build_id"]:
            raise ValueError("full graph references a different topology projection")
        report.checked(check_id,
                       f"projection {projection['build_id']}; exact graph {graph['counts']['nodes']} candidates, "
                       f"{graph['counts']['observations']} placements, {graph['counts']['possible_pairs']} pairs, "
                       f"{graph['counts']['edges']} separate queued pairs")
        return projection, graph
    except Exception as error:
        report.failed(check_id, str(error))
        return None, None


def run_data_health(repository_root: Path) -> dict[str, Any]:
    """Return a stable read-only report. No database, network, or cache is used."""
    root = repository_root.resolve()
    report = HealthReport()
    catalog = _check_catalog(root, report)
    if catalog is None:
        report.not_evaluated("catalog_counts", "catalog failed or could not be read")
    else:
        try:
            counts = catalog["counts"]
            if counts.get("topology_discovery_nodes") != catalog["exploratory_topology"]["node_count"]:
                raise ValueError("catalog topology node count differs from its summary")
            if counts.get("topology_discovery_edges") != catalog["exploratory_topology"]["edge_count"]:
                raise ValueError("catalog topology edge count differs from its summary")
            report.checked("catalog_counts", f"catalog declares {len(counts)} retained counts")
        except Exception as error:
            report.failed("catalog_counts", str(error))
    discovery, _ = _check_raw_discovery(root, report)
    projection, graph = _check_graph(root, discovery, report)
    if catalog is not None and discovery is not None:
        try:
            counts = catalog["counts"]
            actual = {
                "inventory_artifacts": len(discovery["artifacts"]),
                "inventory_rows": sum(artifact["inventory_row_count"] for artifact in discovery["artifacts"]),
                "tagged_occurrences": len(discovery["occurrences"]),
                "candidate_keys": len(discovery["candidates"]),
                "identity_reviews": len(discovery["identity_reviews"]),
                "provider_leads": len(discovery["provider_candidates"]),
            }
            for name, actual_count in actual.items():
                if counts.get(name) != actual_count:
                    raise ValueError(f"catalog count {name} differs: {actual_count}")
            report.checked("catalog_discovery_counts", "catalog counts match rebuilt pinned discovery inputs")
        except Exception as error:
            report.failed("catalog_discovery_counts", str(error))
    else:
        report.not_evaluated("catalog_discovery_counts", "required catalog or raw discovery rebuild failed")
    if projection is not None and graph is not None and catalog is not None:
        try:
            summary = catalog["exploratory_topology"]
            counts = projection["counts"]
            if (summary["partition_path"] != "data/topology-discovery.json"
                    or summary["status"] != projection["status"]
                    or summary["node_count"] != counts["nodes"]
                    or summary["edge_count"] != counts["edges"]
                    or summary["candidate_frame_count"] != counts["candidate_frame"]
                    or summary["possible_pair_count"] != counts["possible_pairs"]):
                raise ValueError("catalog topology summary differs from the rebuilt projection")
            report.checked("catalog_topology_linkage", "catalog summary references the verified projection counts and status")
        except Exception as error:
            report.failed("catalog_topology_linkage", str(error))
    else:
        report.not_evaluated("catalog_topology_linkage", "required catalog or topology rebuild failed")
    report.not_evaluated("database_reconciliation", "this check does not open PostgreSQL; compare a prepared clone separately")
    report.not_evaluated("claim_semantic_truth", "hashes and source projections do not replace human review of source meaning")
    report.checks.sort(key=lambda check: check["id"])
    return report.as_dict()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=REPOSITORY_ROOT,
                        help="repository root (default: this script's repository)")
    args = parser.parse_args(argv)
    try:
        result = run_data_health(args.root)
    except Exception as error:
        result = {
            "schema_version": REPORT_SCHEMA,
            "status": "failed",
            "summary": {"checked": 0, "failed": 1, "not_evaluated": 0},
            "checks": [{"id": "checker", "status": "failed", "detail": str(error)}],
        }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 1 if result["summary"]["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
