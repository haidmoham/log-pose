"""Probe one late-year Common Crawl collection per year for curated URLs.

This is a bounded access check. Missing rows do not establish that a company
was absent from Common Crawl or from the software market.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from log_pose.commoncrawl import CRAWLS, fetch, search
from log_pose.core import normalize, sha256


def probe(source: dict, year: int) -> dict:
    crawl = CRAWLS[year]
    cutoff = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    result = {"company": source["slug"], "year": year, "crawl": crawl, "source_url": source["url"]}
    try:
        found = search(source["url"], crawl, cutoff)
        result.update(index_attempts=found.attempts, index_rows=found.index_rows)
        if found.errors:
            result["index_failures"] = list(found.errors)
        if found.status != "found":
            result["status"] = "index_error" if found.status == "error" else "index_missing"
            return result
        row = found.row
        result.update(captured_at=row["timestamp"], warc_filename=row["filename"],
                      offset=int(row["offset"]), length=int(row["length"]))
        capture = fetch(source["url"], crawl, row, cutoff)
        result.update(status="usable", raw_sha256=sha256(capture.raw_html),
                      text_characters=len(normalize(capture.raw_html)))
    except (KeyError, OSError, ValueError) as error:
        result.update(status="retrieval_error", detail=f"{type(error).__name__}: {error}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=Path("sources.json"))
    parser.add_argument("--year", type=int, choices=CRAWLS, action="append", help="repeat for multiple years")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between index queries")
    parser.add_argument("--output", type=Path, help="write JSON results here; otherwise print JSON")
    args = parser.parse_args()
    sources = json.loads(args.sources.read_text())
    years = args.year or list(CRAWLS)
    results = []
    for source in sources:
        for year in years:
            result = probe(source, year)
            results.append(result)
            print(f"{source['slug']} {year}: {result['status']}", file=sys.stderr, flush=True)
            time.sleep(max(0, args.delay))
    output = json.dumps(results, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
