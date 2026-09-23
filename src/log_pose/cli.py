import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .acquire import fetch_capture
from .storage import connect, ensure_source, evidence, finish_attempt, migrate, start_attempt, store


def cutoff(year: int) -> datetime:
    return datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)


def main():
    parser = argparse.ArgumentParser(prog="log-pose")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    ingest = commands.add_parser("ingest")
    ingest.add_argument("--sources", type=Path, default=Path("sources.json"))
    ingest.add_argument("--delay", type=float, default=2.0)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("company")
    inspect.add_argument("--year", type=int, choices=[2021, 2024], required=True)
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8000)
    export = commands.add_parser("export")
    export.add_argument("--output", type=Path, default=Path("web/evidence.json"))
    args = parser.parse_args()
    if args.command == "serve":
        from .server import serve
        serve(args.port)
        return
    with connect() as conn:
        if args.command == "migrate":
            migrate(conn)
            print("schema ready")
        elif args.command == "ingest":
            failures = 0
            for item in json.loads(args.sources.read_text()):
                source_id = ensure_source(conn, item["slug"], item["name"], item["url"], item["purpose"])
                for year, stamp in item["captures"].items():
                    attempt_id = start_attempt(conn, source_id, cutoff(int(year)), stamp)
                    try:
                        capture = fetch_capture(item["url"], stamp, cutoff(int(year)))
                        outcome, snapshot_id = store(conn, source_id, capture)
                        finish_attempt(conn, attempt_id, outcome, f"snapshot_id={snapshot_id}", capture.archive_url)
                        print(f"{item['slug']} {year}: {outcome} #{snapshot_id} {capture.captured_at.isoformat()}", flush=True)
                    except Exception as exc:
                        failures += 1
                        conn.rollback()
                        finish_attempt(conn, attempt_id, "failed", f"{type(exc).__name__}: {exc}"[:1000])
                        print(f"{item['slug']} {year}: failed: {exc}", file=sys.stderr, flush=True)
                    time.sleep(max(0, args.delay))
            if failures:
                raise SystemExit(f"{failures} capture(s) failed; retry ingestion after checking the errors above")
        elif args.command == "inspect":
            print(json.dumps(evidence(conn, args.company, cutoff(args.year)), indent=2))
        elif args.command == "export":
            items = json.loads(Path("sources.json").read_text())
            results = [evidence(conn, item["slug"], cutoff(year)) for item in items for year in [2021, 2024]]
            # The public inspector contains a short preview; Postgres retains full source bytes/text.
            for view in results:
                for source in view["sources"]:
                    if source["snapshot"]:
                        source["snapshot"]["normalized_text"] = source["snapshot"]["normalized_text"][:320] + "…"
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(results, indent=2) + "\n")
            print(f"exported {len(results)} company/cutoff views to {args.output}")
