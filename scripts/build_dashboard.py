"""Export the verified pilot into a small, read-only dashboard dataset."""

import argparse
import json
import re
from datetime import timezone
from pathlib import Path

from log_pose.storage import connect


YEARS = (2021, 2022, 2023, 2024)


def reviewed_quotes(audit_text):
    quotes = []
    for line in audit_text.splitlines():
        fields = [field.strip() for field in line.split("|")]
        if len(fields) < 6 or not fields[2].isdigit() or not fields[3].isdigit():
            continue
        if "No usable claim" in line:
            continue
        match = re.search(r"“(.+?)”", line)
        if match:
            quotes.append({"snapshot_id": int(fields[3]), "quote": match.group(1)})
    return quotes


def build(cohort, ingestion, financials, audit_text, universe, connection):
    if len(cohort) != 20 or ingestion["planned_company_year_cells"] != 80:
        raise ValueError("dashboard expects the reviewed 20-company, 80-cell pilot")
    if financials["policy_version"] != "sec-annual-earliest-filed-v1":
        raise ValueError("SEC selection policy changed; review the dashboard first")
    if universe["verified_universe_count"] is not None:
        raise ValueError("a verified universe count needs a reviewed candidate build")
    if {count["year"] for source in universe["manifest_checks"] for count in source["counts"]} != {2021, 2024}:
        raise ValueError("the universe view expects the reviewed 2021 and 2024 manifest checks")

    cells = ingestion["cells"]
    selected_ids = [cell["snapshot_id"] for cell in cells if cell["snapshot_id"]]
    with connection.cursor() as cursor:
        cursor.execute("""SELECT id, normalized_text, archive_url, provider_record_id, raw_sha256,
                captured_at, text_status, provider
            FROM snapshots WHERE id = ANY(%s)""", (selected_ids,))
        snapshots = {row["id"]: row for row in cursor.fetchall()}
        cursor.execute("""SELECT file.id, file.study_year, file.source_url, file.raw_sha256,
                file.retrieved_at, count(daily.row_number) AS rows,
                count(DISTINCT daily.trade_date) AS trading_days,
                sum(daily.total_shares) AS shares,
                sum(daily.total_notional) AS notional,
                sum(daily.total_trade_count) AS trades,
                sum(daily.total_shares) FILTER (
                    WHERE daily.market_participant LIKE 'FINRA /%') AS trf_shares
            FROM market_files AS file
            JOIN market_daily AS daily ON daily.file_id=file.id
            WHERE file.provider='cboe'
            GROUP BY file.id ORDER BY file.study_year, file.retrieved_at""")
        market_rows = cursor.fetchall()
        cursor.execute("""SELECT artifact_version FROM sec_artifacts ORDER BY observed_at""")
        artifact_versions = [row["artifact_version"].strip() for row in cursor.fetchall()]
        cursor.execute("SELECT count(*) AS facts FROM sec_financial_facts")
        stored_fact_count = cursor.fetchone()["facts"]
        cursor.execute("""SELECT fact.id, fact.value, fact.unit, fact.start_date,
                fact.end_date, fact.filed_date, fact.tag, fact.accession_number,
                member.raw_sha256, member.artifact_version
            FROM sec_financial_facts AS fact
            JOIN sec_companyfacts AS member ON member.id=fact.companyfacts_id""")
        stored_facts = {row["id"]: row for row in cursor.fetchall()}

    if len(snapshots) != len(set(selected_ids)):
        raise ValueError("an ingestion-report snapshot is missing from Postgres")
    if len(market_rows) != 4 or {row["study_year"] for row in market_rows} != set(YEARS):
        raise ValueError("expected one stored Cboe file per study year")
    if (artifact_versions != [financials["source_artifact"]["version"]]
            or stored_fact_count != financials["candidate_fact_count"]):
        raise ValueError("SEC selection report differs from stored pilot facts")

    quotes = reviewed_quotes(audit_text)
    if len(quotes) != 19:
        raise ValueError(f"expected 19 reviewed source quotations, found {len(quotes)}")
    for quote in quotes:
        snapshot = snapshots.get(quote["snapshot_id"])
        if snapshot is None or quote["quote"] not in snapshot["normalized_text"]:
            raise ValueError(f"reviewed quote missing from snapshot {quote['snapshot_id']}")

    evidence = []
    for cell in cells:
        view = {key: cell[key] for key in (
            "slug", "category", "year", "status", "snapshot_id", "source_url",
            "captured_at", "capture_age_days", "text_characters", "warc_truncated")}
        if cell["snapshot_id"]:
            snapshot = snapshots[cell["snapshot_id"]]
            if (snapshot["raw_sha256"] != cell["raw_sha256"]
                    or snapshot["captured_at"].astimezone(timezone.utc).isoformat() != cell["captured_at"]
                    or snapshot["text_status"] != cell["text_status"]):
                raise ValueError(f"snapshot {cell['snapshot_id']} differs from saved report")
            view["provider"] = snapshot["provider"]
            view["archive_url"] = snapshot["archive_url"]
            view["provider_record_id"] = snapshot["provider_record_id"]
            view["raw_sha256"] = snapshot["raw_sha256"]
            view["excerpt"] = snapshot["normalized_text"][:500]
        evidence.append(view)

    sec_cells = []
    for cell in financials["cells"]:
        selected = cell["selected"]
        if selected:
            stored = stored_facts.get(selected["fact_id"])
            if stored is None or any(str(stored[key]).strip() != str(selected[key]) for key in (
                    "value", "unit", "start_date", "end_date", "filed_date",
                    "tag", "accession_number", "raw_sha256", "artifact_version")):
                raise ValueError(f"selected SEC fact {selected['fact_id']} differs from Postgres")
        sec_cells.append({
            "slug": cell["slug"], "year": cell["period_end_year"],
            "concept": cell["concept"], "status": cell["status"],
            "candidate_count": cell["candidate_count"],
            "selected": None if selected is None else {
                key: selected[key] for key in (
                    "value", "unit", "start_date", "end_date", "filed_date",
                    "tag", "accession_number", "raw_sha256", "artifact_version")
            },
        })

    market = []
    for row in market_rows:
        days = row["trading_days"]
        market.append({
            "year": row["study_year"], "rows": row["rows"], "trading_days": days,
            "mean_daily_shares": float(row["shares"] / days),
            "mean_daily_notional": float(row["notional"] / days),
            "mean_daily_trades": float(row["trades"] / days),
            "trf_share": float(row["trf_shares"] / row["shares"]),
            "source_url": row["source_url"], "raw_sha256": row["raw_sha256"],
            "retrieved_at": row["retrieved_at"].isoformat(),
        })
    expected_rows = sum(file["rows"] for file in ingestion["market_files"])
    if sum(row["rows"] for row in market) != expected_rows:
        raise ValueError("market rows differ from saved ingestion report")

    return {
        "years": YEARS,
        "companies": [{key: item.get(key) for key in ("slug", "name", "category", "cik")}
                      for item in cohort],
        "evidence": evidence,
        "reviewed_quotes": quotes,
        "financials": {
            "as_of": financials["as_of"],
            "policy_version": financials["policy_version"],
            "artifact_url": financials["source_artifact"]["url"],
            "artifact_version": financials["source_artifact"]["version"],
            "candidate_fact_count": financials["candidate_fact_count"],
            "cells": sec_cells,
        },
        "market": market,
        "universe": universe,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--ingestion", type=Path, default=Path("docs/research/ingestion-report.json"))
    parser.add_argument("--financials", type=Path, default=Path("docs/research/sec-analysis-build.json"))
    parser.add_argument("--audit", type=Path, default=Path("docs/research/evidence-audit.md"))
    parser.add_argument("--universe", type=Path, default=Path("docs/research/us-universe-dashboard.json"))
    parser.add_argument("--output", type=Path, default=Path("web/dashboard.json"))
    args = parser.parse_args()
    with connect() as connection:
        payload = build(
            json.loads(args.cohort.read_text()),
            json.loads(args.ingestion.read_text()),
            json.loads(args.financials.read_text()),
            args.audit.read_text(),
            json.loads(args.universe.read_text()),
            connection,
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"exported {len(payload['evidence'])} evidence cells, "
          f"{len(payload['financials']['cells'])} financial cells, "
          f"{len(payload['market'])} market years to {args.output}")


if __name__ == "__main__":
    main()
