"""Build an immutable SQLite derivative of accepted reviewed topology claims."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path

from .atlas_membership import encode
from .topology_export import validate_projected_topology

SNAPSHOT_VERSION = "atlas-reviewed-snapshot-v1"
QUERY_VERSION = "atlas-reviewed-query-v1"
LAYOUT_VERSION = "atlas-reviewed-address-v1"
REVIEW_LENS = "current_accepted_at_build"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _text(value: object) -> str:
    return encode(value).decode("utf-8")


def _verify_retained_sources(root: Path, topology: dict) -> None:
    manifest_path = root / "docs/research/topology-source-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    expected = {row["expected_sha256"]: row for row in manifest}
    for row in manifest:
        path = root / row["artifact_path"]
        if _sha256(path) != row["expected_sha256"]:
            raise ValueError(f"retained topology source hash differs: {row['id']}")
    for claim in topology["claims"]:
        for source in claim["sources"]:
            if source["artifact_sha256"] not in expected:
                raise ValueError(f"claim source is absent from retained manifest: {source['id']}")


def _logical(topology_path: Path, discovery_path: Path, topology: dict,
             entities: list[dict], links: list[dict]) -> dict:
    logical = {
        "schema_version": "1.0",
        "versions": {"snapshot": SNAPSHOT_VERSION, "query": QUERY_VERSION,
                     "layout": LAYOUT_VERSION, "topology": topology["schema_version"]},
        "input_hashes": {"topology_export_sha256": _sha256(topology_path),
                         "identity_projection_sha256": _sha256(discovery_path)},
        "input_builds": {"topology_projection": topology.get("projection"),
                         "identity_build_id": json.loads(discovery_path.read_text())["build_id"]},
        "review_lens": REVIEW_LENS,
        "clocks": {"query": {"clock": "source_publication",
                              "temporal_mode": "published_through",
                              "precision": "day"},
                   "review": {"field": "reviewed_at", "runtime_cutoff": False}},
        "counts": {"entities": len(entities), "candidate_links": len(links),
                   "claims": len(topology["claims"]),
                   "sources": sum(len(row["sources"]) for row in topology["claims"]),
                   "reviews": len(topology.get("review_history", []))},
        "derivation": {"canonical_evidence_store": False,
                       "claim_grain": "one scoped accepted claim",
                       "identity_grain": "one explicit reviewed candidate-to-entity link"},
    }
    logical["build_id"] = hashlib.sha256(encode(logical)).hexdigest()
    return logical


def _create_database(path: Path, topology: dict, entities: list[dict], links: list[dict],
                     logical: dict) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript("""
            PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
            CREATE TABLE entity(id TEXT PRIMARY KEY,name TEXT NOT NULL,target_kind TEXT NOT NULL,
                detail_json TEXT NOT NULL) WITHOUT ROWID;
            CREATE INDEX entity_name ON entity(name COLLATE NOCASE,id);
            CREATE TABLE candidate_link(candidate_id TEXT PRIMARY KEY,entity_id TEXT NOT NULL
                REFERENCES entity(id),identity_review_id TEXT NOT NULL,detail_json TEXT NOT NULL)
                WITHOUT ROWID;
            CREATE INDEX candidate_link_entity ON candidate_link(entity_id,candidate_id);
            CREATE TABLE claim(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES entity(id),
                object_id TEXT NOT NULL REFERENCES entity(id),predicate TEXT NOT NULL,
                direction TEXT NOT NULL,status TEXT NOT NULL,latest_source_date TEXT NOT NULL,
                detail_json TEXT NOT NULL) WITHOUT ROWID;
            CREATE INDEX claim_subject ON claim(subject_id,latest_source_date,id);
            CREATE INDEX claim_object ON claim(object_id,latest_source_date,id);
            CREATE INDEX claim_filters ON claim(status,predicate,latest_source_date,id);
            CREATE TABLE claim_source(claim_id TEXT NOT NULL REFERENCES claim(id),ordinal INTEGER NOT NULL,
                source_id TEXT NOT NULL,source_date TEXT NOT NULL,role TEXT NOT NULL,detail_json TEXT NOT NULL,
                PRIMARY KEY(claim_id,ordinal)) WITHOUT ROWID;
            CREATE TABLE review_history(claim_id TEXT NOT NULL REFERENCES claim(id),ordinal INTEGER NOT NULL,
                detail_json TEXT NOT NULL,PRIMARY KEY(claim_id,ordinal)) WITHOUT ROWID;
            CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;
        """)
        for entity in entities:
            connection.execute("INSERT INTO entity VALUES(?,?,?,?)",
                (entity["slug"], entity["name"], entity["target_kind"], _text(entity)))
        for link in links:
            connection.execute("INSERT INTO candidate_link VALUES(?,?,?,?)",
                (link["candidate_id"], link["entity_slug"], link["identity_review_id"], _text(link)))
        history = {}
        for row in topology.get("review_history", []):
            history.setdefault(row["candidate_id"], []).append(row)
        for claim in sorted(topology["claims"], key=lambda item: item["id"]):
            latest = max(source["source_date"] for source in claim["sources"])
            connection.execute("INSERT INTO claim VALUES(?,?,?,?,?,?,?,?)", (claim["id"],
                claim["subject_slug"], claim["object_slug"], claim["predicate"], claim["direction"],
                claim["claim_status"], latest, _text(claim)))
            for ordinal, source in enumerate(claim["sources"]):
                connection.execute("INSERT INTO claim_source VALUES(?,?,?,?,?,?)", (claim["id"], ordinal,
                    source["id"], source["source_date"], source.get("role", "support"), _text(source)))
            for ordinal, review in enumerate(history.get(claim["database_id"], [])):
                connection.execute("INSERT INTO review_history VALUES(?,?,?)",
                                   (claim["id"], ordinal, _text(review)))
        connection.execute("INSERT INTO metadata VALUES('manifest',?)", (_text(logical),))
        connection.commit()
        connection.execute("VACUUM")
    finally:
        connection.close()


def validate_snapshot(database_path: Path, logical: dict) -> None:
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("reviewed snapshot failed SQLite integrity check")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("reviewed snapshot has foreign key violations")
        stored = connection.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()
        if stored is None or json.loads(stored[0]) != logical:
            raise ValueError("reviewed snapshot manifest differs")
        for table, key in (("entity", "entities"), ("candidate_link", "candidate_links"),
                           ("claim", "claims"), ("claim_source", "sources"),
                           ("review_history", "reviews")):
            if connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] != logical["counts"][key]:
                raise ValueError(f"reviewed snapshot {table} count differs")
        bad = connection.execute("""SELECT 1 FROM claim
            WHERE latest_source_date<>(SELECT max(source_date) FROM claim_source
                WHERE claim_id=claim.id) LIMIT 1""").fetchone()
        if bad:
            raise ValueError("reviewed snapshot source cutoff reconciliation differs")
    finally:
        connection.close()


def build_atlas_reviewed(repository_root: Path, output_root: Path) -> dict:
    topology_path = repository_root / "web/data/index.json"
    discovery_path = repository_root / "web/data/topology-discovery.json"
    index = json.loads(topology_path.read_text())
    topology = index["topology"]
    cohort = [{"slug": row["slug"], "name": row["name"], "category": row["category"]}
              for row in topology["entities"]]
    validate_projected_topology(topology, cohort)
    _verify_retained_sources(repository_root, topology)
    discovery = json.loads(discovery_path.read_text())
    entity_ids = {row["slug"] for row in topology["entities"]}
    links = []
    for node in discovery["nodes"]:
        review = node.get("identity_review")
        if review and review.get("pilot_slug") in entity_ids:
            links.append({"candidate_id": node["candidate_id"], "entity_slug": review["pilot_slug"],
                          "identity_review_id": review["id"], "provider_relation": review["provider_relation"]})
    links.sort(key=lambda row: row["candidate_id"])
    mapped = {row["entity_slug"] for row in links}
    entities = [dict(row, target_kind=("reviewed_mapped_entity" if row["slug"] in mapped
                                      else "reviewed_external_entity"))
                for row in sorted(topology["entities"], key=lambda item: item["slug"])]
    logical = _logical(topology_path, discovery_path, topology, entities, links)
    output_root.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output_root, prefix=".reviewed-", suffix=".sqlite",
                                     delete=False) as temporary:
        stage = Path(temporary.name)
    try:
        _create_database(stage, topology, entities, links, logical)
        validate_snapshot(stage, logical)
        database_name = f"{logical['build_id']}.sqlite"
        final_database = output_root / database_name
        if final_database.exists():
            stage.unlink()
        else:
            os.replace(stage, final_database)
        final_database.chmod(0o644)
        manifest = dict(logical, database=database_name,
                        database_sha256=_sha256(final_database),
                        database_bytes=final_database.stat().st_size)
        payload = encode(manifest)
        immutable = output_root / f"{logical['build_id']}.json"
        if immutable.exists() and immutable.read_bytes() != payload:
            raise ValueError("immutable reviewed manifest differs")
        with tempfile.NamedTemporaryFile(dir=output_root, prefix=".manifest-", delete=False) as staged_manifest:
            staged_manifest.write(payload); staged_manifest.flush(); os.fsync(staged_manifest.fileno())
            staged_manifest_path = Path(staged_manifest.name)
        os.replace(staged_manifest_path, immutable)
        immutable.chmod(0o644)
        with tempfile.NamedTemporaryFile(dir=output_root, prefix=".current-", delete=False) as pointer:
            pointer.write(payload); pointer.flush(); os.fsync(pointer.fileno()); pointer_path = Path(pointer.name)
        os.replace(pointer_path, output_root / "current.json")
        (output_root / "current.json").chmod(0o644)
        return manifest
    finally:
        stage.unlink(missing_ok=True)


def check_current(output_root: Path) -> dict:
    manifest = json.loads((output_root / "current.json").read_text())
    database = output_root / manifest["database"]
    if database.stat().st_size != manifest["database_bytes"] or _sha256(database) != manifest["database_sha256"]:
        raise ValueError("reviewed snapshot database bytes differ")
    logical = {key: value for key, value in manifest.items()
               if key not in {"database", "database_sha256", "database_bytes"}}
    validate_snapshot(database, logical)
    return manifest
