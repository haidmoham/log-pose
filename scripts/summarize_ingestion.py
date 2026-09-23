"""Summarize the fixed Common Crawl cohort and stored Cboe files."""

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from log_pose.storage import connect


YEARS = (2021, 2022, 2023, 2024)


def summarize(cohort: list[dict], connection) -> dict:
    attempts = defaultdict(list)
    captures = defaultdict(list)
    with connection.cursor() as cursor:
        cursor.execute("""SELECT company.slug, EXTRACT(YEAR FROM attempt.target_cutoff)::integer AS year,
            attempt.outcome, attempt.detail, attempt.index_attempts, attempt.index_rows,
            attempt.compressed_bytes, attempt.elapsed_ms, attempt.requested_at
            FROM ingestion_attempts AS attempt
            JOIN sources AS source ON source.id=attempt.source_id
            JOIN companies AS company ON company.id=source.company_id
            WHERE attempt.requested_capture LIKE 'CC-MAIN-%'
            ORDER BY attempt.id""")
        for row in cursor.fetchall():
            attempts[(row["slug"], row["year"])].append(row)
        cursor.execute("""SELECT company.slug, snapshot.id, snapshot.captured_at,
            snapshot.raw_sha256, snapshot.text_status,
            snapshot.provenance->>'warc_truncated' AS warc_truncated,
            length(snapshot.normalized_text) AS text_characters
            FROM snapshots AS snapshot
            JOIN sources AS source ON source.id=snapshot.source_id
            JOIN companies AS company ON company.id=source.company_id
            WHERE snapshot.provider='commoncrawl'""")
        for row in cursor.fetchall():
            captures[(row["slug"], row["captured_at"].year)].append(row)
        cursor.execute("""SELECT file.study_year, file.source_url, file.raw_sha256,
            file.retrieved_at, octet_length(file.raw_csv) AS file_bytes,
            count(daily.row_number) AS rows, count(DISTINCT daily.trade_date) AS trading_days
            FROM market_files AS file JOIN market_daily AS daily ON daily.file_id=file.id
            WHERE file.provider='cboe'
            GROUP BY file.id ORDER BY file.study_year,file.retrieved_at""")
        market_files = [dict(row) for row in cursor.fetchall()]

    cells = []
    for company in cohort:
        for year in YEARS:
            key = (company["slug"], year)
            histories = attempts[key]
            stored = captures[key]
            if stored:
                latest_capture = max(stored, key=lambda row: row["captured_at"])
                status = "retrieved" if latest_capture["text_status"] == "extractable" else "short"
            elif not histories:
                latest_capture = None
                status = "unattempted"
            elif any(row["outcome"] == "failed" for row in histories):
                latest_capture = None
                status = "failed"
            else:
                latest_capture = None
                status = "missing"
            cutoff = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
            cells.append({
                "slug": company["slug"],
                "category": company["category"],
                "year": year,
                "status": status,
                "attempt_count": len(histories),
                "last_outcome": histories[-1]["outcome"] if histories else None,
                "last_detail": histories[-1]["detail"] if histories else None,
                "index_requests": sum(row["index_attempts"] or 0 for row in histories),
                "compressed_bytes": sum(row["compressed_bytes"] or 0 for row in histories),
                "elapsed_ms": sum(row["elapsed_ms"] or 0 for row in histories),
                "snapshot_id": latest_capture["id"] if latest_capture else None,
                "captured_at": latest_capture["captured_at"].astimezone(timezone.utc).isoformat() if latest_capture else None,
                "capture_age_days": round((cutoff - latest_capture["captured_at"]).total_seconds() / 86400, 1) if latest_capture else None,
                "text_characters": latest_capture["text_characters"] if latest_capture else None,
                "text_status": latest_capture["text_status"] if latest_capture else None,
                "warc_truncated": latest_capture["warc_truncated"] if latest_capture else None,
                "raw_sha256": latest_capture["raw_sha256"] if latest_capture else None,
            })
    for file in market_files:
        file["retrieved_at"] = file["retrieved_at"].astimezone(timezone.utc).isoformat()
    return {
        "planned_company_year_cells": len(cells),
        "status_counts": dict(Counter(cell["status"] for cell in cells)),
        "warc_truncated_captures": sum(bool(cell["warc_truncated"]) for cell in cells),
        "by_year": {str(year): dict(Counter(cell["status"] for cell in cells if cell["year"] == year)) for year in YEARS},
        "by_category": {category: dict(Counter(cell["status"] for cell in cells if cell["category"] == category))
                        for category in sorted({company["category"] for company in cohort})},
        "market_files": market_files,
        "cells": cells,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--output", type=Path, help="write JSON report here; otherwise print it")
    args = parser.parse_args()
    cohort = json.loads(args.cohort.read_text())
    with connect() as connection:
        report = summarize(cohort, connection)
    output = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
