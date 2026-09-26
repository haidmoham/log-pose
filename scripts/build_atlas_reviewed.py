"""Build or validate the immutable reviewed relationship snapshot."""
import argparse
from pathlib import Path
from log_pose.atlas_reviewed_snapshot import build_atlas_reviewed, check_current

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository-root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("api/data/atlas-reviewed"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = check_current(args.output) if args.check else build_atlas_reviewed(args.repository_root, args.output)
    print(result["build_id"])


if __name__ == "__main__":
    main()
