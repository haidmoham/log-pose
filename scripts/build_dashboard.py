"""Export the verified pilot into a small, read-only dashboard dataset."""

import argparse
import hashlib
import json
import re
from datetime import date, timezone
from pathlib import Path

from log_pose.storage import connect
from log_pose.topology import validate_topology
from log_pose.topology_store import reviewed_claims


YEARS = (2021, 2022, 2023, 2024)


def verify_topology_store(topology, connection):
    """The public seed must match accepted, retained database assertions."""
    accepted = {row["id"]: row for row in reviewed_claims(connection, limit=500)}
    basis_by_status = {
        "documented": "source_statement",
        "reviewed_inference": "reviewed_inference",
        "hypothesis": "hypothesis",
    }
    for claim in topology["claims"]:
        primary = claim["sources"][0]
        url_hash = hashlib.sha256(primary["source_url"].encode()).hexdigest()[:12]
        candidate_id = f"seed-claim:{claim['id']}:{url_hash}"
        stored = accepted.get(candidate_id)
        if stored is None:
            raise ValueError(f"topology claim lacks an accepted database review: {claim['id']}")
        expected = {
            "subject_entity_id": claim["subject_slug"],
            "object_entity_id": claim["object_slug"],
            "predicate": claim["predicate"],
            "direction": claim["direction"],
            "scope": claim["scope"],
            "interpretation": claim["interpretation"],
            "alternative_or_unknown": claim["alternative_or_unknown"],
            "temporal_form": claim["temporal_form"],
            "temporal_basis": claim["temporal_basis"],
            "proposed_basis": basis_by_status[claim["claim_status"]],
            "source_url": primary["source_url"],
            "raw_sha256": primary["artifact_sha256"],
            "evidence_locator": primary["evidence_locator"],
            "evidence_text": primary["evidence_text"],
            "exact_quote": primary.get("evidence_quote"),
        }
        for field, value in expected.items():
            if stored[field] != value:
                raise ValueError(f"topology claim differs from reviewed store: {claim['id']}.{field}")
        extra_sources = {item["source_url"]: item
                         for item in stored["additional_evidence"] if item["role"] == "support"}
        if set(extra_sources) != {item["source_url"] for item in claim["sources"][1:]}:
            raise ValueError(f"topology claim has different supporting sources: {claim['id']}")
        for source in claim["sources"][1:]:
            stored_source = extra_sources[source["source_url"]]
            if (stored_source["raw_sha256"] != source["artifact_sha256"]
                    or stored_source["locator"] != source["evidence_locator"]
                    or stored_source["summary"] != source["evidence_text"]
                    or stored_source["exact_quote"] != source.get("evidence_quote")):
                raise ValueError(f"topology supporting evidence differs from store: {claim['id']}")


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


def validate_announcements(announcements, cohort):
    slugs = {company["slug"] for company in cohort}
    seen = set()
    for event in announcements:
        key = (event["slug"], event["announced_on"])
        if key in seen or event["slug"] not in slugs:
            raise ValueError(f"duplicate or unknown financing announcement: {key}")
        seen.add(key)
        if date.fromisoformat(event["announced_on"]).year not in YEARS:
            raise ValueError(f"financing announcement outside study period: {key}")
        if event["source_type"] != "company announcement" or not event["source_url"].startswith("https://"):
            raise ValueError(f"financing announcement lacks a secure company source: {key}")
        if event["amount_usd"] <= 0 or (event["valuation_usd"] is not None and event["valuation_usd"] <= 0):
            raise ValueError(f"financing announcement has an invalid amount: {key}")


def validate_location_reviews(reviews, cohort):
    categories = {company["slug"]: company["category"] for company in cohort}
    if len(reviews) != 12 or len({item["slug"] for item in reviews}) != 12:
        raise ValueError("expected 12 distinct reviewed pilot companies")
    category_counts = {category: 0 for category in set(categories.values())}
    for item in reviews:
        slug = item["slug"]
        if slug not in categories:
            raise ValueError(f"location review has unknown pilot slug: {slug}")
        category_counts[categories[slug]] += 1
        if item["source_year"] not in YEARS or not item["source_url"].startswith("https://"):
            raise ValueError(f"location review lacks a dated first-party source: {slug}")
        if item["decision"] not in {"documented_us_base", "unresolved"}:
            raise ValueError(f"invalid location decision: {slug}")
        if item["location_kind"] not in {"headquarters", "principal_executive_office", "none_declared"}:
            raise ValueError(f"invalid location kind: {slug}")
        if (item["decision"] == "documented_us_base") != (item["location_kind"] != "none_declared"):
            raise ValueError(f"location decision and source fact disagree: {slug}")
    if set(category_counts.values()) != {3}:
        raise ValueError(f"expected three location reviews per category: {category_counts}")


