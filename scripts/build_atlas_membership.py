"""Build the artifact-qualified atlas membership index."""

import argparse
import json
from pathlib import Path

from log_pose.atlas_membership import build_atlas_membership, encode


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projection", type=Path, default=Path("web/data/topology-discovery.json"))
    parser.add_argument("--output", type=Path, default=Path("api/data/atlas-membership.json"))
    args = parser.parse_args()
    index = build_atlas_membership(json.loads(args.projection.read_bytes()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encode(index) + b"\n")
    print(json.dumps({"build_id": index["build_id"], "counts": index["counts"],
                      "output": str(args.output)}))


if __name__ == "__main__":
    main()
