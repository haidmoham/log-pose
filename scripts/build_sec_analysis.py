"""Build a provenance-backed SEC coverage and as-of selection report."""

import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from log_pose.sec_analysis import POLICY_VERSION, TAG_ORDER, select_fact
from log_pose.storage import connect


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/research/sec-analysis-build.json"))
    parser.add_argument("--as-of", type=date.fromisoformat, default=date(2025, 4, 1))
    args = parser.parse_args()

    cohort = [item for item in json.loads(args.cohort.read_text()) if item.get("cik")]
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""SELECT artifact_version, source_url, etag, last_modified,
                content_length, observed_at FROM sec_artifacts ORDER BY observed_at""")
        artifacts = cur.fetchall()
        if len(artifacts) != 1:
            raise ValueError(f"expected one pinned SEC artifact, found {len(artifacts)}")
        artifact = artifacts[0]
        artifact_version = artifact["artifact_version"].strip()
        cur.execute("""SELECT sc.cik, sc.entity_name, sc.raw_sha256, sc.artifact_version,
                sf.id AS fact_id, sf.concept_group, sf.taxonomy, sf.tag, sf.unit,
                sf.value, sf.start_date, sf.end_date, sf.filed_date,
                sf.accession_number, sf.form, sf.fy, sf.fp, sf.frame
            FROM sec_companyfacts sc JOIN sec_financial_facts sf ON sf.companyfacts_id=sc.id
            WHERE sc.artifact_version=%s ORDER BY sc.cik, sf.id""", (artifact_version,))
        facts = cur.fetchall()

    grouped = defaultdict(list)
    for fact in facts:
        key = (fact["cik"].strip(), fact["concept_group"], fact["end_date"].year)
        grouped[key].append(fact)

    cells = []
    for company in cohort:
        cik = str(company["cik"]).zfill(10)
        for year in range(2021, 2025):
            for concept in TAG_ORDER:
                candidates = grouped[(cik, concept, year)]
                status, selected = select_fact(candidates, args.as_of)
                cells.append({
                    "slug": company["slug"], "cik": cik, "period_end_year": year,
                    "concept": concept, "status": status,
                    "candidate_count": len(candidates),
                    "candidate_tags": sorted({row["tag"] for row in candidates}),
                    "first_filed": min((row["filed_date"] for row in candidates), default=None),
                    "selected": None if selected is None else {
                        key: selected[key] for key in (
                            "fact_id", "taxonomy", "tag", "unit", "value", "start_date",
                            "end_date", "filed_date", "accession_number", "form", "fy", "fp",
                            "frame", "raw_sha256", "artifact_version")
                    },
                })
    statuses = defaultdict(int)
    for cell in cells:
        statuses[cell["status"]] += 1
    report = {
        "policy_version": POLICY_VERSION,
        "policy": "USD only; one exact period per cell; preferred tag order; earliest eligible annual filing; same-day conflicts unresolved",
        "as_of": args.as_of,
        "source_artifact": {
            "version": artifact_version,
            "url": artifact["source_url"],
            "etag": artifact["etag"],
            "last_modified": artifact["last_modified"],
            "content_length": artifact["content_length"],
            "observed_at": artifact["observed_at"],
        },
        "cohort_count": len(cohort),
        "candidate_fact_count": len(facts),
        "statuses": dict(sorted(statuses.items())),
        "cells": cells,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"{len(cells)} cells: {dict(statuses)}; {len(facts)} candidate facts")


if __name__ == "__main__":
    main()
