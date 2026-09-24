"""Append all pinned landscape artifacts and inventory rows to Postgres."""

import argparse
import json
from pathlib import Path

from log_pose.discovery_store import store_discovery_extension
from log_pose.storage import connect


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path("web/discovery.json"))
    args = parser.parse_args()
    index = json.loads(args.index.read_text())
    inventory_rows = []
    for artifact in index["artifacts"]:
        partition_path = Path(artifact["inventory_export_path"])
        partition = json.loads(partition_path.read_text())
        if partition["raw_sha256"] != artifact["raw_sha256"]:
            raise ValueError(f"inventory partition hash differs from main index: {partition_path}")
        inventory_rows.extend(partition["rows"])
    index["inventory_rows"] = inventory_rows
    with connect() as connection:
        result = store_discovery_extension(connection, index, repository_root=Path("."))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
