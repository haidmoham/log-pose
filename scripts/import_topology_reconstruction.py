"""Import the approved scoped topology reconstruction into an explicit database."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from log_pose.storage import migrate
from log_pose.topology_reconstruction import reconstruct_topology, validate_reconstruction_target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--repository-root", type=Path, default=Path("."))
    parser.add_argument("--projection", type=Path,
                        default=Path("docs/research/issue11/topology-reconstruction-input.json"))
    parser.add_argument("--packet", type=Path,
                        default=Path("docs/research/issue11/integration-review-packet.json"))
    parser.add_argument("--reconstructed-at", help="fixed UTC time for replay; defaults to actual import time")
    args = parser.parse_args()
    validate_reconstruction_target(args.database_url)
    root = args.repository_root.resolve()
    projection = args.projection if args.projection.is_absolute() else root / args.projection
    reconstructed_at = datetime.fromisoformat(args.reconstructed_at) if args.reconstructed_at else datetime.now(timezone.utc)
    with psycopg.connect(args.database_url, row_factory=dict_row) as connection:
        migrate(connection)
        result = reconstruct_topology(connection, repository_root=root,
            projection_path=projection, packet_path=(args.packet if args.packet.is_absolute() else root / args.packet),
            reconstructed_at=reconstructed_at)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
