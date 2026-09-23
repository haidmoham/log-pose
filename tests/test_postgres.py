"""Runs against an explicitly supplied disposable Postgres database."""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.rows import dict_row

from log_pose.core import Capture, sha256
from log_pose.market import parse_cboe
from log_pose.storage import ensure_source, evidence, migrate, store, store_market_file
from test_market import HEADER, ROW


@pytest.fixture
def db():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        migrate(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM market_daily")
            cur.execute("DELETE FROM market_files")
            cur.execute("DELETE FROM ingestion_attempts")
            cur.execute("DELETE FROM snapshots")
            cur.execute("DELETE FROM sources")
            cur.execute("DELETE FROM companies")
        conn.commit()
        yield conn
        with conn.cursor() as cur:
            cur.execute("DELETE FROM market_daily")
            cur.execute("DELETE FROM market_files")
            cur.execute("DELETE FROM snapshots")
            cur.execute("DELETE FROM sources")
            cur.execute("DELETE FROM companies")
        conn.commit()


def test_duplicate_capture_and_temporal_query(db):
    source = ensure_source(db, "example", "Example", "https://example.com/", "test")
    before = datetime(2021, 12, 30, tzinfo=timezone.utc)
    after = datetime(2022, 1, 2, tzinfo=timezone.utc)
    first = Capture("https://example.com/", "https://web.archive.org/web/20211230000000id_/https://example.com/", before, b"<body>Old product</body>", "text/html", 200)
    second = Capture("https://example.com/", "https://web.archive.org/web/20220102000000id_/https://example.com/", after, b"<body>New product</body>", "text/html", 200)
    assert store(db, source, first)[0] == "stored"
    assert store(db, source, first)[0] == "duplicate"
    assert store(db, source, second)[0] == "stored"
    with db.cursor() as cur:
        cur.execute("SELECT count(*) FROM snapshots")
        assert cur.fetchone()["count"] == 2
    result = evidence(db, "example", datetime(2021, 12, 31, 23, 59, 59, tzinfo=timezone.utc))
    assert result["sources"][0]["snapshot"]["captured_at"] == before.isoformat()
    assert evidence(db, "example", datetime(2021, 1, 1, tzinfo=timezone.utc))["sources"][0]["status"] == "missing"


def test_commoncrawl_identity_and_market_file_are_idempotent(db):
    source_id = ensure_source(db, "pilot", "Pilot", "https://example.com/", "homepage")
    captured_at = datetime(2024, 12, 12, tzinfo=timezone.utc)
    capture = Capture("https://example.com/", "https://data.commoncrawl.org/example.warc.gz",
                      captured_at, b"<body>Historical product page</body>", "text/html", 200,
                      "commoncrawl", "example.warc.gz:100:200", {"crawl": "CC-MAIN-2024-51"})
    assert store(db, source_id, capture)[0] == "stored"
    assert store(db, source_id, capture)[0] == "duplicate"
    result = evidence(db, "pilot", datetime(2024, 12, 31, tzinfo=timezone.utc))
    assert result["sources"][0]["snapshot"]["provider"] == "commoncrawl"
    assert result["sources"][0]["snapshot"]["provenance"]["crawl"] == "CC-MAIN-2024-51"
    changed = Capture(capture.original_url, capture.archive_url, captured_at,
                      b"<body>Changed evidence</body>", "text/html", 200,
                      "commoncrawl", capture.provider_record_id, capture.provenance)
    with pytest.raises(ValueError, match="payload changed"):
        store(db, source_id, changed)
    db.rollback()

    raw = (HEADER + ROW).encode()
    rows = parse_cboe(raw, 2022)
    assert store_market_file(db, 2022, "https://example.com/2022.csv", raw, rows)[0] == "stored"
    assert store_market_file(db, 2022, "https://example.com/2022.csv", raw, rows)[0] == "duplicate"
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS count FROM market_daily")
        assert cur.fetchone()["count"] == 1


def test_short_commoncrawl_body_keeps_raw_evidence(db):
    source_id = ensure_source(db, "shell", "Shell", "https://example.com/", "homepage")
    body = b"<html><head><title>Historical product</title></head><body><script>render()</script></body></html>"
    capture = Capture("https://example.com/", "https://data.commoncrawl.org/shell.warc.gz",
                      datetime(2022, 12, 1, tzinfo=timezone.utc), body, "text/html", 200,
                      "commoncrawl", "shell.warc.gz:10:20", {"crawl": "CC-MAIN-2022-49"})
    outcome, snapshot_id = store(db, source_id, capture)
    assert outcome == "stored"
    with db.cursor() as cur:
        cur.execute("SELECT raw_html,normalized_text,text_status FROM snapshots WHERE id=%s", (snapshot_id,))
        stored = cur.fetchone()
    assert bytes(stored["raw_html"]) == body
    assert stored["normalized_text"] == ""
    assert stored["text_status"] == "short"


def test_migration_preserves_existing_wayback_snapshot():
    database_url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    schema_name = "migration_" + uuid.uuid4().hex
    initial_sql = (Path(__file__).parents[1] / "sql/001_initial.sql").read_text()
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))
                cur.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema_name)))
                cur.execute(initial_sql)
                cur.execute("INSERT INTO companies(slug,name) VALUES ('old','Old') RETURNING id")
                company_id = cur.fetchone()["id"]
                cur.execute("INSERT INTO sources(company_id,original_url,purpose) VALUES (%s,'https://example.com/','homepage') RETURNING id", (company_id,))
                source_id = cur.fetchone()["id"]
                raw = b"<body>Historical page</body>"
                archive = "https://web.archive.org/web/20211201000000id_/https://example.com/"
                cur.execute("""INSERT INTO snapshots(source_id,provider,archive_url,captured_at,status_code,
                    content_type,raw_html,raw_sha256,normalized_text,text_sha256,normalizer_version)
                    VALUES (%s,'wayback',%s,'2021-12-01T00:00:00Z',200,'text/html',%s,%s,'Historical page',%s,1)""",
                    (source_id, archive, raw, sha256(raw), sha256("Historical page")))
            conn.commit()
            migrate(conn)
            migrate(conn)
            with conn.cursor() as cur:
                cur.execute("SELECT provider,provider_record_id,raw_sha256 FROM snapshots")
                assert cur.fetchone() == {"provider": "wayback", "provider_record_id": archive,
                                          "raw_sha256": sha256(raw)}
                cur.execute("SELECT count(*) AS count FROM schema_migrations")
                assert cur.fetchone()["count"] == 5
        finally:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema_name)))
            conn.commit()
