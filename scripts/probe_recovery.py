"""Run a bounded second-pass Common Crawl probe on unresolved cohort cells."""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from log_pose.commoncrawl import fetch, search
from log_pose.core import normalize, sha256
from log_pose.storage import connect, ensure_source, finish_attempt, start_attempt, store


def validate_plan(plan: list[dict], cohort: dict[str, dict]) -> None:
    if len(plan) > 30:
        raise ValueError("recovery plan exceeds the 30-request limit")
    seen = set()
    for item in plan:
        slug = item["slug"]
        year = item["year"]
        crawl = item["crawl"]
        url = item["url"]
        key = (slug, year, url, crawl)
        if slug not in cohort or year not in (2021, 2022, 2023, 2024):
            raise ValueError(f"unknown cohort cell: {slug} {year}")
        if not crawl.startswith(f"CC-MAIN-{year}-"):
            raise ValueError(f"crawl is outside study year: {crawl}")
        if urlsplit(url).scheme != "https" or not urlsplit(url).netloc:
            raise ValueError(f"source must be an HTTPS URL: {url}")
        if key in seen:
            raise ValueError(f"duplicate recovery request: {key}")
        seen.add(key)


def run(plan: list[dict], cohort: dict[str, dict], connection, delay: float) -> list[dict]:
    results = []
    for item in plan:
        slug = item["slug"]
        year = item["year"]
        url = item["url"]
        crawl = item["crawl"]
        company = cohort[slug]
        purpose = company["purpose"] if url == company["url"] else item["purpose"]
        cutoff = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        source_id = ensure_source(connection, slug, company["name"], url, purpose)
        attempt_id = start_attempt(connection, source_id, cutoff, crawl)
        started = time.monotonic()
        result = {"slug": slug, "year": year, "url": url, "crawl": crawl,
                  "reason": item["reason"], "attempt_id": attempt_id}
        found = None
        try:
            found = search(url, crawl, cutoff)
            result["index_attempts"] = found.attempts
            result["index_rows"] = found.index_rows
            result["index_errors"] = list(found.errors)
            if found.row is None:
                outcome = "missing" if found.status == "missing" else "failed"
                detail = f"index_status={found.status}; index_errors={list(found.errors)}"
                finish_attempt(connection, attempt_id, outcome, detail,
                               index_attempts=found.attempts, index_rows=found.index_rows,
                               elapsed_ms=int((time.monotonic() - started) * 1000))
                result["outcome"] = outcome
            else:
                capture = fetch(url, crawl, found.row, cutoff)
                outcome, snapshot_id = store(connection, source_id, capture)
                finish_attempt(connection, attempt_id, outcome, f"snapshot_id={snapshot_id}",
                               capture.archive_url, index_attempts=found.attempts,
                               index_rows=found.index_rows,
                               compressed_bytes=int(found.row["length"]),
                               elapsed_ms=int((time.monotonic() - started) * 1000))
                result.update({"outcome": outcome, "snapshot_id": snapshot_id,
                               "captured_at": capture.captured_at.isoformat(),
                               "raw_sha256": sha256(capture.raw_html),
                               "text_characters": len(normalize(capture.raw_html)),
                               "warc_truncated": capture.provenance["warc_truncated"],
                               "compressed_bytes": int(found.row["length"])})
        except Exception as error:
            connection.rollback()
            detail = f"{type(error).__name__}: {error}"[:1000]
            finish_attempt(connection, attempt_id, "failed", detail,
                           index_attempts=found.attempts if found else None,
                           index_rows=found.index_rows if found else None,
                           elapsed_ms=int((time.monotonic() - started) * 1000))
            result.update({"outcome": "failed", "detail": detail})
        results.append(result)
        print(f"{slug} {year} {crawl}: {result['outcome']}", flush=True)
        if delay:
            time.sleep(delay)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--plan", type=Path, default=Path("docs/research/recovery-plan.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/research/recovery-report.json"))
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()
    if args.delay < 0:
        parser.error("delay must be nonnegative")
    cohort = {item["slug"]: item for item in json.loads(args.cohort.read_text())}
    plan = json.loads(args.plan.read_text())
    validate_plan(plan, cohort)
    with connect() as connection:
        results = run(plan, cohort, connection, args.delay)
    report = {"run_at": datetime.now(timezone.utc).isoformat(),
              "planned_requests": len(plan), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
