import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

from .acquire import fetch_capture
from .commoncrawl import CRAWLS, fetch as fetch_commoncrawl, search as search_commoncrawl
from .market import fetch_cboe, parse_cboe
from .sec_bulk import (
    DEFAULT_MAX_MEMBER_BYTES,
    COMPANYFACTS_URL,
    RangeZipReader,
    read_companyfacts_member,
)
from .storage import (
    connect, ensure_source, evidence, finish_attempt, migrate, start_attempt,
    store, store_market_file, store_sec_companyfacts,
)


def cutoff(year: int) -> datetime:
    return datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)


def main():
    parser = argparse.ArgumentParser(prog="log-pose")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    ingest = commands.add_parser("ingest")
    ingest.add_argument("--sources", type=Path, default=Path("sources.json"))
    ingest.add_argument("--delay", type=float, default=2.0)
    commoncrawl = commands.add_parser("ingest-commoncrawl")
    commoncrawl.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    commoncrawl.add_argument("--year", type=int, choices=CRAWLS, action="append")
    commoncrawl.add_argument("--slug", action="append", help="limit to one or more cohort slugs")
    commoncrawl.add_argument("--delay", type=float, default=1.0)
    cboe = commands.add_parser("ingest-cboe")
    cboe.add_argument("--year", type=int, choices=CRAWLS, action="append")
    sec_bulk = commands.add_parser("sec-bulk")
    sec_bulk.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    sec_bulk.add_argument("--slug", action="append", help="limit to one or more cohort slugs")
    sec_bulk.add_argument("--year-from", type=int, default=2021)
    sec_bulk.add_argument("--year-to", type=int, default=2024)
    sec_bulk.add_argument("--max-companies", type=int, default=20)
    sec_bulk.add_argument("--max-member-bytes", type=int, default=DEFAULT_MAX_MEMBER_BYTES)
    sec_bulk.add_argument("--delay", type=float, default=0.11,
                          help="minimum seconds between SEC HTTP requests")
    sec_bulk.add_argument("--user-agent", default=os.environ.get("SEC_USER_AGENT"),
                          help="declared SEC User-Agent; defaults to SEC_USER_AGENT")
    inspect = commands.add_parser("inspect")
    inspect.add_argument("company")
    inspect.add_argument("--year", type=int, choices=CRAWLS, required=True)
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
        elif args.command == "ingest-commoncrawl":
            migrate(conn)
            cohort = json.loads(args.cohort.read_text())
            years = args.year or list(CRAWLS)
            failures = 0
            for item in cohort:
                if args.slug and item["slug"] not in args.slug:
                    continue
                source_id = ensure_source(conn, item["slug"], item["name"], item["url"], item["purpose"])
                for year in years:
                    crawl = CRAWLS[year]
                    target_cutoff = cutoff(year)
                    attempt_id = start_attempt(conn, source_id, target_cutoff, crawl)
                    started_at = time.monotonic()
                    found = None
                    try:
                        found = search_commoncrawl(item["url"], crawl, target_cutoff)
                        if found.status == "error":
                            raise ValueError("index request failed: " + ", ".join(found.errors))
                        if found.status == "missing":
                            finish_attempt(conn, attempt_id, "missing", f"crawl={crawl}; index_errors={list(found.errors)}",
                                           index_attempts=found.attempts, index_rows=found.index_rows,
                                           elapsed_ms=int((time.monotonic() - started_at) * 1000))
                            print(f"{item['slug']} {year}: missing", flush=True)
                            continue
                        capture = fetch_commoncrawl(item["url"], crawl, found.row, target_cutoff)
                        outcome, snapshot_id = store(conn, source_id, capture)
                        detail = f"snapshot_id={snapshot_id}; index_attempts={found.attempts}; index_errors={list(found.errors)}"
                        finish_attempt(conn, attempt_id, outcome, detail, capture.archive_url,
                                       index_attempts=found.attempts, index_rows=found.index_rows,
                                       compressed_bytes=int(found.row["length"]),
                                       elapsed_ms=int((time.monotonic() - started_at) * 1000))
                        print(f"{item['slug']} {year}: {outcome} #{snapshot_id} {capture.captured_at.isoformat()}", flush=True)
                    except Exception as error:
                        failures += 1
                        conn.rollback()
                        finish_attempt(conn, attempt_id, "failed", f"{type(error).__name__}: {error}"[:1000],
                                       index_attempts=found.attempts if found else None,
                                       index_rows=found.index_rows if found else None,
                                       elapsed_ms=int((time.monotonic() - started_at) * 1000))
                        print(f"{item['slug']} {year}: failed: {error}", file=sys.stderr, flush=True)
                    finally:
                        time.sleep(max(0, args.delay))
            if failures:
                raise SystemExit(f"{failures} Common Crawl request(s) failed; stored evidence is preserved")
        elif args.command == "ingest-cboe":
            migrate(conn)
            for year in args.year or list(CRAWLS):
                try:
                    url, raw = fetch_cboe(year)
                    rows = parse_cboe(raw, year)
                    outcome, file_id = store_market_file(conn, year, url, raw, rows)
                    print(f"Cboe {year}: {outcome} file #{file_id}, {len(rows)} rows", flush=True)
                except Exception:
                    conn.rollback()
                    raise
        elif args.command == "sec-bulk":
            if not args.user_agent or not args.user_agent.strip():
                raise SystemExit("set SEC_USER_AGENT or pass --user-agent with a declared contact")
            if args.year_from > args.year_to:
                raise SystemExit("--year-from must not exceed --year-to")
            if args.max_companies < 1 or args.max_member_bytes < 1 or args.delay < 0:
                raise SystemExit("SEC limits must be positive and --delay cannot be negative")
            cohort = json.loads(args.cohort.read_text())
            selected = [item for item in cohort if item.get("cik")
                        and (not args.slug or item["slug"] in args.slug)]
            if not selected:
                raise SystemExit("no cohort companies with verified CIKs matched the selection")
            if len(selected) > args.max_companies:
                raise SystemExit(f"selection has {len(selected)} companies; limit is {args.max_companies}")
            ciks = [str(item["cik"]).zfill(10) for item in selected]
            if len(ciks) != len(set(ciks)):
                raise SystemExit("cohort contains duplicate CIK values")

            migrate(conn)
            failures = 0
            with RangeZipReader(
                COMPANYFACTS_URL,
                user_agent=args.user_agent,
                minimum_request_interval=args.delay,
            ) as ranged_zip:
                with ZipFile(ranged_zip, "r") as archive:
                    for item in selected:
                        try:
                            member = read_companyfacts_member(
                                archive, item["cik"],
                                max_member_bytes=args.max_member_bytes,
                                years=(args.year_from, args.year_to),
                            )
                            outcome, companyfacts_id = store_sec_companyfacts(
                                conn, ranged_zip.metadata, member
                            )
                            print(f"{item['slug']}: {outcome} SEC member #{companyfacts_id}; "
                                  f"{len(member.facts)} annual facts", flush=True)
                        except Exception as error:
                            conn.rollback()
                            failures += 1
                            print(f"{item['slug']}: failed: {type(error).__name__}: {error}",
                                  file=sys.stderr, flush=True)
                print(f"SEC companyfacts artifact {ranged_zip.metadata.artifact_version}; "
                      f"{ranged_zip.bytes_transferred} bytes in {ranged_zip.request_count} requests "
                      f"from {ranged_zip.metadata.content_length} byte ZIP", flush=True)
            if failures:
                raise SystemExit(f"{failures} SEC companyfacts member(s) failed; stored evidence is preserved")
        elif args.command == "ingest":
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
                        conn.rollback()
                        finish_attempt(conn, attempt_id, "failed", f"{type(exc).__name__}: {exc}"[:1000])
                        print(f"{item['slug']} {year}: failed: {exc}", file=sys.stderr, flush=True)
                    time.sleep(max(0, args.delay))
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
