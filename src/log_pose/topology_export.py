"""Project accepted database assertions into the public claim-reading contract."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone

from bs4 import BeautifulSoup

from .topology_store import reviewed_claims


def iso(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return value.isoformat() if isinstance(value, date) else value


def export_topology(connection, cohort: list[dict]) -> dict:
    """Keep all reviewed premises and identifiers; never infer acceptance from a seed file."""
    accepted = []
    while True:
        page = reviewed_claims(connection, limit=500, offset=len(accepted))
        accepted.extend(page)
        if len(page) < 500:
            break
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM topology_entities ORDER BY id")
        stored_entities = {row["id"]: row for row in cursor.fetchall()}
        cursor.execute("""SELECT source.*, snapshot.raw_html AS snapshot_body
            FROM topology_sources AS source
            LEFT JOIN snapshots AS snapshot ON snapshot.id=source.snapshot_id
            ORDER BY source.id""")
        sources = {row["id"]: row for row in cursor.fetchall()}
        cursor.execute("SELECT * FROM topology_reviews ORDER BY reviewed_at,id")
        reviews = cursor.fetchall()
        cursor.execute("SELECT id FROM topology_candidates ORDER BY id")
        candidate_ids = [row["id"] for row in cursor.fetchall()]
    companies = {row["slug"]: row for row in cohort}
    claims = []
    used_entities = set()
    basis_status = {"source_statement": "documented", "reviewed_inference": "reviewed_inference",
                    "hypothesis": "hypothesis"}
    source_text = {}

    def source_view(source_id, *, locator, summary, quote, role, event_on=None,
                    period_start=None, period_end=None):
        source = sources[source_id]
        raw = source["raw_body"] if source["raw_body"] is not None else source["snapshot_body"]
        if raw is None or source["retrieval_status"] != "retrieved":
            raise ValueError(f"topology evidence is not retained: {source_id}")
        raw = bytes(raw)
        if hashlib.sha256(raw).hexdigest() != source["raw_sha256"]:
            raise ValueError(f"topology artifact hash differs: {source_id}")
        if source_id not in source_text:
            source_text[source_id] = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
        if quote and quote not in source_text[source_id]:
            raise ValueError(f"topology quotation is absent from its artifact: {source_id}")
        return {"id": source_id, "source_url": source["source_url"],
                "publisher": source["publisher"], "title": source["title"],
                "source_type": source["source_type"], "source_date": iso(source["published_on"]),
                "retrieved_at": iso(source["retrieved_at"]),
                "retrieved_on": source["retrieved_at"].astimezone(timezone.utc).date().isoformat(),
                "captured_at": iso(source["captured_at"]), "snapshot_id": source["snapshot_id"],
                "artifact_sha256": source["raw_sha256"], "evidence_locator": locator,
                "evidence_kind": "summary", "evidence_text": summary, "evidence_quote": quote,
                "role": role, "event_date": iso(event_on), "period_start": iso(period_start),
                "period_end": iso(period_end)}

    for row in accepted:
        for endpoint in (row["subject_entity_id"], row["object_entity_id"]):
            entity = stored_entities[endpoint]
            if entity["identity_status"] != "reviewed":
                raise ValueError(f"accepted claim endpoint is not identity reviewed: {endpoint}")
            used_entities.add(endpoint)
        evidence = [source_view(row["source_id"], locator=row["evidence_locator"],
                    summary=row["evidence_text"], quote=row["exact_quote"], role="support",
                    event_on=row["event_on"], period_start=row["period_start"], period_end=row["period_end"])]
        for premise in row["additional_evidence"]:
            evidence.append(source_view(premise["source_id"], locator=premise["locator"],
                summary=premise["summary"], quote=premise["exact_quote"], role=premise["role"],
                event_on=premise["event_on"], period_start=premise["period_start"],
                period_end=premise["period_end"]))
        # Existing seed URLs remain addressable, while database_id is never discarded.
        public_id = (row["id"].removeprefix("seed-claim:").rsplit(":", 1)[0]
                     if row["id"].startswith("seed-claim:") else row["id"])
        review = {"id": row["review_id"], "reviewer": row["reviewer"],
                  "reviewed_at": iso(row["reviewed_at"]), "rationale": row["rationale"],
                  "decision": "accept", "date_precision": "day" if row["rationale"].startswith(
                      "Imported prior curated seed review dated ") else "timestamp"}
        claim = {"id": public_id, "database_id": row["id"],
                 "subject_slug": row["subject_entity_id"], "object_slug": row["object_entity_id"],
                 "claim_status": basis_status[row["proposed_basis"]],
                 "event_date": iso(row["event_on"]), "valid_from": iso(row["valid_from"]),
                 "valid_to": iso(row["valid_to"]), "created_at": iso(row["created_at"]),
                 "sources": evidence, "review": review}
        for key in ("predicate", "direction", "scope", "interpretation", "alternative_or_unknown",
                    "temporal_form", "temporal_basis", "generator", "generator_version"):
            claim[key] = row[key]
        claims.append(claim)
    if len({claim["id"] for claim in claims}) != len(claims):
        raise ValueError("accepted claims have colliding public identifiers")
    entities = []
    for entity_id in sorted(used_entities):
        row = stored_entities[entity_id]
        company = companies.get(entity_id)
        entities.append({"slug": entity_id, "name": row["name"], "entity_kind": row["entity_kind"],
                         "category": company["category"] if company else "reviewed_external_entity",
                         "identity_status": "reviewed_pilot_company" if company else "reviewed_company"})
    history = [{key: iso(value) for key, value in row.items()} for row in reviews]
    latest = {}
    for review in history:
        latest[review["candidate_id"]] = review["decision"]
    return {"schema_version": "1.0", "projection": "accepted_database_reviews",
            "reviewed_at": max((claim["review"]["reviewed_at"][:10] for claim in claims), default=None),
            "entities": entities, "claims": claims, "review_history": history,
            "counts": {"entities": len(entities), "claims": len(claims), "reviews": len(history),
                       "sources": len(sources), "candidates": len(candidate_ids),
                       "rejected": sum(value == "reject" for value in latest.values()),
                       "needs_evidence": sum(value == "needs_evidence" for value in latest.values()),
                       "unreviewed": sum(key not in latest for key in candidate_ids)}}
