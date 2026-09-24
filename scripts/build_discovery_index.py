"""Download pinned historical landscapes and export searchable candidate records."""

import argparse
import json
from pathlib import Path

from log_pose.discovery import attach_identity_reviews, build_index, link_pilot_candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/discovery"))
    parser.add_argument("--output", type=Path, default=Path("web/discovery.json"))
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--identity-reviews", type=Path,
                        default=Path("docs/research/challenge-identity-reviews.json"))
    args = parser.parse_args()
    result = build_index(args.cache_dir, offline=args.offline)
    cohort = json.loads(args.cohort.read_text())
    match_count = link_pilot_candidates(result["candidates"], cohort)
    reviewed_key_count = attach_identity_reviews(
        result, json.loads(args.identity_reviews.read_text()), cohort)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(result['artifacts'])} pinned inventories, "
          f"{len(result['occurrences'])} mapped occurrences, "
          f"{len(result['candidates'])} distinct candidate keys, "
          f"{match_count} possible pilot matches, "
          f"{reviewed_key_count} reviewed keys -> {args.output}")


if __name__ == "__main__":
    main()
