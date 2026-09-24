"""Download pinned historical landscapes and export searchable candidate records."""

import argparse
import json
from pathlib import Path

from log_pose.discovery import (attach_identity_reviews, build_index,
                                build_provider_candidates, link_pilot_candidates)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/discovery"))
    parser.add_argument("--output", type=Path, default=Path("web/discovery.json"))
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--identity-reviews", type=Path,
                        default=Path("docs/research/challenge-identity-reviews.json"))
    parser.add_argument("--location-reviews", type=Path,
                        default=Path("docs/research/us-location-reviews.json"))
    args = parser.parse_args()
    result = build_index(args.cache_dir, offline=args.offline)
    cohort = json.loads(args.cohort.read_text())
    match_count = link_pilot_candidates(result["candidates"], cohort)
    reviewed_key_count = attach_identity_reviews(
        result, json.loads(args.identity_reviews.read_text()), cohort)
    result["provider_candidates"] = build_provider_candidates(
        result, json.loads(args.location_reviews.read_text()))
    inventory_by_artifact = {}
    for row in result.pop("inventory_rows"):
        inventory_by_artifact.setdefault(row["artifact_sha256"], []).append(row)
    inventory_dir = args.output.parent / "discovery-inventory"
    for artifact in result["artifacts"]:
        artifact["inventory_export_path"] = (
            f"{inventory_dir.as_posix()}/{artifact['source']}-{artifact['year']}.json"
        )
        partition = {
            "source": artifact["source"], "year": artifact["year"],
            "source_commit": artifact["commit"], "source_committed_at": artifact["commit_at"],
            "source_url": artifact["url"], "raw_sha256": artifact["raw_sha256"],
            "observation_basis": artifact["observation_basis"],
            "coverage_status": artifact["coverage_status"],
            "row_grain": "one directory item at source_path",
            "rows": inventory_by_artifact[artifact["raw_sha256"]],
        }
        path = Path(artifact["inventory_export_path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(partition, ensure_ascii=False, indent=2) + "\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(result['artifacts'])} pinned inventories, "
          f"{len(result['occurrences'])} mapped occurrences, "
          f"{len(result['candidates'])} distinct candidate keys, "
          f"{match_count} possible pilot matches, "
          f"{reviewed_key_count} reviewed keys, "
          f"{len(result['provider_candidates'])} provider leads -> {args.output}")


if __name__ == "__main__":
    main()
