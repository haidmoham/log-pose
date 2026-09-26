"""Stage only the reconstructed topology slice and its reviewed derivative."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from log_pose.atlas_reviewed_snapshot import build_atlas_reviewed, check_current
from log_pose.data_export import encode as catalog_encode
from log_pose.topology_export import export_topology
from log_pose.topology_reconstruction import validate_reconstruction_target


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def stage_slice(database_url: str, repository_root: Path, output_root: Path) -> dict:
    validate_reconstruction_target(database_url)
    if output_root.exists():
        raise ValueError("staging output already exists")
    (output_root / "api/data").mkdir(parents=True)
    shutil.copytree(repository_root / "web", output_root / "web")
    shutil.copytree(repository_root / "api/data/atlas-reviewed",
                    output_root / "api/data/atlas-reviewed")
    (output_root / "docs/research").mkdir(parents=True)
    shutil.copy2(repository_root / "docs/research/topology-source-manifest.json",
                 output_root / "docs/research/topology-source-manifest.json")
    shutil.copytree(repository_root / "docs/research/source-artifacts",
                    output_root / "docs/research/source-artifacts")
    cohort = json.loads((repository_root / "docs/research/pilot-cohort.json").read_text())
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        topology = export_topology(connection, cohort)
        provenance = connection.execute("""SELECT id,projection_sha256,reconstructed_at,
            input_manifest FROM raw.topology_reconstruction_batches ORDER BY id""").fetchone()
    dashboard_path = output_root / "web/dashboard.json"
    dashboard = json.loads(dashboard_path.read_text())
    original_dashboard = json.loads((repository_root / "web/dashboard.json").read_text())
    dashboard["market_topology"] = topology
    if ({key: value for key, value in dashboard.items() if key != "market_topology"}
            != {key: value for key, value in original_dashboard.items() if key != "market_topology"}):
        raise ValueError("non-topology dashboard members changed")
    dashboard_path.write_text(json.dumps(dashboard, indent=2) + "\n")
    index_path = output_root / "web/data/index.json"
    index = json.loads(index_path.read_text())
    original_index = json.loads((repository_root / "web/data/index.json").read_text())
    index["topology"] = topology
    index["counts"]["topology_claims"] = len(topology["claims"])
    index["counts"]["topology_reviews"] = len(topology["review_history"])
    next(row for row in index["datasets"] if row["id"] == "topology")["count"] = len(topology["claims"])
    index.setdefault("provenance", {})["topology_reconstruction"] = {
        "batch_id": provenance["id"], "projection_sha256": provenance["projection_sha256"],
        "reconstructed_at": provenance["reconstructed_at"].isoformat(),
        "input_manifest": provenance["input_manifest"],
        "scope": "reviewed topology only; other evidence families are unchanged"}
    def non_topology(value: dict) -> dict:
        copy = json.loads(json.dumps(value)); copy.pop("build_id", None); copy.pop("topology", None)
        copy["counts"].pop("topology_claims", None); copy["counts"].pop("topology_reviews", None)
        copy["datasets"] = [dict(row, count=None) if row["id"] == "topology" else row
                            for row in copy["datasets"]]
        copy.get("provenance", {}).pop("topology_reconstruction", None)
        return copy
    if non_topology(index) != non_topology(original_index):
        raise ValueError("non-topology catalog members changed")
    index.pop("build_id", None); index["build_id"] = hashlib.sha256(catalog_encode(index)).hexdigest()
    index_path.write_bytes(catalog_encode(index))
    allowed = {"dashboard.json", "data/index.json"}
    for source in (repository_root / "web").rglob("*"):
        if source.is_file() and source.relative_to(repository_root / "web").as_posix() not in allowed:
            staged = output_root / "web" / source.relative_to(repository_root / "web")
            if digest(source) != digest(staged):
                raise ValueError(f"unscoped web asset changed: {source.relative_to(repository_root)}")
    manifest = build_atlas_reviewed(output_root, output_root / "api/data/atlas-reviewed")
    check_current(output_root / "api/data/atlas-reviewed", output_root)
    return {"catalog_build_id": index["build_id"], "topology_counts": topology["counts"],
            "reviewed_build_id": manifest["build_id"],
            "changed_public_files": ["web/dashboard.json", "web/data/index.json",
                "api/data/atlas-reviewed/current.json",
                f"api/data/atlas-reviewed/{manifest['build_id']}.json",
                f"api/data/atlas-reviewed/{manifest['build_id']}.sqlite"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--repository-root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = stage_slice(args.database_url, args.repository_root.resolve(), args.output.resolve())
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
