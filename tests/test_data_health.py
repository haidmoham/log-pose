import json
import subprocess
from pathlib import Path

from scripts.check_data_health import (
    HealthReport,
    _check_catalog,
    _check_graph,
    _check_raw_discovery,
    run_data_health,
)


ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check_map(report: HealthReport) -> dict[str, dict[str, str]]:
    return {check["id"]: check for check in report.checks}


def test_committed_data_health_is_explicit_and_rebuilds_full_graph():
    result = run_data_health(ROOT)

    assert result["status"] == "healthy"
    assert result["summary"] == {"checked": 6, "failed": 0, "not_evaluated": 2}
    assert {check["status"] for check in result["checks"]} == {"checked", "not_evaluated"}
    assert "1240 candidates" in next(
        check["detail"] for check in result["checks"] if check["id"] == "topology_projection_and_full_graph"
    )
    assert "47288 pairs" in next(
        check["detail"] for check in result["checks"] if check["id"] == "topology_projection_and_full_graph"
    )
    assert next(check for check in result["checks"] if check["id"] == "claim_semantic_truth")["status"] == "not_evaluated"
    assert next(check for check in result["checks"] if check["id"] == "database_reconciliation")["status"] == "not_evaluated"


def test_catalog_partition_byte_corruption_fails_hash_check(tmp_path: Path):
    root = tmp_path
    catalog_source = ROOT / "web/data/index.json"
    catalog = json.loads(catalog_source.read_text())
    write_json(root / "web/data/index.json", catalog)
    first_partition = sorted(catalog["partitions"])[0]
    source = ROOT / "web" / first_partition
    destination = root / "web" / first_partition
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(source.read_bytes() + b" ")

    report = HealthReport()
    _check_catalog(root, report)

    assert check_map(report)["catalog_partitions"]["status"] == "failed"
    assert "byte length differs" in check_map(report)["catalog_partitions"]["detail"]


def test_raw_source_declared_count_corruption_fails_reconciliation(tmp_path: Path):
    root = tmp_path
    discovery = json.loads((ROOT / "web/discovery.json").read_text())
    artifact = next(item for item in discovery["artifacts"] if (item["source"], item["year"]) == ("cncf", 2020))
    artifact["raw_item_count"] += 1
    write_json(root / "web/discovery.json", discovery)
    raw_paths = []
    for pinned_artifact in discovery["artifacts"]:
        raw_relative = Path(pinned_artifact["artifact_path"])
        raw_target = root / raw_relative
        raw_target.parent.mkdir(parents=True, exist_ok=True)
        raw_target.write_bytes((ROOT / raw_relative).read_bytes())
        raw_paths.append(str(raw_relative))
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", *raw_paths], check=True)

    report = HealthReport()
    rebuilt, _ = _check_raw_discovery(root, report)

    assert rebuilt is None
    assert check_map(report)["pinned_discovery_inputs"]["status"] == "failed"
    assert "raw source item count differs" in check_map(report)["pinned_discovery_inputs"]["detail"]


def _graph_fixture(root: Path) -> dict:
    discovery = json.loads((ROOT / "web/discovery.json").read_text())
    write_json(root / "web/discovery.json", discovery)
    write_json(root / "docs/research/topology-review-queue.json",
               json.loads((ROOT / "docs/research/topology-review-queue.json").read_text()))
    write_json(root / "web/data/topology-discovery.json",
               json.loads((ROOT / "web/data/topology-discovery.json").read_text()))
    return discovery


def test_stale_queue_provenance_fails_projection_rebuild(tmp_path: Path):
    root = tmp_path
    discovery = _graph_fixture(root)
    queue_path = root / "docs/research/topology-review-queue.json"
    queue = json.loads(queue_path.read_text())
    queue["input_sha256"] = "0" * 64
    write_json(queue_path, queue)

    report = HealthReport()
    projection, _ = _check_graph(root, discovery, report)

    assert projection is None
    assert check_map(report)["topology_projection_and_full_graph"]["status"] == "failed"
    assert "stale discovery fingerprint" in check_map(report)["topology_projection_and_full_graph"]["detail"]


def test_promoted_exploratory_status_fails_projection_rebuild(tmp_path: Path):
    root = tmp_path
    discovery = _graph_fixture(root)
    projection_path = root / "web/data/topology-discovery.json"
    projection = json.loads(projection_path.read_text())
    projection["status"] = "reviewed_relationships"
    write_json(projection_path, projection)

    report = HealthReport()
    rebuilt, _ = _check_graph(root, discovery, report)

    assert rebuilt is None
    assert check_map(report)["topology_projection_and_full_graph"]["status"] == "failed"
    assert "differs from deterministic rebuild" in check_map(report)["topology_projection_and_full_graph"]["detail"]
