"""Build, check, or roll back an immutable atlas SQLite snapshot."""

import argparse
import json
from pathlib import Path

from log_pose.atlas_snapshot import build_atlas_snapshot, rollback_snapshot, validate_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projection", type=Path, default=Path("web/data/topology-discovery.json"))
    parser.add_argument("--output", type=Path, default=Path("api/data/atlas"))
    parser.add_argument("--check", action="store_true", help="validate the published current snapshot")
    parser.add_argument("--rollback", metavar="BUILD_ID", help="publish a prior immutable snapshot")
    parser.add_argument("--incremental-from", metavar="BUILD_ID",
                        help="copy a validated snapshot and update changed SQLite rows")
    parser.add_argument("--no-publish", action="store_true", help="build without updating current.json")
    args = parser.parse_args()
    if args.incremental_from and (args.check or args.rollback):
        parser.error("--incremental-from applies only to a snapshot build")
    if args.check and args.rollback:
        parser.error("--check and --rollback cannot be combined")
    if args.check:
        manifest = json.loads((args.output / "current.json").read_bytes())
        validate_snapshot(args.output, manifest)
        status = "valid"
    elif args.rollback:
        manifest = rollback_snapshot(args.output, args.rollback)
        status = "rolled_back"
    else:
        projection = json.loads(args.projection.read_bytes())
        manifest, status = build_atlas_snapshot(projection, args.output,
                                                publish=not args.no_publish,
                                                incremental_from=args.incremental_from)
    print(json.dumps({"status": status, "build_id": manifest["build_id"],
                      "database": manifest["database"], "counts": manifest["counts"]}))


if __name__ == "__main__":
    main()
