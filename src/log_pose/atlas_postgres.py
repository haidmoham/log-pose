"""Publish a validated immutable atlas SQLite snapshot into Postgres gold tables."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from psycopg import sql
from psycopg.rows import tuple_row
from psycopg.types.json import Jsonb

from .atlas_snapshot import validate_snapshot


TABLE_COUNTS = {
    "atlas_candidate": "candidates",
    "atlas_artifact": "artifacts",
    "atlas_placement": "placements",
    "atlas_membership": "memberships",
}


def load_manifest(snapshot_root: Path, build_id: str | None = None) -> dict:
    """Load one manifest; validation later binds it to the immutable SQLite file."""
    path = snapshot_root / (f"{build_id}.json" if build_id else "current.json")
    if not path.is_file():
        raise ValueError("atlas snapshot manifest is missing")
    manifest = json.loads(path.read_bytes())
    if build_id is not None and manifest.get("build_id") != build_id:
        raise ValueError("atlas snapshot manifest has a different build identifier")
    validate_snapshot(snapshot_root, manifest)
    return manifest


def _pages(cursor: sqlite3.Cursor, batch_size: int) -> Iterator[list[tuple]]:
    while rows := cursor.fetchmany(batch_size):
        yield rows


def _copy_rows(pg_cursor, table: str, columns: tuple[str, ...], rows: Iterator[tuple],
               *, temporary: bool = False) -> None:
    target = sql.Identifier(table) if temporary else sql.Identifier("public", table)
    statement = sql.SQL("COPY {} ({}) FROM STDIN").format(
        target,
        sql.SQL(",").join(map(sql.Identifier, columns)),
    )
    with pg_cursor.copy(statement) as copy:
        for row in rows:
            copy.write_row(row)


def _sqlite_rows(database: sqlite3.Connection, query: str, build_id: str,
                 batch_size: int, *, json_columns: tuple[int, ...] = ()) -> Iterator[tuple]:
    cursor = database.execute(query)
    for page in _pages(cursor, batch_size):
        for source_row in page:
            row = [build_id, *source_row]
            for index in json_columns:
                row[index] = Jsonb(json.loads(row[index]))
            yield tuple(row)


def validate_postgres_snapshot(connection, manifest: dict) -> None:
    """Reconcile one stored build without relying on the current pointer."""
    build_id = manifest["build_id"]
    with connection.cursor(row_factory=tuple_row) as cursor:
        cursor.execute("SELECT manifest FROM public.atlas_snapshot WHERE build_id=%s", (build_id,))
        row = cursor.fetchone()
        if row is None or row[0] != manifest:
            raise ValueError("stored atlas manifest differs from immutable manifest")
        for table, count_name in TABLE_COUNTS.items():
            cursor.execute(sql.SQL("SELECT count(*) FROM public.{} WHERE build_id=%s").format(
                sql.Identifier(table)), (build_id,))
            if cursor.fetchone()[0] != manifest["counts"][count_name]:
                raise ValueError(f"stored {table} count differs from immutable manifest")
        cursor.execute("""SELECT count(*) FROM public.atlas_candidate
            WHERE build_id=%s AND search_text IS NOT NULL""", (build_id,))
        if cursor.fetchone()[0] != manifest["counts"]["candidates"]:
            raise ValueError("stored atlas search index differs from candidate count")
        cursor.execute("""SELECT placement.id FROM public.atlas_placement AS placement
            LEFT JOIN (
                SELECT placement_id,count(*) AS member_count
                FROM public.atlas_membership WHERE build_id=%s
                GROUP BY placement_id
            ) AS membership ON membership.placement_id=placement.id
            WHERE placement.build_id=%s
              AND placement.member_count <> coalesce(membership.member_count,0)
            LIMIT 1""", (build_id, build_id))
        if cursor.fetchone() is not None:
            raise ValueError("stored atlas placement member count differs from memberships")
        cursor.execute("""SELECT coalesce(sum(jsonb_array_length(detail_json->'occurrence_ids')),0)
            FROM public.atlas_membership WHERE build_id=%s""", (build_id,))
        if cursor.fetchone()[0] != manifest["counts"]["supporting_occurrences"]:
            raise ValueError("stored atlas occurrence count differs from immutable manifest")


def publish_atlas_snapshot(connection, snapshot_root: Path, *, build_id: str | None = None,
                           batch_size: int = 2_000, publish_current: bool = True) -> dict:
    """Import one immutable snapshot and move the current pointer after validation."""
    if batch_size < 1 or batch_size > 50_000:
        raise ValueError("batch_size must be between 1 and 50000")
    manifest = load_manifest(snapshot_root, build_id)
    build_id = manifest["build_id"]
    database_path = snapshot_root / manifest["database"]

    try:
        with connection.cursor(row_factory=tuple_row) as cursor:
            cursor.execute("SELECT manifest FROM public.atlas_snapshot WHERE build_id=%s FOR UPDATE",
                           (build_id,))
            existing = cursor.fetchone()
            if existing is not None:
                if existing[0] != manifest:
                    raise ValueError("published build ID already has a different manifest")
                validate_postgres_snapshot(connection, manifest)
                status = "existing_immutable_build"
            else:
                cursor.execute("INSERT INTO public.atlas_snapshot(build_id,manifest) VALUES (%s,%s)",
                               (build_id, Jsonb(manifest)))
                database = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
                try:
                    # Candidate search text is staged so Postgres creates its own tsvector.
                    cursor.execute("""CREATE TEMP TABLE atlas_candidate_import(
                        build_id text,id text,name text,summary_json jsonb,search_source text)
                        ON COMMIT DROP""")
                    candidate_rows = _sqlite_rows(database, """SELECT c.id,c.name,c.summary_json,s.text
                        FROM candidate c JOIN candidate_search s ON s.id=c.id ORDER BY c.id""",
                        build_id, batch_size, json_columns=(3,))
                    _copy_rows(cursor, "atlas_candidate_import",
                               ("build_id", "id", "name", "summary_json", "search_source"),
                               candidate_rows, temporary=True)
                    cursor.execute("""INSERT INTO public.atlas_candidate(
                        build_id,id,name,summary_json,search_text)
                        SELECT build_id,id,name,summary_json,to_tsvector('simple',search_source)
                        FROM atlas_candidate_import ORDER BY id""")

                    _copy_rows(cursor, "atlas_artifact",
                               ("build_id", "id", "source", "inventory_year", "raw_sha256", "detail_json"),
                               _sqlite_rows(database, """SELECT id,source,inventory_year,raw_sha256,detail_json
                                   FROM artifact ORDER BY id""", build_id, batch_size, json_columns=(5,)))
                    _copy_rows(cursor, "atlas_placement",
                               ("build_id", "id", "artifact_id", "category", "member_count"),
                               _sqlite_rows(database, """SELECT id,artifact_id,category,member_count
                                   FROM placement ORDER BY id""", build_id, batch_size))
                    _copy_rows(cursor, "atlas_membership",
                               ("build_id", "candidate_id", "placement_id", "detail_json"),
                               _sqlite_rows(database, """SELECT candidate_id,placement_id,detail_json
                                   FROM membership ORDER BY candidate_id,placement_id""",
                                   build_id, batch_size, json_columns=(3,)))
                finally:
                    database.close()
                validate_postgres_snapshot(connection, manifest)
                status = "imported"

            if publish_current:
                cursor.execute("""INSERT INTO public.atlas_current(singleton,build_id)
                    VALUES (true,%s) ON CONFLICT (singleton)
                    DO UPDATE SET build_id=excluded.build_id""", (build_id,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return {"status": status, "build_id": build_id, "counts": manifest["counts"],
            "current": publish_current}
