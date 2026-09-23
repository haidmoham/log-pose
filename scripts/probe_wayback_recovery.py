"""Check same-year Wayback availability for the original exact-homepage misses."""

import argparse
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from log_pose.acquire import USER_AGENT, fetch_capture
from log_pose.core import normalize, sha256
from log_pose.storage import connect, ensure_source, finish_attempt, start_attempt, store


def availability(url: str, year: int) -> dict | None:
    query = urllib.parse.urlencode({"url": url, "timestamp": f"{year}1231"})
    request = urllib.request.Request(
        "https://archive.org/wayback/available?" + query,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(20_001)
    if len(data) > 20_000:
        raise ValueError("Wayback availability response exceeds size limit")
    return json.loads(data).get("archived_snapshots", {}).get("closest")


def run(plan: list[dict], cohort: dict[str, dict], connection, delay: float) -> list[dict]:
    if len(plan) > 20:
        raise ValueError("Wayback plan exceeds the 20-request limit")
    results = []
    for item in plan:
        slug, year = item["slug"], item["year"]
        if slug not in cohort or year not in (2021, 2022, 2023, 2024):
            raise ValueError(f"unknown cohort cell: {slug} {year}")
        company = cohort[slug]
        url = company["url"]
        cutoff = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        source_id = ensure_source(connection, slug, company["name"], url, company["purpose"])
        known_timestamp = item.get("known_timestamp")
        if known_timestamp and (len(known_timestamp) != 14 or not known_timestamp.isdigit()
                                or not known_timestamp.startswith(str(year))):
            raise ValueError(f"known timestamp is outside study year: {known_timestamp}")
        requested = known_timestamp or f"WAYBACK-AVAILABILITY:{year}1231"
        attempt_id = start_attempt(connection, source_id, cutoff, requested)
        result = {"slug": slug, "year": year, "url": url, "attempt_id": attempt_id}
        started = time.monotonic()
        try:
            closest = availability(url, year) if not known_timestamp else None
            result["closest"] = closest
            result["method"] = "known_capture_replay" if known_timestamp else "availability_lookup"
            stamp = known_timestamp or (closest.get("timestamp") if closest else None)
            if not stamp or not stamp.startswith(str(year)):
                result["outcome"] = "missing"
                detail = f"no same-year capture; closest={stamp}"
                finish_attempt(connection, attempt_id, "missing", detail,
                               elapsed_ms=int((time.monotonic() - started) * 1000))
            else:
                capture = fetch_capture(url, stamp, cutoff)
                outcome, snapshot_id = store(connection, source_id, capture)
                result.update({"outcome": outcome, "snapshot_id": snapshot_id,
                               "captured_at": capture.captured_at.isoformat(),
                               "raw_sha256": sha256(capture.raw_html),
                               "text_characters": len(normalize(capture.raw_html))})
                finish_attempt(connection, attempt_id, outcome, f"snapshot_id={snapshot_id}",
                               capture.archive_url,
                               elapsed_ms=int((time.monotonic() - started) * 1000))
        except Exception as error:
            connection.rollback()
            detail = f"{type(error).__name__}: {error}"[:1000]
            result.update({"outcome": "failed", "detail": detail})
            finish_attempt(connection, attempt_id, "failed", detail,
                           elapsed_ms=int((time.monotonic() - started) * 1000))
        results.append(result)
        print(f"{slug} {year}: {result['outcome']}", flush=True)
        if delay:
            time.sleep(delay)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--plan", type=Path, default=Path("docs/research/wayback-recovery-plan.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/research/wayback-recovery-report.json"))
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()
    if args.delay < 0:
        parser.error("delay must be nonnegative")
    cohort = {item["slug"]: item for item in json.loads(args.cohort.read_text())}
    plan = json.loads(args.plan.read_text())
    with connect() as connection:
        results = run(plan, cohort, connection, args.delay)
    report = {"run_at": datetime.now(timezone.utc).isoformat(),
              "planned_requests": len(plan), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
