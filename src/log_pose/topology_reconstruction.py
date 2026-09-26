"""Reconstruct only the retained reviewed-topology slice, with explicit gaps."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from psycopg.rows import dict_row
from psycopg.conninfo import conninfo_to_dict

from .atlas_membership import encode
from .topology_export import export_topology

RECONSTRUCTION_VERSION = "topology-reconstruction-v1"
LOCAL_SOCKET = "/home/haidm/.cache/log-pose-evidence-recovery-20260926/socket"


def validate_reconstruction_target(database_url: str) -> None:
    target = conninfo_to_dict(database_url)
    database = target.get("dbname", "")
    hosts = target.get("host", "").split(",")
    if not database.startswith("topology_reconstruction_"):
        raise ValueError("target database must use the topology_reconstruction_ prefix")
    if any(target.get(key) for key in ("hostaddr", "service", "servicefile")):
        raise ValueError("topology reconstruction rejects alternate libpq routing")
    if hosts != [LOCAL_SOCKET]:
        raise ValueError("topology reconstruction requires the approved local Unix socket")


def _time(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("reconstruction timestamps require an explicit timezone")
    return parsed.astimezone(timezone.utc)


def _comparable(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, memoryview):
        return bytes(value)
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value
    return value


def _equal(row: dict, expected: dict) -> bool:
    return all(_comparable(row.get(key)) == _comparable(value)
               for key, value in expected.items())


def _insert_exact(cursor, table: str, key_column: str, values: dict, *, identity=False) -> bool:
    columns = list(values)
    placeholders = ",".join(["%s"] * len(columns))
    override = " OVERRIDING SYSTEM VALUE" if identity else ""
    cursor.execute(f"INSERT INTO {table} ({','.join(columns)}){override} VALUES ({placeholders}) "
                   f"ON CONFLICT ({key_column}) DO NOTHING RETURNING {key_column}",
                   tuple(values.values()))
    if cursor.fetchone() is not None:
        return True
    cursor.execute(f"SELECT {','.join(columns)} FROM {table} WHERE {key_column}=%s",
                   (values[key_column],))
    stored = cursor.fetchone()
    if stored is None or not _equal(stored, values):
        raise ValueError(f"{table} {key_column} conflicts with retained reconstruction")
    return False


def _record(cursor, *, batch_id: str, kind: str, key: str, original_id: str | None,
            original_arrival: datetime | None, reconstructed_at: datetime,
            unknown_fields: list[str], detail: dict) -> None:
    values = {"batch_id": batch_id, "record_kind": kind, "record_key": key,
              "original_id": original_id, "original_arrival_at": original_arrival,
              "reconstruction_arrived_at": reconstructed_at,
              "unknown_fields": unknown_fields, "detail": json.dumps(detail)}
    cursor.execute("""INSERT INTO topology_reconstruction_records
        (batch_id,record_kind,record_key,original_id,original_arrival_at,
         reconstruction_arrived_at,unknown_fields,detail)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
        ON CONFLICT (record_kind,record_key) DO NOTHING RETURNING record_key""",
        tuple(values.values()))
    if cursor.fetchone() is None:
        cursor.execute("""SELECT batch_id,original_id,original_arrival_at,
            reconstruction_arrived_at,unknown_fields,detail
            FROM topology_reconstruction_records WHERE record_kind=%s AND record_key=%s""",
            (kind, key))
        stored = cursor.fetchone()
        expected = {name: values[name] for name in
                    ("batch_id", "original_id", "original_arrival_at",
                     "reconstruction_arrived_at", "unknown_fields")}
        expected["detail"] = detail
        if stored is None or not _equal(stored, expected):
            raise ValueError(f"reconstruction provenance conflicts: {kind}/{key}")


def reconstruct_topology(connection, *, repository_root: Path, projection_path: Path,
                         packet_path: Path, reconstructed_at: datetime) -> dict:
    """Load one pinned projection and its accepted append in one transaction."""
    if reconstructed_at.tzinfo is None or reconstructed_at.utcoffset() is None:
        raise ValueError("reconstruction arrival requires an explicit timezone")
    reconstructed_at = reconstructed_at.astimezone(timezone.utc)
    projection_document = json.loads(projection_path.read_bytes())
    projection = projection_document.get("topology", projection_document)
    canonical_projection_hash = hashlib.sha256(encode(projection)).hexdigest()
    if projection_document.get("schema_version") == "topology-reconstruction-input-v1":
        if projection_document.get("topology_sha256") != canonical_projection_hash:
            raise ValueError("frozen topology reconstruction input hash differs")
        preflight = json.loads((repository_root / projection_document["preflight_path"]).read_text())
        expected_ids = {row["database_id"] for row in preflight["preserve_claim_ids"]}
        if ({row["database_id"] for row in projection["claims"]} != expected_ids
                or projection["counts"] != preflight["public_projection"]["topology_counts"]):
            raise ValueError("frozen topology reconstruction input differs from approved preflight")
    packet = json.loads(packet_path.read_text())
    decision_path = repository_root / "docs/research/issue11/topology-reconstruction-decision.json"
    decision = json.loads(decision_path.read_text())
    if decision.get("decision") != "accept_scoped_reconstruction":
        raise ValueError("scoped topology reconstruction is not approved")
    if packet["status"] != "human_accepted_pending_canonical_import" or packet["review"]["decision"] != "accept":
        raise ValueError("integration packet is not an accepted pending import")
    projection_hash = canonical_projection_hash
    batch_id = f"reconstruction:{projection_hash[:16]}"
    manifest = {"version": RECONSTRUCTION_VERSION,
                "projection_path": str(projection_path.relative_to(repository_root)),
                "projection_sha256": projection_hash,
                "packet_id": packet["packet_id"],
                "packet_sha256": hashlib.sha256(packet_path.read_bytes()).hexdigest(),
                "decision_sha256": hashlib.sha256(decision_path.read_bytes()).hexdigest()}
    counts = {"sources": 0, "entities": 0, "candidates": 0, "evidence": 0,
              "reviews": 0, "integration_candidates": 0, "integration_reviews": 0}
    with connection.transaction():
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext('topology-reconstruction-v1'))")
            cursor.execute("""INSERT INTO topology_reconstruction_batches
                (id,projection_sha256,reconstructed_at,input_manifest)
                VALUES (%s,%s,%s,%s::jsonb) ON CONFLICT (id) DO NOTHING
                RETURNING reconstructed_at""",
                (batch_id, projection_hash, reconstructed_at, json.dumps(manifest)))
            inserted_batch = cursor.fetchone()
            new_batch = inserted_batch is not None
            if inserted_batch is None:
                cursor.execute("""SELECT projection_sha256,reconstructed_at,input_manifest
                    FROM topology_reconstruction_batches WHERE id=%s""", (batch_id,))
                stored_batch = cursor.fetchone()
                if (stored_batch["projection_sha256"] != projection_hash
                        or stored_batch["input_manifest"] != manifest):
                    raise ValueError("reconstruction batch conflicts with retained inputs")
                reconstructed_at = stored_batch["reconstructed_at"]
            source_by_id = {}
            for claim in projection["claims"]:
                for source in claim["sources"]:
                    source_by_id[source["id"]] = source
            retained_manifest = {row["id"]: row for row in json.loads(
                (repository_root / "docs/research/topology-source-manifest.json").read_text())}
            for source_id, source in sorted(source_by_id.items()):
                manifest_id = next((key for key in retained_manifest
                                    if source_id.startswith(f"seed-source:{key}:")), None)
                if manifest_id is None:
                    raise ValueError(f"source ID has no retained manifest record: {source_id}")
                artifact = repository_root / retained_manifest[manifest_id]["artifact_path"]
                raw = artifact.read_bytes()
                digest = hashlib.sha256(raw).hexdigest()
                if digest != source["artifact_sha256"]:
                    raise ValueError(f"retained source hash differs: {source_id}")
                retained_text = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
                for claim in projection["claims"]:
                    for premise in claim["sources"]:
                        quote = premise.get("evidence_quote")
                        if premise["id"] == source_id and quote and quote not in retained_text:
                            raise ValueError(f"retained quote is absent: {source_id}")
                values = {"id": source_id, "source_url": source["source_url"],
                    "publisher": source["publisher"], "title": source["title"],
                    "source_type": source["source_type"], "published_on": source["source_date"],
                    "captured_at": _time(source.get("captured_at")),
                    "retrieved_at": _time(source["retrieved_at"]), "raw_body": raw,
                    "raw_sha256": digest, "snapshot_id": source.get("snapshot_id"),
                    "retrieval_status": "retrieved", "error": None}
                counts["sources"] += _insert_exact(cursor, "topology_sources", "id", values)
                _record(cursor, batch_id=batch_id, kind="source", key=source_id,
                        original_id=source_id, original_arrival=_time(source["retrieved_at"]),
                        reconstructed_at=reconstructed_at, unknown_fields=[], detail={"raw_sha256": digest})
            for entity in projection["entities"]:
                values = {"id": entity["slug"], "name": entity["name"],
                          "entity_kind": entity["entity_kind"], "identity_status": "reviewed",
                          "pilot_company_id": None, "created_at": reconstructed_at,
                          "original_created_at": None,
                          "reconstruction_arrived_at": reconstructed_at}
                counts["entities"] += _insert_exact(cursor, "topology_entities", "id", values)
                _record(cursor, batch_id=batch_id, kind="entity", key=entity["slug"],
                        original_id=entity["slug"], original_arrival=None,
                        reconstructed_at=reconstructed_at,
                        unknown_fields=["topology_entities.created_at", "pilot_company_id"], detail={})
            for claim in projection["claims"]:
                primary = claim["sources"][0]
                basis = {"documented": "source_statement", "reviewed_inference": "reviewed_inference",
                         "hypothesis": "hypothesis"}[claim["claim_status"]]
                candidate = {"id": claim["database_id"], "source_id": primary["id"],
                    "subject_entity_id": claim["subject_slug"], "object_entity_id": claim["object_slug"],
                    "predicate": claim["predicate"], "direction": claim["direction"],
                    "scope": claim["scope"], "evidence_locator": primary["evidence_locator"],
                    "evidence_text": primary["evidence_text"], "exact_quote": primary["evidence_quote"],
                    "interpretation": claim["interpretation"],
                    "alternative_or_unknown": claim["alternative_or_unknown"],
                    "temporal_form": claim["temporal_form"], "temporal_basis": claim["temporal_basis"],
                    "event_on": claim["event_date"], "valid_from": claim["valid_from"],
                    "valid_to": claim["valid_to"], "period_start": primary["period_start"],
                    "period_end": primary["period_end"], "proposed_basis": basis,
                    "generator": claim["generator"], "generator_version": claim["generator_version"],
                    "created_at": _time(claim["created_at"]),
                    "original_created_at": _time(claim["created_at"]),
                    "reconstruction_arrived_at": reconstructed_at}
                counts["candidates"] += _insert_exact(cursor, "topology_candidates", "id", candidate)
                _record(cursor, batch_id=batch_id, kind="candidate", key=claim["database_id"],
                        original_id=claim["database_id"], original_arrival=_time(claim["created_at"]),
                        reconstructed_at=reconstructed_at, unknown_fields=[], detail={"public_id": claim["id"]})
                for ordinal, premise in enumerate(claim["sources"][1:], 1):
                    evidence_key = f"{claim['database_id']}:{premise['id']}:{premise['role']}:{premise['evidence_locator']}"
                    cursor.execute("""INSERT INTO topology_candidate_evidence
                        (candidate_id,source_id,evidence_role,evidence_locator,evidence_summary,
                         exact_quote,event_on,period_start,period_end,added_at,original_added_at,
                         reconstruction_arrived_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s)
                        ON CONFLICT (candidate_id,source_id,evidence_role,evidence_locator) DO NOTHING
                        RETURNING id""", (claim["database_id"], premise["id"], premise["role"],
                        premise["evidence_locator"], premise["evidence_text"], premise["evidence_quote"],
                        premise["event_date"], premise["period_start"], premise["period_end"],
                        reconstructed_at, reconstructed_at))
                    inserted = cursor.fetchone()
                    if inserted is None:
                        cursor.execute("""SELECT evidence_summary,exact_quote,event_on,period_start,period_end,
                            original_added_at,reconstruction_arrived_at FROM topology_candidate_evidence
                            WHERE candidate_id=%s AND source_id=%s AND evidence_role=%s AND evidence_locator=%s""",
                            (claim["database_id"], premise["id"], premise["role"], premise["evidence_locator"]))
                        expected = {"evidence_summary": premise["evidence_text"],
                            "exact_quote": premise["evidence_quote"], "event_on": premise["event_date"],
                            "period_start": premise["period_start"], "period_end": premise["period_end"],
                            "original_added_at": None, "reconstruction_arrived_at": reconstructed_at}
                        if not _equal(cursor.fetchone(), expected):
                            raise ValueError("additional evidence conflicts with retained reconstruction")
                    else:
                        counts["evidence"] += 1
                    _record(cursor, batch_id=batch_id, kind="evidence", key=evidence_key,
                            original_id=None, original_arrival=None, reconstructed_at=reconstructed_at,
                            unknown_fields=["topology_candidate_evidence.id",
                                            "topology_candidate_evidence.added_at"],
                            detail={"ordinal": ordinal})
            for review in projection["review_history"]:
                values = {"id": review["id"], "candidate_id": review["candidate_id"],
                          "decision": review["decision"], "reviewer": review["reviewer"],
                          "reviewed_at": _time(review["reviewed_at"]), "rationale": review["rationale"]}
                counts["reviews"] += _insert_exact(cursor, "topology_reviews", "id", values, identity=True)
                _record(cursor, batch_id=batch_id, kind="review", key=str(review["id"]),
                        original_id=str(review["id"]), original_arrival=None,
                        reconstructed_at=reconstructed_at,
                        unknown_fields=["topology_reviews.row_arrival_at"],
                        detail={"decision_reviewed_at": review["reviewed_at"]})
            cohort = json.loads((repository_root / "docs/research/pilot-cohort.json").read_text())
            if new_batch:
                reconstructed_projection = export_topology(connection, cohort)
                if encode(reconstructed_projection) != encode(projection):
                    raise ValueError("reconstructed topology differs before accepted append")
            cursor.execute("SELECT setval(pg_get_serial_sequence('topology_reviews','id'), "
                           "GREATEST((SELECT max(id) FROM topology_reviews),1), true)")
            proposal = packet["proposal"]; source = packet["source"]; evidence = proposal["evidence"]
            integration_source = source_by_id.get(source["source_record_id"])
            if integration_source is None or integration_source["artifact_sha256"] != source["artifact_sha256"]:
                raise ValueError("integration packet source differs from reconstructed source")
            artifact = repository_root / source["artifact_path"]
            normalized_blocks = [" ".join(node.get_text(" ", strip=True).split())
                                 for node in BeautifulSoup(artifact.read_bytes(), "html.parser").select(
                                     evidence["normalized_block_selector"])]
            block_index = evidence["normalized_block_zero_based_index"]
            if block_index >= len(normalized_blocks):
                raise ValueError("integration evidence block is absent")
            block = normalized_blocks[block_index]
            if hashlib.sha256(block.encode()).hexdigest() != evidence["normalized_block_sha256"]:
                raise ValueError("integration evidence block hash differs")
            if evidence["exact_quote"] not in block:
                raise ValueError("integration quotation is absent from retained block")
            candidate_id = proposal["local_proposal_id"]
            integration = {"id": candidate_id, "source_id": source["source_record_id"],
                "subject_entity_id": proposal["subject_slug"], "object_entity_id": proposal["object_slug"],
                "predicate": proposal["predicate"], "direction": proposal["direction"],
                "scope": proposal["scope"], "evidence_locator": evidence["locator"],
                "evidence_text": proposal["interpretation"], "exact_quote": evidence["exact_quote"],
                "interpretation": proposal["interpretation"],
                "alternative_or_unknown": "; ".join(proposal["unknowns"]),
                "temporal_form": proposal["temporal_form"], "temporal_basis": proposal["temporal_basis"],
                "event_on": proposal["event_on"], "valid_from": proposal["valid_from"],
                "valid_to": proposal["valid_to"], "period_start": None, "period_end": None,
                "proposed_basis": proposal["proposed_basis"], "generator": "human_review_packet",
                "generator_version": packet["schema_version"], "created_at": reconstructed_at,
                "original_created_at": reconstructed_at, "reconstruction_arrived_at": reconstructed_at}
            counts["integration_candidates"] += _insert_exact(cursor, "topology_candidates", "id", integration)
            cursor.execute("SELECT id,decision,reviewer,reviewed_at,rationale FROM topology_reviews WHERE candidate_id=%s",
                           (candidate_id,))
            existing = cursor.fetchall()
            expected_review = ("accept", packet["review"]["reviewer"],
                               _time(packet["review"]["recorded_at"]), packet["review"]["rationale"])
            if existing:
                if len(existing) != 1 or tuple(existing[0][key] for key in
                    ("decision", "reviewer", "reviewed_at", "rationale")) != expected_review:
                    raise ValueError("integration review conflicts with accepted packet")
                review_id = existing[0]["id"]
            else:
                cursor.execute("""INSERT INTO topology_reviews(candidate_id,decision,reviewer,reviewed_at,rationale)
                    VALUES (%s,%s,%s,%s,%s) RETURNING id""", (candidate_id, *expected_review))
                review_id = cursor.fetchone()["id"]; counts["integration_reviews"] += 1
            _record(cursor, batch_id=batch_id, kind="candidate", key=candidate_id,
                    original_id=candidate_id, original_arrival=reconstructed_at,
                    reconstructed_at=reconstructed_at, unknown_fields=[],
                    detail={"packet_id": packet["packet_id"]})
            _record(cursor, batch_id=batch_id, kind="review", key=f"packet:{packet['packet_id']}",
                    original_id=str(review_id), original_arrival=reconstructed_at,
                    reconstructed_at=reconstructed_at, unknown_fields=[],
                    detail={"packet_id": packet["packet_id"],
                            "decision_recorded_at": packet["review"]["recorded_at"]})
    return {"batch_id": batch_id, "projection_sha256": projection_hash,
            "reconstructed_at": reconstructed_at.astimezone(timezone.utc).isoformat(),
            "counts": counts}
