"""Refresh the versioned read graph after rebuilding web/data/topology-discovery.json."""

import argparse
import json
from pathlib import Path

from log_pose.market_field_graph import build_market_field_graph, encode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projection", type=Path, default=Path("web/data/topology-discovery.json"))
    parser.add_argument("--output", type=Path, default=Path("api/data/market-field-graph.json"))
    args = parser.parse_args()
    graph = build_market_field_graph(json.loads(args.projection.read_bytes()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encode(graph) + b"\n")
    print(json.dumps({"build_id": graph["build_id"], "counts": graph["counts"],
                      "output": str(args.output)}))


if __name__ == "__main__":
    main()
