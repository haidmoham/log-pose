"""Export retained evidence into a static catalog and lazy typed partitions."""

import argparse
import json
from pathlib import Path

from log_pose.data_export import build_data_export, write_data_export
from log_pose.storage import connect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", type=Path, default=Path("."))
    parser.add_argument("--web-root", type=Path, default=Path("web"))
    parser.add_argument("--page-text-limit", type=int, default=6000,
                        help="plain-text characters per snapshot; 0 includes full text for a local export")
    args = parser.parse_args()
    with connect() as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        index, partitions = build_data_export(connection, repository_root=args.repository_root,
                                             page_text_limit=args.page_text_limit)
    write_data_export(args.web_root, index, partitions)
    print(json.dumps({"build_id": index["build_id"], "counts": index["counts"],
                      "catalog": str(args.web_root / "data/index.json")}))


if __name__ == "__main__":
    main()
