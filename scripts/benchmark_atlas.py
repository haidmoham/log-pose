"""Build bounded synthetic atlas scale fixtures and record raw build receipts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import sqlite3
import time
from pathlib import Path


GENERATOR_VERSION = "atlas-scale-v1"
TIERS = {
    "test": {"candidates": 200, "memberships": 2_000, "revisions": 8, "categories": 16,
             "dense": 100, "seed": 1100},
    "s1": {"candidates": 10_000, "memberships": 1_000_000, "revisions": 32,
           "categories": 64, "dense": 10_000, "seed": 1101},
    "s2": {"candidates": 50_000, "memberships": 5_000_000, "revisions": 64,
           "categories": 128, "dense": 10_000, "seed": 1102},
}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript("""
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        PRAGMA cache_size=-262144;
        PRAGMA page_size=4096;
        CREATE TABLE candidate(id TEXT PRIMARY KEY,name TEXT NOT NULL,summary_json TEXT NOT NULL);
        CREATE VIRTUAL TABLE candidate_search USING fts5(id UNINDEXED,text);
        CREATE TABLE artifact(id TEXT PRIMARY KEY,source TEXT NOT NULL,inventory_year INTEGER NOT NULL,
            raw_sha256 TEXT NOT NULL,detail_json TEXT NOT NULL) WITHOUT ROWID;
        CREATE INDEX artifact_source_year ON artifact(source,inventory_year,id);
        CREATE TABLE placement(id TEXT PRIMARY KEY,artifact_id TEXT NOT NULL REFERENCES artifact(id),
            category TEXT NOT NULL,member_count INTEGER NOT NULL CHECK(member_count>=0)) WITHOUT ROWID;
        CREATE INDEX placement_artifact_category ON placement(artifact_id,category,id);
        CREATE TABLE membership(candidate_id TEXT NOT NULL REFERENCES candidate(id),
            placement_id TEXT NOT NULL REFERENCES placement(id),detail_json TEXT NOT NULL,
            PRIMARY KEY(candidate_id,placement_id)) WITHOUT ROWID;
        CREATE INDEX membership_placement_candidate ON membership(placement_id,candidate_id);
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;
    """)


def fixture_identity(parameters: dict) -> tuple[str, dict]:
    counts = {"artifacts": parameters["revisions"],
              "placements": parameters["revisions"] * parameters["categories"],
              "candidates": parameters["candidates"], "memberships": parameters["memberships"],
              "supporting_occurrences": parameters["memberships"], "input_worklist_pairs": 0}
    logical = {"schema_version": "1.0", "synthetic": True,
               "generator": {"version": GENERATOR_VERSION, **parameters},
               "versions": {"membership": "synthetic-atlas-scale-v1", "query": "atlas-query-v1",
                            "layout": "atlas-address-v1", "snapshot": "synthetic-scale-v1"},
               "clocks": {"inventory": {"field": "inventory_year", "precision": "year"}},
               "counts": counts,
               "input_hashes": {"synthetic_fixture": hashlib.sha256(
                   canonical({"version": GENERATOR_VERSION, **parameters}).encode()).hexdigest()},
               "limitations": ["Synthetic scale fixture; no row describes a real entity or relationship.",
                               "Direct streaming writer does not measure canonical Python exporter memory."]}
    build_id = hashlib.sha256(canonical(logical).encode()).hexdigest()
    return build_id, {**logical, "build_id": build_id}


def build_fixture(output_root: Path, tier: str, *, overwrite: bool = False) -> dict:
    parameters = dict(TIERS[tier])
    build_id, logical = fixture_identity(parameters)
    output_root.mkdir(parents=True, exist_ok=True)
    database_path = output_root / f"{build_id}.sqlite"
    manifest_path = output_root / f"{build_id}.json"
    if database_path.exists() and manifest_path.exists() and not overwrite:
        return {"manifest": json.loads(manifest_path.read_text()), "status": "reused",
                "build_seconds": 0.0, "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024}
    database_path.unlink(missing_ok=True)
    manifest_path.unlink(missing_ok=True)

    started = time.perf_counter()
    connection = sqlite3.connect(database_path)
    create_schema(connection)
    candidate_count = parameters["candidates"]
    membership_count = parameters["memberships"]
    revision_count = parameters["revisions"]
    category_count = parameters["categories"]
    memberships_per_candidate = membership_count // candidate_count
    if memberships_per_candidate * candidate_count != membership_count:
        raise ValueError("membership count must divide evenly across candidates")
    placement_count = revision_count * category_count
    if placement_count <= memberships_per_candidate:
        raise ValueError("fixture needs more placements than memberships per candidate")

    artifacts = []
    for revision in range(revision_count):
        artifact_id = hashlib.sha256(f"synthetic-artifact:{tier}:{revision}".encode()).hexdigest()
        raw_hash = hashlib.sha256(f"synthetic-bytes:{tier}:{revision}".encode()).hexdigest()
        year = 1990 + revision
        detail = {"id": artifact_id, "source": f"synthetic-{tier}", "inventory_year": year,
                  "raw_sha256": raw_hash, "repository": "synthetic/local-scale-fixture",
                  "commit": f"synthetic-revision-{revision:04d}",
                  "coverage_status": "synthetic_scale_fixture",
                  "observation_basis": "generated_for_local_capacity_measurement"}
        artifacts.append((artifact_id, year, raw_hash))
        connection.execute("INSERT INTO artifact VALUES(?,?,?,?,?)",
                           (artifact_id, f"synthetic-{tier}", year, raw_hash, canonical(detail)))

    placements = []
    for placement_index in range(placement_count):
        revision = placement_index % revision_count
        # Squaring produces repeated low-numbered category families while IDs stay exact.
        category_number = ((placement_index // revision_count) ** 2 + revision) % category_count
        category = f"Synthetic category {category_number:04d}"
        placement_id = hashlib.sha256(
            f"synthetic-placement:{tier}:{placement_index}:{artifacts[revision][0]}:{category}".encode()
        ).hexdigest()
        placements.append((placement_id, artifacts[revision][0], category))
        connection.execute("INSERT INTO placement VALUES(?,?,?,0)",
                           (placement_id, artifacts[revision][0], category))

    insert_candidate = connection.cursor()
    insert_search = connection.cursor()
    insert_membership = connection.cursor()
    member_counts = [0] * placement_count
    seed = parameters["seed"]
    for candidate_number in range(candidate_count):
        candidate_id = f"candidate-{candidate_number:06d}"
        name = f"Synthetic Candidate {candidate_number:06d}"
        summary = {"id": candidate_id, "name": name,
                   "description": "Synthetic candidate for local atlas capacity measurement.",
                   "candidate_tags": ["synthetic", f"cohort_{candidate_number % 17:02d}"],
                   "record_type": "synthetic_scale_candidate", "identity_review": None,
                   "evidence_status": "synthetic_not_real_world"}
        insert_candidate.execute("INSERT INTO candidate VALUES(?,?,?)",
                                 (candidate_id, name, canonical(summary)))
        insert_search.execute("INSERT INTO candidate_search(id,text) VALUES(?,?)",
                              (candidate_id, f"{name}\nsynthetic capacity cohort_{candidate_number % 17:02d}"))
        selected = []
        if candidate_number < parameters["dense"]:
            selected.append(0)
        ordinal = 0
        while len(selected) < memberships_per_candidate:
            placement_index = 1 + ((candidate_number * 131 + ordinal * 977 + seed) % (placement_count - 1))
            ordinal += 1
            if placement_index not in selected:
                selected.append(placement_index)
        for placement_index in sorted(selected):
            occurrence_id = f"synthetic-row-{candidate_number:06d}-{placement_index:06d}"
            detail = {"id": f"synthetic-membership-{candidate_number:06d}-{placement_index:06d}",
                      "candidate_id": candidate_id, "placement_id": placements[placement_index][0],
                      "occurrence_ids": [occurrence_id],
                      "rows": [{"id": occurrence_id, "name": name,
                                "description": "Synthetic membership evidence row.",
                                "source_path": [candidate_number, placement_index],
                                "synthetic": True}]}
            insert_membership.execute("INSERT INTO membership VALUES(?,?,?)",
                                      (candidate_id, placements[placement_index][0], canonical(detail)))
            member_counts[placement_index] += 1
        if candidate_number and candidate_number % 1000 == 0:
            connection.commit()

    connection.executemany("UPDATE placement SET member_count=? WHERE id=?",
                           ((count, placements[index][0]) for index, count in enumerate(member_counts)))
    connection.execute("INSERT INTO metadata VALUES('manifest',?)", (canonical(logical),))
    connection.commit()
    connection.execute("ANALYZE")
    connection.commit()
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    actual_memberships = connection.execute("SELECT count(*) FROM membership").fetchone()[0]
    member_mismatch = connection.execute("""SELECT count(*) FROM (
        SELECT p.id FROM placement p LEFT JOIN membership m ON m.placement_id=p.id
        GROUP BY p.id HAVING p.member_count != count(m.candidate_id))""").fetchone()[0]
    query_plans = {
        "focus_members": [list(row) for row in connection.execute(
            "EXPLAIN QUERY PLAN SELECT candidate_id FROM membership WHERE placement_id=? ORDER BY candidate_id",
            (placements[0][0],))],
        "candidate_placements": [list(row) for row in connection.execute(
            "EXPLAIN QUERY PLAN SELECT placement_id FROM membership WHERE candidate_id=? ORDER BY placement_id",
            ("candidate-000000",))],
        "search": [list(row) for row in connection.execute(
            "EXPLAIN QUERY PLAN SELECT id FROM candidate_search WHERE candidate_search MATCH 'Synthetic*' LIMIT 60")],
    }
    page_rows = connection.execute(
        "SELECT name,sum(pgsize) FROM dbstat GROUP BY name ORDER BY name").fetchall()
    connection.close()

    if integrity != "ok" or foreign_keys or actual_memberships != membership_count or member_mismatch:
        raise RuntimeError("synthetic atlas fixture failed integrity reconciliation")
    elapsed = time.perf_counter() - started
    manifest = {**logical, "database": database_path.name,
                "database_sha256": sha256(database_path),
                "database_bytes": database_path.stat().st_size}
    manifest_path.write_text(canonical(manifest) + "\n")
    (output_root / "current.json").write_text(canonical(manifest) + "\n")
    return {"manifest": manifest, "status": "built", "build_seconds": elapsed,
            "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
            "query_plans": query_plans, "index_and_table_bytes": dict(page_rows),
            "dense_placement_members": member_counts[0]}


def environment() -> dict:
    cpu_model = next((line.split(":", 1)[1].strip() for line in
                      Path("/proc/cpuinfo").read_text().splitlines()
                      if line.startswith("model name")), "unknown")
    memory_kib = next((int(line.split()[1]) for line in
                       Path("/proc/meminfo").read_text().splitlines()
                       if line.startswith("MemTotal:")), None)
    return {"platform": platform.platform(), "python": platform.python_version(),
            "sqlite": sqlite3.sqlite_version, "cpu_count": os.cpu_count(),
            "cpu_model": cpu_model, "memory_bytes": memory_kib * 1024 if memory_kib else None,
            "machine": platform.machine()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tier", choices=TIERS, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    result = build_fixture(args.output, args.tier, overwrite=args.overwrite)
    receipt = {"receipt_schema": "atlas-scale-build-v1", "synthetic": True,
               "tier": args.tier, "generator_version": GENERATOR_VERSION,
               "parameters": TIERS[args.tier], "environment": environment(), **result}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"tier": args.tier, "status": result["status"],
                      "build_id": result["manifest"]["build_id"],
                      "database_bytes": result["manifest"]["database_bytes"],
                      "build_seconds": result["build_seconds"]}))


if __name__ == "__main__":
    main()
