"""Runs against an explicitly supplied disposable Postgres database."""
import os
from datetime import datetime, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from log_pose.core import Capture
from log_pose.storage import ensure_source, evidence, migrate, store


@pytest.fixture
def db():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        migrate(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ingestion_attempts")
            cur.execute("DELETE FROM snapshots")
            cur.execute("DELETE FROM sources")
            cur.execute("DELETE FROM companies")
        conn.commit()
        yield conn
        with conn.cursor() as cur:
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
