"""Rebuild the static research exports from retained local evidence, without network pulls."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict

from log_pose.discovery_store import store_discovery_extension
from log_pose.storage import connect, migrate
from scripts.import_topology_seed import import_seed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-local-database", action="store_true",
                        help="apply existing migrations and import pinned discovery into the chosen local database")
    parser.add_argument("--import-reviewed-seed", action="store_true",
                        help="restore the existing dated curated seed reviews; this performs no new source review")
    parser.add_argument("--page-text-limit", type=int, default=6000)
    parser.add_argument("--web-root", type=Path, default=Path("web"),
                        help="catalog output root; use a copy of web/ under site/ for full local text")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    if args.prepare_local_database or args.import_reviewed_seed:
        host = conninfo_to_dict(os.environ["DATABASE_URL"]).get("host", "")
        if host not in ("", "localhost", "127.0.0.1", "::1") and not host.startswith("/"):
            parser.error("preparation accepts a local database only; use a local clone of retained evidence")
    if args.prepare_local_database:
        with connect() as connection:
            migrate(connection)
            discovery = json.loads((root / "web/discovery.json").read_text())
            discovery["inventory_rows"] = [row for artifact in discovery["artifacts"]
                for row in json.loads((root / artifact["inventory_export_path"]).read_text())["rows"]]
            counts = store_discovery_extension(connection, discovery, repository_root=root)
            print(json.dumps({"discovery_import": counts}), flush=True)
    if args.import_reviewed_seed:
        counts = import_seed(json.loads((root / "docs/research/market-topology.json").read_text()),
            json.loads((root / "docs/research/topology-source-manifest.json").read_text()),
            json.loads((root / "docs/research/pilot-cohort.json").read_text()), repository_root=root,
            reviewer="imported prior Codex seed review")
        print(json.dumps({"prior_review_import": counts}), flush=True)
    environment = dict(os.environ, PYTHONPATH=str(root / "src") + os.pathsep + str(root))
    commands = [
        ["scripts/build_sec_analysis.py"],
        ["scripts/build_dashboard.py"],
        ["scripts/build_topology_review_queue.py"],
        ["scripts/build_data_catalog.py", "--web-root", str(args.web_root),
         "--page-text-limit", str(args.page_text_limit)],
    ]
    for command in commands:
        subprocess.run([sys.executable, *command], check=True, cwd=root, env=environment)


if __name__ == "__main__":
    main()