def build(cohort, ingestion, financials, announcements, location_reviews, market_topology,
          audit_text, connection):
    if len(cohort) != 20 or ingestion["planned_company_year_cells"] != 80:
        raise ValueError("dashboard expects the reviewed 20-company, 80-cell pilot")
    if financials["policy_version"] != "sec-annual-earliest-filed-v1":
        raise ValueError("SEC selection policy changed; review the dashboard first")
    validate_announcements(announcements, cohort)
    validate_location_reviews(location_reviews, cohort)
    validate_topology(market_topology, cohort)
    verify_topology_store(market_topology, connection)

    cells = ingestion["cells"]
    selected_ids = [cell["snapshot_id"] for cell in cells if cell["snapshot_id"]]
    with connection.cursor() as cursor:
        cursor.execute("""SELECT observation_id AS id, normalized_text, archive_url,
                provider_record_id, raw_sha256, captured_at, text_status, provider
            FROM warehouse.page_observations WHERE observation_id = ANY(%s)""", (selected_ids,))
        snapshots = {row["id"]: row for row in cursor.fetchall()}
        cursor.execute("""SELECT file.id, file.study_year, file.source_url, file.raw_sha256,
                file.retrieved_at,
                sum(daily.participant_rows)::bigint AS rows,
                count(*) AS trading_days,
                sum(daily.total_shares) AS shares,
                sum(daily.total_notional) AS notional,
                sum(daily.total_trade_count) AS trades,
                sum(daily.trf_shares) AS trf_shares
            FROM market_files AS file
            JOIN warehouse.market_daily_totals AS daily ON daily.file_id=file.id
            WHERE file.provider='cboe'
            GROUP BY file.id ORDER BY file.study_year, file.retrieved_at""")
        market_rows = cursor.fetchall()
        cursor.execute("""SELECT artifact_version FROM sec_artifacts ORDER BY observed_at""")
        artifact_versions = [row["artifact_version"].strip() for row in cursor.fetchall()]
        cursor.execute("SELECT count(*) AS facts FROM sec_financial_facts")
        stored_fact_count = cursor.fetchone()["facts"]
        cursor.execute("""SELECT fact_id AS id, value, unit, start_date,
                end_date, filed_date, tag, accession_number,
                raw_sha256, artifact_version
            FROM warehouse.sec_fact_observations""")
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
        "companies": [{key: item.get(key) for key in ("slug", "name", "category", "cik", "url", "purpose")}
                      for item in cohort],
        "evidence": evidence,
        "reviewed_quotes": quotes,
        "financing_announcements": announcements,
        "us_location_reviews": location_reviews,
        "market_topology": market_topology,
        "financials": {
            "as_of": financials["as_of"],
            "policy_version": financials["policy_version"],
            "artifact_url": financials["source_artifact"]["url"],
            "artifact_version": financials["source_artifact"]["version"],
            "candidate_fact_count": financials["candidate_fact_count"],
            "cells": sec_cells,
        },
        "market": market,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--ingestion", type=Path, default=Path("docs/research/ingestion-report.json"))
    parser.add_argument("--financials", type=Path, default=Path("docs/research/sec-analysis-build.json"))
    parser.add_argument("--announcements", type=Path, default=Path("docs/research/financing-announcements.json"))
    parser.add_argument("--location-reviews", type=Path, default=Path("docs/research/us-location-reviews.json"))
    parser.add_argument("--topology", type=Path, default=Path("docs/research/market-topology.json"))
    parser.add_argument("--audit", type=Path, default=Path("docs/research/evidence-audit.md"))
    parser.add_argument("--output", type=Path, default=Path("web/dashboard.json"))
    args = parser.parse_args()
    with connect() as connection:
        payload = build(
            json.loads(args.cohort.read_text()),
            json.loads(args.ingestion.read_text()),
            json.loads(args.financials.read_text()),
            json.loads(args.announcements.read_text()),
            json.loads(args.location_reviews.read_text()),
            json.loads(args.topology.read_text()),
            args.audit.read_text(),
            connection,
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"exported {len(payload['evidence'])} evidence cells, "
          f"{len(payload['financials']['cells'])} financial cells, "
          f"{len(payload['financing_announcements'])} financing announcements, "
          f"{len(payload['us_location_reviews'])} U.S. location reviews, "
          f"{len(payload['market'])} market years to {args.output}")


if __name__ == "__main__":
    main()
