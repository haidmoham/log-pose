"""Load reviewed source captures and assertions into the append-only topology store."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

from log_pose.topology import validate_topology


def _source_identifier(manifest_item: dict, digest: str) -> str:
    return f"seed-source:{manifest_item['id']}:{digest}"


def _candidate_identifier(claim: dict, source_url: str) -> str:
    url_hash = hashlib.sha256(source_url.encode()).hexdigest()[:12]
    return f"seed-claim:{claim['id']}:{url_hash}"


def import_seed(topology: dict, manifest: list[dict], cohort: list[dict], *,
                repository_root: Path, reviewer: str) -> dict[str, int]:
    """Persist the reviewed seed; each source-backed assertion gets its own candidate."""
    from log_pose.storage import connect
    from log_pose.topology_store import (
        add_candidate_evidence,
        ensure_entity,
        record_review,
        store_candidate,
        store_source,
    )

    validate_topology(topology, cohort, repository_root=repository_root)
    manifest_by_url = {item["source_url"]: item for item in manifest}
    sources_by_url = {}
    for claim in topology["claims"]:
        for source in claim["sources"]:
            item = manifest_by_url.get(source["source_url"])
            if item is None:
                raise ValueError(f"source is missing from the acquisition manifest: {source['source_url']}")
            if item["published_on"] != source["source_date"]:
                raise ValueError(f"source publication date differs from manifest: {source['source_url']}")
            if item.get("retrieved_at") != source.get("retrieved_at"):
                raise ValueError(f"source retrieval timestamp differs from manifest: {source['source_url']}")
            sources_by_url[source["source_url"]] = item

    stored_sources = 0
    stored_entities = 0
    stored_candidates = 0
    stored_evidence = 0
    accepted_reviews = 0
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT slug, id FROM companies")
            pilot_ids = {row["slug"]: row["id"] for row in cursor.fetchall()}

        for entity in topology["entities"]:
            pilot_company_id = pilot_ids.get(entity["slug"])
            if entity["identity_status"] == "reviewed_pilot_company" and pilot_company_id is None:
                raise ValueError(f"reviewed pilot entity is absent from the company table: {entity['slug']}")
            outcome = ensure_entity(
                connection,
                entity_id=entity["slug"],
                name=entity["name"],
                entity_kind="company",
                identity_status="reviewed" if entity["identity_status"] != "unresolved" else "unresolved",
                pilot_company_id=pilot_company_id,
            )
            stored_entities += outcome == "stored"

        source_records = {}
        for url, source in sources_by_url.items():
            manifest_item = manifest_by_url[url]
            artifact = repository_root / source["artifact_path"]
            raw = artifact.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest != source["expected_sha256"]:
                raise ValueError(f"source artifact changed before import: {artifact}")
            retrieved_at = datetime.fromisoformat(source["retrieved_at"])
            source_id = _source_identifier(manifest_item, digest)
            result = store_source(
                connection,
                source_id=source_id,
                source_url=url,
                publisher=source["publisher"],
                title=manifest_item["title"],
                source_type=source["source_type"],
                retrieved_at=retrieved_at,
                raw_body=raw,
                raw_sha256=digest,
                published_on=date.fromisoformat(source["published_on"]),
            )
            stored_sources += result == "stored"
            source_records[url] = (source_id, source, retrieved_at)

        for claim in topology["claims"]:
            basis_by_status = {
                "documented": "source_statement",
                "reviewed_inference": "reviewed_inference",
                "hypothesis": "hypothesis",
            }
            sources = claim["sources"]
            primary = sources[0]
            primary_source_id, _primary_metadata, _retrieved_at = source_records[primary["source_url"]]
            candidate_id = _candidate_identifier(claim, primary["source_url"])
            result = store_candidate(
                connection,
                candidate_id=candidate_id,
                source_id=primary_source_id,
                subject_entity_id=claim["subject_slug"],
                object_entity_id=claim["object_slug"],
                predicate=claim["predicate"],
                direction=claim["direction"],
                scope=claim["scope"],
                evidence_locator=primary["evidence_locator"],
                evidence_text=primary["evidence_text"],
                exact_quote=primary.get("evidence_quote"),
                interpretation=claim["interpretation"],
                alternative_or_unknown=claim["alternative_or_unknown"],
                temporal_form=claim["temporal_form"],
                temporal_basis=claim["temporal_basis"],
                proposed_basis=basis_by_status[claim["claim_status"]],
                generator="curated_seed",
                generator_version=topology["schema_version"],
                event_on=date.fromisoformat(claim["event_date"]) if claim.get("event_date") else None,
                valid_from=date.fromisoformat(claim["valid_from"]) if claim.get("valid_from") else None,
                valid_to=date.fromisoformat(claim["valid_to"]) if claim.get("valid_to") else None,
                period_start=date.fromisoformat(primary["period_start"]) if primary.get("period_start") else None,
                period_end=date.fromisoformat(primary["period_end"]) if primary.get("period_end") else None,
            )
            stored_candidates += result == "stored"

            for supporting_source in sources[1:]:
                extra_source_id, _extra_metadata, _extra_retrieved_at = source_records[supporting_source["source_url"]]
                result = add_candidate_evidence(
                    connection,
                    candidate_id=candidate_id,
                    source_id=extra_source_id,
                    evidence_role="support",
                    evidence_locator=supporting_source["evidence_locator"],
                    evidence_summary=supporting_source["evidence_text"],
                    exact_quote=supporting_source.get("evidence_quote"),
                    event_on=date.fromisoformat(supporting_source["event_date"])
                    if supporting_source.get("event_date") else None,
                    period_start=date.fromisoformat(supporting_source["period_start"])
                    if supporting_source.get("period_start") else None,
                    period_end=date.fromisoformat(supporting_source["period_end"])
                    if supporting_source.get("period_end") else None,
                )
                stored_evidence += result == "stored"

            rationale = (
                f"Accepted after review of {len(sources)} retained source(s), beginning at "
                f"{primary['evidence_locator']}. The claim scope and alternative/unknown statement "
                "are retained with the source assertion."
            )
            with connection.cursor() as cursor:
                cursor.execute("""SELECT 1 FROM topology_reviews
                    WHERE candidate_id=%s AND decision='accept' AND reviewer=%s AND rationale=%s LIMIT 1""",
                    (candidate_id, reviewer, rationale))
                already_reviewed = cursor.fetchone() is not None
            if not already_reviewed:
                record_review(
                    connection,
                    candidate_id=candidate_id,
                    decision="accept",
                    reviewer=reviewer,
                    rationale=rationale,
                    reviewed_at=datetime.now(timezone.utc),
                )
                accepted_reviews += 1

    return {
        "entities_created": int(stored_entities),
        "sources_created": int(stored_sources),
        "source_assertions_created": int(stored_candidates),
        "secondary_evidence_links_created": int(stored_evidence),
        "reviews_appended": int(accepted_reviews),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topology", type=Path, default=Path("docs/research/market-topology.json"))
    parser.add_argument("--manifest", type=Path, default=Path("docs/research/topology-source-manifest.json"))
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--reviewer", default="Codex source review")
    args = parser.parse_args()
    repository_root = Path(".")
    counts = import_seed(
        json.loads(args.topology.read_text()),
        json.loads(args.manifest.read_text()),
        json.loads(args.cohort.read_text()),
        repository_root=repository_root,
        reviewer=args.reviewer,
    )
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
