"""Build a bounded relation-research queue from the pinned discovery frame."""

import argparse
import json
from pathlib import Path

from log_pose.topology import build_market_neighbor_queue


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discovery", type=Path, default=Path("web/discovery.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/research/topology-review-queue.json"))
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260924)
    args = parser.parse_args()
    discovery = json.loads(args.discovery.read_text())
    queue = build_market_neighbor_queue(discovery, limit=args.limit, random_seed=args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(queue, indent=2) + "\n")
    print(f"queued {len(queue['pairs'])} of {queue['possible_pair_count']} category-overlap pairs "
          f"from {queue['candidate_entity_count']} product/project leads to {args.output}")


if __name__ == "__main__":
    main()
