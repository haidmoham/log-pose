"""Build a small static catalog with typed, lazily loaded evidence partitions."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from .topology_export import export_topology


def json_default(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        # Decimal source values stay exact; the browser explicitly converts for charts.
        return str(value)
    raise TypeError(f"unsupported export value: {type(value).__name__}")


def encode(payload):
    return (json.dumps(payload, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), default=json_default) + "\n").encode()


def build_data_export(connection, *, repository_root: Path, page_text_limit: int = 6000):
    """Read within the caller's repeatable-read transaction; do not mutate evidence."""
    if page_text_limit < 0:
        raise ValueError("page text limit must be zero (full local text) or positive")
    root = repository_root
    dashboard = json.loads((root / "web/dashboard.json").read_text())
    discovery = json.loads((root / "web/discovery.json").read_text())
    cohort = json.loads((root / "docs/research/pilot-cohort.json").read_text())
    analysis = json.loads((root / "docs/research/sec-analysis-build.json").read_text())
    companies = {item["slug"]: item for item in dashboard["companies"]}
    cik_company = {str(item["cik"]).zfill(10): item for item in cohort if item.get("cik")}
    selected = {cell["selected"]["fact_id"]: cell for cell in analysis["cells"] if cell["selected"]}
    with connection.cursor() as cursor:
        cursor.execute("SELECT version FROM schema_migrations ORDER BY version")
        migrations = [row["version"] for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM warehouse.page_observations ORDER BY company_slug,captured_at,observation_id")
        page_rows = cursor.fetchall()
        cursor.execute("SELECT * FROM warehouse.sec_fact_observations ORDER BY cik,end_date,concept_group,fact_id")
        sec_rows = cursor.fetchall()
        cursor.execute("SELECT id,provider,source_url,study_year,raw_sha256,parser_version,retrieved_at FROM market_files ORDER BY study_year,id")
        market_sources = cursor.fetchall()
        cursor.execute("SELECT * FROM warehouse.market_daily_totals ORDER BY file_id,trade_date")
        daily_rows = cursor.fetchall()
        cursor.execute("SELECT * FROM market_daily ORDER BY file_id,trade_date,row_number")
        participant_rows = cursor.fetchall()
        cursor.execute("SELECT raw_sha256 FROM discovery_artifacts ORDER BY raw_sha256")
        stored_artifact_hashes = {row["raw_sha256"] for row in cursor.fetchall()}
        cursor.execute("SELECT * FROM discovery_inventory_rows ORDER BY id")
        stored_inventory = {row["id"]: row for row in cursor.fetchall()}
        cursor.execute("SELECT count(*) AS count FROM discovery_occurrences")
        stored_occurrence_count = cursor.fetchone()["count"]
    if stored_artifact_hashes != {item["raw_sha256"] for item in discovery["artifacts"]}:
        raise ValueError("discovery database artifacts differ from the pinned index")
    if stored_occurrence_count != len(discovery["occurrences"]):
        raise ValueError("discovery occurrence count differs from the pinned index")
    if len(sec_rows) != analysis["candidate_fact_count"]:
        raise ValueError("SEC analysis must be rebuilt from the retained facts before export")
    selected_ids = set(selected)
    if not selected_ids <= {row["fact_id"] for row in sec_rows}:
        raise ValueError("SEC selected fact is missing from retained observations")

    partitions = {}
    pages = []
    pages_by_company = defaultdict(list)
    pilot_snapshot_ids = {item["snapshot_id"] for item in dashboard["evidence"] if item["snapshot_id"]}
    quotes = {item["snapshot_id"]: item["quote"] for item in dashboard["reviewed_quotes"]}
    for source_row in page_rows:
        row = dict(source_row)
        slug = row["company_slug"]
        text = row["normalized_text"]
        visible_text = text[:page_text_limit] if page_text_limit else text
        row.update({"id": f"page:{row['observation_id']}", "snapshot_id": row["observation_id"],
                    "year": row["captured_at"].year, "source_url": row["original_url"],
                    "text_characters": len(text), "displayed_characters": len(visible_text),
                    "text_truncated": len(visible_text) < len(text),
                    "full_text_available_locally": True, "normalized_text": visible_text,
                    "text_kind": "normalized_plain_text", "selected_for_pilot": row["observation_id"] in pilot_snapshot_ids,
                    "reviewed_quote": quotes.get(row["observation_id"]),
                    "partition_path": f"data/pages/{slug}.json"})
        pages_by_company[slug].append(row)
        pages.append({key: row[key] for key in (
            "id", "snapshot_id", "company_slug", "company_name", "source_url", "captured_at",
            "year", "provider", "text_status", "text_characters", "displayed_characters",
            "text_truncated", "selected_for_pilot", "partition_path")}
            | {"excerpt": text[:280]})
    for slug, rows in pages_by_company.items():
        partitions[f"data/pages/{slug}.json"] = {"schema_version": "1.0", "family": "pages",
            "company_slug": slug, "grain": "one immutable provider snapshot", "records": rows}

    sec = []
    sec_by_company = defaultdict(list)
    for source_row in sec_rows:
        row = dict(source_row)
        company = cik_company.get(row["cik"].strip())
        if company is None:
            raise ValueError(f"retained SEC CIK needs an explicit company link: {row['cik']}")
        slug = company["slug"]
        selected_cell = selected.get(row["fact_id"])
        if selected_cell is not None:
            for key, value in selected_cell["selected"].items():
                if key in row and str(row[key]).strip() != str(value):
                    raise ValueError(f"selected SEC fact differs from its retained observation: {row['fact_id']}.{key}")
        row.update({"id": f"sec:{row['fact_id']}", "company_slug": slug, "company_name": company["name"],
                    "year": row["end_date"].year, "selected": selected_cell is not None,
                    "selection_status": "selected" if selected_cell else "retained_alternative",
                    "selection_policy": analysis["policy_version"], "selection_as_of": analysis["as_of"],
                    "partition_path": f"data/sec/{slug}.json"})
        sec_by_company[slug].append(row)
        sec.append({key: row[key] for key in (
            "id", "fact_id", "company_slug", "company_name", "concept_group", "value", "unit", "year",
            "tag", "start_date", "end_date", "filed_date", "selected", "selection_status", "partition_path")})
    for slug, rows in sec_by_company.items():
        partitions[f"data/sec/{slug}.json"] = {"schema_version": "1.0", "family": "sec",
            "company_slug": slug, "grain": "one retained SEC fact candidate", "records": rows,
            "policy": analysis["policy"], "policy_version": analysis["policy_version"], "as_of": analysis["as_of"]}

    daily_by_file = defaultdict(list)
    participants_by_file = defaultdict(list)
    for row in daily_rows:
        daily_by_file[row["file_id"]].append(dict(row) | {"id": f"market-day:{row['file_id']}:{row['trade_date']}"})
    for row in participant_rows:
        participants_by_file[row["file_id"]].append(dict(row) | {"id": f"market-row:{row['file_id']}:{row['row_number']}"})
    market = []
    for source in market_sources:
        file_id, year = source["id"], source["study_year"]
        rows, days = participants_by_file[file_id], daily_by_file[file_id]
        reconcile_market(rows, days)
        path = f"data/market/{year}-{file_id}.json"
        metadata = {"id": f"market-file:{file_id}", "file_id": file_id, "year": year,
                    "rows": len(rows), "trading_days": len(days),
                    "participants": sorted({row["market_participant"] for row in rows}), "partition_path": path,
                    "source_url": source["source_url"], "raw_sha256": source["raw_sha256"],
                    "retrieved_at": source["retrieved_at"], "attribution": "Cboe Exchange, Inc."}
        market.append(metadata)
        partitions[path] = {"schema_version": "1.0", "family": "market", "source": metadata,
            "grain": "one source file, trade date, and market participant", "daily": days, "participants": rows}

    occurrence_candidate = {occurrence_id: candidate["id"] for candidate in discovery["candidates"]
                            for occurrence_id in candidate["occurrence_ids"]}
    inventory = []
    inventory_partitions = []
    for artifact in discovery["artifacts"]:
        path = artifact["inventory_export_path"]
        partition = json.loads((root / path).read_text())
        if partition["raw_sha256"] != artifact["raw_sha256"] or len(partition["rows"]) != artifact["raw_item_count"]:
            raise ValueError(f"inventory partition differs from its pinned artifact: {path}")
        public_path = str(Path(path).relative_to("web"))
        inventory_partitions.append({"source": artifact["source"], "year": artifact["year"],
            "count": len(partition["rows"]), "raw_sha256": artifact["raw_sha256"], "partition_path": public_path})
        for row in partition["rows"]:
            stored_row = stored_inventory.get(row["id"])
            if stored_row is None or any(stored_row[key] != row[key] for key in stored_row):
                raise ValueError(f"inventory partition differs from stored observation: {row['id']}")
            inventory.append({key: row[key] for key in ("id", "name", "description", "source", "year",
                "source_category", "source_subcategory", "mapping_status")} | {
                "candidate_id": occurrence_candidate.get(row["id"]), "partition_path": public_path})
    if len(inventory) != len(stored_inventory):
        raise ValueError("inventory database count differs from its exported partitions")
    partitions["data/inventory-search.json"] = {"schema_version": "1.0", "records": inventory}
    topology = export_topology(connection, cohort)
    counts = {"companies": len(companies), "inventory_rows": len(inventory),
              "inventory_artifacts": len(discovery["artifacts"]), "tagged_occurrences": len(discovery["occurrences"]),
              "candidate_keys": len(discovery["candidates"]), "identity_reviews": len(discovery["identity_reviews"]),
              "provider_leads": len(discovery["provider_candidates"]), "page_snapshots": len(pages),
              "sec_candidates": len(sec), "sec_selected": len(selected), "market_files": len(market),
              "market_daily_totals": len(daily_rows), "market_participant_rows": len(participant_rows),
              "topology_claims": len(topology["claims"]), "topology_reviews": len(topology["review_history"])}
    counts.update(pages=len(pages), sec=len(sec), market_rows=len(participant_rows))
    datasets = [
        {"id": "inventory", "label": "software inventories", "grain": "one row in one dated directory snapshot",
         "count": len(inventory), "partition_paths": [row["partition_path"] for row in inventory_partitions]},
        {"id": "pages", "label": "archived pages", "grain": "one immutable provider snapshot",
         "count": len(pages), "partition_paths": [f"data/pages/{slug}.json" for slug in sorted(pages_by_company)]},
        {"id": "sec", "label": "reported financial facts", "grain": "one retained SEC fact candidate",
         "count": len(sec), "partition_paths": [f"data/sec/{slug}.json" for slug in sorted(sec_by_company)]},
        {"id": "market", "label": "U.S. equity activity", "grain": "one participant row in one daily source file",
         "count": len(participant_rows), "partition_paths": [row["partition_path"] for row in market]},
        {"id": "topology", "label": "reviewed relationship claims", "grain": "one scoped accepted source assertion",
         "count": len(topology["claims"]), "partition_paths": []}]
    index = {"schema_version": "1.0", "counts": counts, "companies": list(companies.values()),
             "datasets": datasets, "pages": pages, "sec": sec, "market": market, "topology": topology,
             "discovery": {"index_path": "discovery.json", "search_path": "data/inventory-search.json",
                           "inventory_partitions": inventory_partitions},
             "provenance": {"migrations": migrations, "sec_policy_version": analysis["policy_version"],
                            "sec_as_of": analysis["as_of"], "page_text_limit": page_text_limit,
                            "discovery_sha256": hashlib.sha256((root / "web/discovery.json").read_bytes()).hexdigest()},
             "research": {key: dashboard[key] for key in ("reviewed_quotes", "financing_announcements", "us_location_reviews")}}
    manifest = {path: {"sha256": hashlib.sha256(encode(payload)).hexdigest(), "bytes": len(encode(payload))}
                for path, payload in sorted(partitions.items())}
    index["partitions"] = manifest
    index["build_id"] = hashlib.sha256(encode(index)).hexdigest()
    return index, partitions


def reconcile_market(participants, daily):
    """Each participant contributes exactly once to its file/date aggregate."""
    totals = defaultdict(lambda: {"participant_rows": 0, "total_shares": 0,
                                 "total_notional": Decimal(0), "total_trade_count": 0, "trf_shares": 0})
    seen = set()
    for row in participants:
        key = (row["file_id"], row["trade_date"], row["market_participant"])
        if key in seen:
            raise ValueError("duplicate market participant observation")
        seen.add(key)
        target = totals[(row["file_id"], row["trade_date"])]
        target["participant_rows"] += 1
        for field in ("total_shares", "total_notional", "total_trade_count"):
            target[field] += row[field]
        if row["market_participant"].startswith("FINRA /"):
            target["trf_shares"] += row["total_shares"]
    if len(daily) != len(totals):
        raise ValueError("market daily count differs from source participants")
    for row in daily:
        expected = totals[(row["file_id"], row["trade_date"])]
        if any((row[field] or 0) != value for field, value in expected.items()):
            raise ValueError("market daily aggregate differs from source participants")


def write_data_export(web_root: Path, index: dict, partitions: dict):
    """Serialize everything before publication and replace the catalog last."""
    payloads = {path: encode(value) for path, value in partitions.items()}
    payloads["data/index.json"] = encode(index)
    web_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".data-build-", dir=web_root) as temporary:
        staged = Path(temporary)
        for path, raw in payloads.items():
            output = staged / path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(raw)
        for path in payloads:
            destination = web_root / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged / path, destination)
