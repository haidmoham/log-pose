"""Publish a validated atlas SQLite snapshot to the configured Postgres store."""

import argparse
import json
import os
from pathlib import Path

import psycopg

from log_pose.atlas_postgres import publish_atlas_snapshot
from log_pose.storage import migrate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-root", type=Path, default=Path("api/data/atlas"))
    parser.add_argument("--build-id", help="immutable build to publish; defaults to current.json")
    parser.add_argument("--batch-size", type=int, default=2_000)
    parser.add_argument("--no-current", action="store_true",
                        help="import and validate without moving the current pointer")
    args = parser.parse_args()
    database_url = os.getenv("ATLAS_PUBLISH_DATABASE_URL")
    if not database_url:
        parser.error("ATLAS_PUBLISH_DATABASE_URL is required")
    with psycopg.connect(database_url) as connection:
        migrate(connection)
        result = publish_atlas_snapshot(connection, args.snapshot_root,
                                        build_id=args.build_id,
                                        batch_size=args.batch_size,
                                        publish_current=not args.no_current)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
