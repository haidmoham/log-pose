"""Export and publish immutable SQLite read snapshots for the atlas API."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from .atlas_membership import build_atlas_membership, encode


QUERY_VERSION = "atlas-query-v1"
LAYOUT_VERSION = "atlas-address-v1"
SNAPSHOT_VERSION = "atlas-snapshot-v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _json(value: object) -> str:
    return encode(value).decode("utf-8")


def _logical_manifest(membership: dict) -> dict:
    input_hashes = {**membership["input"], "membership_build_id": membership["build_id"]}
    logical = {
        "schema_version": "1.0",
        "counts": membership["counts"],
        "input_hashes": input_hashes,
        "versions": {"membership": membership["schema_version"], "query": QUERY_VERSION,
                     "layout": LAYOUT_VERSION, "snapshot": SNAPSHOT_VERSION},
        "clocks": {"inventory": {"field": "inventory_year", "precision": "year"},
                   "artifact_revision": {"field": "artifact_id", "precision": "immutable_revision"}},
        "derivation": {"incremental_status": "sqlite_partition_updates_supported",
                       "scope": "full_membership_normalization_then_changed_sqlite_rows",
                       "recovery": "full_rebuild",
                       "canonical_evidence_store": False},
    }
    logical["build_id"] = hashlib.sha256(encode(logical)).hexdigest()
    return logical


def _create_database(path: Path, membership: dict, logical: dict) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript("""
            PRAGMA foreign_keys=ON;
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=FULL;
            PRAGMA page_size=4096;
            CREATE TABLE candidate (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                summary_json TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE candidate_search USING fts5(id UNINDEXED, text);
            CREATE TABLE artifact (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                inventory_year INTEGER NOT NULL,
                raw_sha256 TEXT NOT NULL,
                detail_json TEXT NOT NULL
            ) WITHOUT ROWID;
            CREATE INDEX artifact_source_year ON artifact(source, inventory_year, id);
            CREATE TABLE placement (
                id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL REFERENCES artifact(id),
                category TEXT NOT NULL,
                member_count INTEGER NOT NULL CHECK(member_count >= 0)
            ) WITHOUT ROWID;
            CREATE INDEX placement_artifact_category ON placement(artifact_id, category, id);
            CREATE TABLE membership (
                candidate_id TEXT NOT NULL REFERENCES candidate(id),
                placement_id TEXT NOT NULL REFERENCES placement(id),
                detail_json TEXT NOT NULL,
                PRIMARY KEY(candidate_id, placement_id)
            ) WITHOUT ROWID;
            CREATE INDEX membership_placement_candidate
                ON membership(placement_id, candidate_id);
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) WITHOUT ROWID;
        """)

        placement_categories: dict[int, str] = {}
        for placement_index, placement in enumerate(membership["placements"]):
            placement_categories[placement_index] = placement["source_category"]
        categories_by_candidate: dict[int, list[str]] = {
            candidate_index: sorted({placement_categories[placement_index]
                                     for placement_index in placement_indices})
            for candidate_index, placement_indices in
            enumerate(membership["candidate_placement_indices"])
        }

        for candidate_index, candidate in enumerate(membership["candidates"]):
            summary = _json(candidate)
            connection.execute("INSERT INTO candidate VALUES (?,?,?)",
                               (candidate["id"], candidate["name"], summary))
            search_fields = [candidate.get("name", ""), candidate.get("description", ""),
                             *candidate.get("candidate_tags", []),
                             *categories_by_candidate[candidate_index]]
            connection.execute("INSERT INTO candidate_search(id,text) VALUES (?,?)",
                               (candidate["id"], "\n".join(str(value) for value in search_fields if value)))

        for artifact in membership["artifacts"]:
            connection.execute("INSERT INTO artifact VALUES (?,?,?,?,?)", (
                artifact["id"], artifact["source"], artifact["inventory_year"],
                artifact["raw_sha256"], _json(artifact)))
        for placement_index, placement in enumerate(membership["placements"]):
            artifact_id = membership["artifacts"][placement["artifact_index"]]["id"]
            connection.execute("INSERT INTO placement VALUES (?,?,?,?)", (
                placement["id"], artifact_id, placement["source_category"],
                len(membership["placement_members"][placement_index])))
        for row in membership["memberships"]:
            candidate_id = membership["candidates"][row["candidate_index"]]["id"]
            placement_id = membership["placements"][row["placement_index"]]["id"]
            detail = {"id": row["id"], "candidate_id": candidate_id,
                      "placement_id": placement_id, "occurrence_ids": row["occurrence_ids"],
                      "rows": row["rows"]}
            connection.execute("INSERT INTO membership VALUES (?,?,?)",
                               (candidate_id, placement_id, _json(detail)))
        connection.execute("INSERT INTO metadata VALUES (?,?)", ("manifest", _json(logical)))
        connection.commit()
        connection.execute("VACUUM")
    finally:
        connection.close()


def _candidate_rows(membership: dict) -> list[tuple[str, str, str, str]]:
    placement_categories = {
        placement_index: placement["source_category"]
        for placement_index, placement in enumerate(membership["placements"])
    }
    rows = []
    for candidate_index, candidate in enumerate(membership["candidates"]):
        categories = sorted({placement_categories[placement_index]
                             for placement_index in
                             membership["candidate_placement_indices"][candidate_index]})
        search_fields = [candidate.get("name", ""), candidate.get("description", ""),
                         *candidate.get("candidate_tags", []), *categories]
        rows.append((candidate["id"], candidate["name"], _json(candidate),
                     "\n".join(str(value) for value in search_fields if value)))
    return rows


def _snapshot_rows(membership: dict) -> tuple[dict, dict, dict]:
    artifacts = {artifact["id"]: (artifact["source"], artifact["inventory_year"],
                                  artifact["raw_sha256"], _json(artifact))
                 for artifact in membership["artifacts"]}
    placements = {}
    for placement_index, placement in enumerate(membership["placements"]):
        artifact_id = membership["artifacts"][placement["artifact_index"]]["id"]
        placements[placement["id"]] = (artifact_id, placement["source_category"],
                                        len(membership["placement_members"][placement_index]))
    memberships = {}
    for row in membership["memberships"]:
        candidate_id = membership["candidates"][row["candidate_index"]]["id"]
        placement_id = membership["placements"][row["placement_index"]]["id"]
        detail = {"id": row["id"], "candidate_id": candidate_id,
                  "placement_id": placement_id, "occurrence_ids": row["occurrence_ids"],
                  "rows": row["rows"]}
        memberships[(candidate_id, placement_id)] = _json(detail)
    return artifacts, placements, memberships


def _update_database(path: Path, membership: dict, logical: dict) -> dict:
    """Update changed serving rows after the complete membership model is normalized."""
    artifacts, placements, memberships = _snapshot_rows(membership)
    candidates = _candidate_rows(membership)
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        existing_memberships = {(row[0], row[1]): row[2] for row in connection.execute(
            "SELECT candidate_id,placement_id,detail_json FROM membership")}
        removed_memberships = existing_memberships.keys() - memberships.keys()
        changed_memberships = {key for key, detail in memberships.items()
                               if existing_memberships.get(key) != detail}
        connection.executemany("DELETE FROM membership WHERE candidate_id=? AND placement_id=?",
                               sorted(removed_memberships))
        connection.executemany("""INSERT INTO membership(candidate_id,placement_id,detail_json)
            VALUES(?,?,?) ON CONFLICT(candidate_id,placement_id)
            DO UPDATE SET detail_json=excluded.detail_json""",
            ((candidate_id, placement_id, memberships[(candidate_id, placement_id)])
             for candidate_id, placement_id in sorted(changed_memberships)))

        existing_placements = {row[0]: row[1:] for row in connection.execute(
            "SELECT id,artifact_id,category,member_count FROM placement")}
        removed_placements = existing_placements.keys() - placements.keys()
        changed_placements = {identifier for identifier, row in placements.items()
                              if existing_placements.get(identifier) != row}
        connection.executemany("DELETE FROM placement WHERE id=?",
                               ((identifier,) for identifier in sorted(removed_placements)))
        connection.executemany("""INSERT INTO placement(id,artifact_id,category,member_count)
            VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET artifact_id=excluded.artifact_id,
            category=excluded.category,member_count=excluded.member_count""",
            ((identifier, *placements[identifier]) for identifier in sorted(changed_placements)))

        existing_artifacts = {row[0]: row[1:] for row in connection.execute(
            "SELECT id,source,inventory_year,raw_sha256,detail_json FROM artifact")}
        removed_artifacts = existing_artifacts.keys() - artifacts.keys()
        changed_artifacts = {identifier for identifier, row in artifacts.items()
                             if existing_artifacts.get(identifier) != row}
        connection.executemany("DELETE FROM artifact WHERE id=?",
                               ((identifier,) for identifier in sorted(removed_artifacts)))
        connection.executemany("""INSERT INTO artifact(id,source,inventory_year,raw_sha256,detail_json)
            VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,
            inventory_year=excluded.inventory_year,raw_sha256=excluded.raw_sha256,
            detail_json=excluded.detail_json""",
            ((identifier, *artifacts[identifier]) for identifier in sorted(changed_artifacts)))

        # Rebuilding these small tables gives candidate and FTS rows identical,
        # sorted rowids even when the candidate ID set changes.
        connection.execute("DELETE FROM candidate_search")
        connection.execute("DELETE FROM candidate")
        connection.executemany("INSERT INTO candidate(id,name,summary_json) VALUES(?,?,?)",
                               ((identifier, name, summary) for identifier, name, summary, _ in candidates))
        connection.executemany("INSERT INTO candidate_search(id,text) VALUES(?,?)",
                               ((identifier, search) for identifier, _, _, search in candidates))
        connection.execute("UPDATE metadata SET value=? WHERE key='manifest'", (_json(logical),))
        connection.commit()
        connection.execute("PRAGMA foreign_keys=ON")
        return {"memberships_removed": len(removed_memberships),
                "memberships_changed": len(changed_memberships),
                "placements_removed": len(removed_placements),
                "placements_changed": len(changed_placements),
                "artifacts_removed": len(removed_artifacts),
                "artifacts_changed": len(changed_artifacts),
                "candidates_rebuilt": len(candidates)}
    finally:
        connection.close()


def validate_database(path: Path, logical: dict) -> None:
    """Validate one SQLite derivative against its logical manifest."""
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        if integrity != [("ok",)]:
            raise ValueError("atlas snapshot failed SQLite integrity check")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("atlas snapshot has foreign key violations")
        stored_row = connection.execute(
            "SELECT value FROM metadata WHERE key='manifest'").fetchone()
        if stored_row is None or json.loads(stored_row[0]) != logical:
            raise ValueError("atlas snapshot metadata differs from its logical manifest")
        expected = logical["counts"]
        table_counts = {
            "artifacts": connection.execute("SELECT count(*) FROM artifact").fetchone()[0],
            "placements": connection.execute("SELECT count(*) FROM placement").fetchone()[0],
            "candidates": connection.execute("SELECT count(*) FROM candidate").fetchone()[0],
            "memberships": connection.execute("SELECT count(*) FROM membership").fetchone()[0],
        }
        if any(expected[name] != value for name, value in table_counts.items()):
            raise ValueError("atlas snapshot table counts differ from membership counts")
        fts_count = connection.execute("SELECT count(*) FROM candidate_search").fetchone()[0]
        if fts_count != expected["candidates"]:
            raise ValueError("atlas snapshot search index differs from candidate count")
        rowid_mismatch = connection.execute("""
            SELECT c.id FROM candidate c JOIN candidate_search s ON s.id=c.id
            WHERE c.rowid != s.rowid LIMIT 1
        """).fetchone()
        if rowid_mismatch:
            raise ValueError("atlas snapshot search row IDs differ from candidate cursor rows")
        mismatch = connection.execute("""
            SELECT p.id FROM placement p LEFT JOIN membership m ON m.placement_id=p.id
            GROUP BY p.id HAVING p.member_count != count(m.candidate_id) LIMIT 1
        """).fetchone()
        if mismatch:
            raise ValueError("atlas snapshot placement member count differs from memberships")
        occurrence_count = 0
        for (detail_json,) in connection.execute("SELECT detail_json FROM membership"):
            detail = json.loads(detail_json)
            if sorted(row["id"] for row in detail["rows"]) != detail["occurrence_ids"]:
                raise ValueError("atlas snapshot membership rows differ from occurrence identifiers")
            occurrence_count += len(detail["occurrence_ids"])
        if occurrence_count != expected["supporting_occurrences"]:
            raise ValueError("atlas snapshot supporting occurrence count differs")
    finally:
        connection.close()


def validate_snapshot(output_root: Path, manifest: dict) -> None:
    """Validate an immutable manifest, checksum, and its SQLite database."""
    required_database = f"{manifest['build_id']}.sqlite"
    if manifest.get("database") != required_database:
        raise ValueError("atlas snapshot database name differs from build identifier")
    database_path = output_root / required_database
    if not database_path.is_file():
        raise ValueError("atlas snapshot database is missing")
    if database_path.stat().st_size != manifest.get("database_bytes"):
        raise ValueError("atlas snapshot database byte count differs")
    if _sha256(database_path) != manifest.get("database_sha256"):
        raise ValueError("atlas snapshot database checksum differs")
    logical = {key: manifest[key] for key in (
        "schema_version", "counts", "input_hashes", "versions", "clocks", "derivation", "build_id")}
    without_id = {key: value for key, value in logical.items() if key != "build_id"}
    if hashlib.sha256(encode(without_id)).hexdigest() != logical["build_id"]:
        raise ValueError("atlas snapshot build identifier differs from logical content")
    validate_database(database_path, logical)


def _atomic_json(path: Path, value: dict) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp",
                                                  dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "wb") as target:
            target.write(encode(value) + b"\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def publish_current(output_root: Path, manifest: dict) -> None:
    """Atomically point current.json at an already validated immutable snapshot."""
    validate_snapshot(output_root, manifest)
    _atomic_json(output_root / "current.json", manifest)


def rollback_snapshot(output_root: Path, build_id: str) -> dict:
    """Validate and atomically restore an earlier immutable manifest pointer."""
    manifest_path = output_root / f"{build_id}.json"
    if not manifest_path.is_file():
        raise ValueError("requested atlas snapshot manifest is missing")
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("build_id") != build_id:
        raise ValueError("requested atlas snapshot manifest has a different build identifier")
    publish_current(output_root, manifest)
    return manifest


def build_atlas_snapshot(projection: dict, output_root: Path, *, publish: bool = True,
                         incremental_from: str | None = None) -> tuple[dict, str]:
    """Build, validate, and optionally publish one immutable atlas snapshot."""
    output_root.mkdir(parents=True, exist_ok=True)
    membership = build_atlas_membership(projection)
    logical = _logical_manifest(membership)
    build_id = logical["build_id"]
    database_path = output_root / f"{build_id}.sqlite"
    manifest_path = output_root / f"{build_id}.json"

    if database_path.exists() and manifest_path.exists():
        manifest = json.loads(manifest_path.read_bytes())
        validate_snapshot(output_root, manifest)
        if manifest["build_id"] != build_id:
            raise ValueError("existing atlas snapshot does not match requested logical build")
        if publish:
            publish_current(output_root, manifest)
        return manifest, "reused_immutable_snapshot"
    if database_path.exists() or manifest_path.exists():
        raise ValueError("partial immutable atlas snapshot already exists")

    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{build_id}.", suffix=".sqlite.tmp",
                                                  dir=output_root)
    os.close(descriptor)
    temporary_database = Path(temporary_name)
    temporary_database.unlink()
    try:
        if incremental_from:
            prior_manifest_path = output_root / f"{incremental_from}.json"
            if not prior_manifest_path.is_file():
                raise ValueError("incremental source manifest is missing")
            prior_manifest = json.loads(prior_manifest_path.read_bytes())
            if prior_manifest.get("build_id") != incremental_from:
                raise ValueError("incremental source manifest has a different build identifier")
            validate_snapshot(output_root, prior_manifest)
            shutil.copy2(output_root / prior_manifest["database"], temporary_database)
            _update_database(temporary_database, membership, logical)
            status = "incremental_update"
        else:
            _create_database(temporary_database, membership, logical)
            status = "full_rebuild"
        validate_database(temporary_database, logical)
        os.replace(temporary_database, database_path)
        manifest = {**logical, "database": database_path.name,
                    "database_sha256": _sha256(database_path),
                    "database_bytes": database_path.stat().st_size}
        validate_snapshot(output_root, manifest)
        _atomic_json(manifest_path, manifest)
        if publish:
            publish_current(output_root, manifest)
        return manifest, status
    except Exception:
        # A database without its immutable manifest was never published and
        # would otherwise block a clean retry of this exact logical build.
        if not manifest_path.exists():
            database_path.unlink(missing_ok=True)
        raise
    finally:
        temporary_database.unlink(missing_ok=True)
