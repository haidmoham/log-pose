"""Append-only persistence for pinned directory discovery evidence."""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

from log_pose.discovery import parse_inventory_rows, parse_occurrences


def reconcile_source_rows(raw: bytes, artifact: dict, inventory_rows: list[dict],
                          mapped_rows: list[dict]) -> None:
    """Check exported rows against the retained source before any database write."""
    parsed_inventory = parse_inventory_rows(raw, artifact)
    parsed_occurrences, source_count = parse_occurrences(raw, artifact)
    if source_count != artifact["raw_item_count"] or parsed_inventory != inventory_rows:
        raise ValueError(f"inventory rows differ from retained source: {artifact['source']} {artifact['year']}")
    if parsed_occurrences != mapped_rows:
        raise ValueError(f"mapped occurrences differ from retained source: {artifact['source']} {artifact['year']}")


def store_discovery_extension(connection, index: dict, *, repository_root: Path) -> dict[str, int]:
    """Store all pinned raw artifacts, mapped leads, and unmapped directory rows.

    Existing evidence is never updated. A repeated identity must match the
    retained raw source and parsed values exactly or the transaction fails.
    """
    artifacts = index["artifacts"]
    expected_artifacts = {(source, year) for source in ("cncf", "lfai")
                          for year in (2020, 2021, 2022, 2023, 2024, 2025, 2026)}
    if {(item["source"], item["year"]) for item in artifacts} != expected_artifacts:
        raise ValueError("discovery index must contain both sources for 2020–2026")
    rows_by_artifact = {}
    for row in index["inventory_rows"]:
        rows_by_artifact.setdefault(row["artifact_sha256"], []).append(row)
    mapped_by_artifact = {}
    for row in index["occurrences"]:
        mapped_by_artifact.setdefault(row["artifact_sha256"], []).append(row)

    created_artifacts = created_occurrences = created_inventory_rows = 0
    with connection.cursor() as cursor:
        for artifact in artifacts:
            path = repository_root / artifact["artifact_path"]
            raw = path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest != artifact["raw_sha256"]:
                raise ValueError(f"discovery source artifact changed before import: {path}")
            rows = rows_by_artifact.get(digest, [])
            mapped_rows = mapped_by_artifact.get(digest, [])
            if len(rows) != artifact["inventory_row_count"]:
                raise ValueError(f"inventory row count differs from source artifact: {path}")
            if len(mapped_rows) != artifact["mapped_occurrence_count"]:
                raise ValueError(f"mapped occurrence count differs from source artifact: {path}")
            reconcile_source_rows(raw, artifact, rows, mapped_rows)
            committed_at = datetime.fromisoformat(artifact["commit_at"].replace("Z", "+00:00"))
            artifact_values = (
                digest, artifact["source"], artifact["repository"], artifact["year"],
                artifact["commit"], committed_at, artifact["url"],
                artifact["observation_basis"], artifact["coverage_status"], raw,
                1, index["mapping_version"],
            )
            cursor.execute("""INSERT INTO discovery_artifacts(
                    raw_sha256,source,repository,study_year,source_commit,source_committed_at,
                    source_url,observation_basis,coverage_status,raw_yaml,parser_version,mapping_version)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (raw_sha256) DO NOTHING""", artifact_values)
            created_artifacts += cursor.rowcount == 1
            cursor.execute("""SELECT source,repository,study_year,source_commit,source_committed_at,
                    source_url,observation_basis,coverage_status,raw_yaml,parser_version,mapping_version
                FROM discovery_artifacts WHERE raw_sha256=%s""", (digest,))
            existing = cursor.fetchone()
            if tuple(existing.values()) != artifact_values[1:]:
                raise ValueError(f"stored discovery artifact does not match exact source: {path}")

            for row in mapped_rows:
                values = (
                    row["id"], digest, row["source_path"], row["name"], row["description"],
                    row["homepage_url"], row["repo_url"], row["source_category"],
                    row["source_subcategory"], row["candidate_tags"],
                )
                cursor.execute("""INSERT INTO discovery_occurrences(
                        id,artifact_sha256,source_path,name,description,homepage_url,repo_url,
                        source_category,source_subcategory,candidate_tags)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING""", values)
                created_occurrences += cursor.rowcount == 1
                cursor.execute("""SELECT artifact_sha256,source_path,name,description,homepage_url,
                        repo_url,source_category,source_subcategory,candidate_tags
                    FROM discovery_occurrences WHERE id=%s""", (row["id"],))
                stored = cursor.fetchone()
                if tuple(stored.values()) != values[1:]:
                    raise ValueError(f"stored discovery occurrence differs from source row {row['id']}")

            for row in rows:
                values = (
                    row["id"], digest, row["source_path"], row["name"], row["description"],
                    row["homepage_url"], row["repo_url"], row["source_category"],
                    row["source_subcategory"], row["candidate_tags"], row["mapping_status"],
                    row["record_type"],
                )
                cursor.execute("""INSERT INTO discovery_inventory_rows(
                        id,artifact_sha256,source_path,name,description,homepage_url,repo_url,
                        source_category,source_subcategory,candidate_tags,mapping_status,record_type)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING""", values)
                created_inventory_rows += cursor.rowcount == 1
                cursor.execute("""SELECT artifact_sha256,source_path,name,description,homepage_url,
                        repo_url,source_category,source_subcategory,candidate_tags,mapping_status,record_type
                    FROM discovery_inventory_rows WHERE id=%s""", (row["id"],))
                stored = cursor.fetchone()
                if tuple(stored.values()) != values[1:]:
                    raise ValueError(f"stored inventory row differs from source row {row['id']}")

    return {"artifacts_created": int(created_artifacts),
            "mapped_occurrences_created": int(created_occurrences),
            "inventory_rows_created": int(created_inventory_rows)}
