"""Runs against an explicitly supplied disposable Postgres database."""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict
from psycopg import sql
from psycopg.rows import dict_row

from log_pose.core import Capture, sha256
from log_pose.market import parse_cboe
from log_pose.storage import (
    ensure_source, evidence, list_companies, migrate, overview, store, store_market_file,
)
from test_market import HEADER, ROW


@pytest.fixture
def db():
    url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        migrate(conn)
        with conn.cursor() as cur:
            cur.execute("""TRUNCATE topology_graph_builds, topology_reviews,
                topology_candidate_evidence, topology_candidates,
                topology_acquisition_jobs, topology_eligibility_reviews,
                topology_entity_aliases, topology_entities, topology_sources CASCADE""")
            cur.execute("DELETE FROM sec_financial_facts")
            cur.execute("DELETE FROM sec_companyfacts")
            cur.execute("DELETE FROM sec_artifacts")
            cur.execute("DELETE FROM market_daily")
            cur.execute("DELETE FROM market_files")
            cur.execute("DELETE FROM ingestion_attempts")
            cur.execute("DELETE FROM snapshots")
            cur.execute("DELETE FROM sources")
            cur.execute("DELETE FROM companies")
        conn.commit()
        yield conn
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sec_financial_facts")
            cur.execute("DELETE FROM sec_companyfacts")
            cur.execute("DELETE FROM sec_artifacts")
            cur.execute("DELETE FROM market_daily")
            cur.execute("DELETE FROM market_files")
            cur.execute("DELETE FROM snapshots")
            cur.execute("DELETE FROM sources")
            cur.execute("DELETE FROM companies")
        conn.commit()


def test_duplicate_capture_and_temporal_query(db):
    source = ensure_source(db, "example", "Example", "https://example.com/", "test")
    assert list_companies(db) == [{"slug": "example", "name": "Example"}]
    before = datetime(2021, 12, 30, tzinfo=timezone.utc)
    after = datetime(2022, 1, 2, tzinfo=timezone.utc)
    first = Capture("https://example.com/", "https://web.archive.org/web/20211230000000id_/https://example.com/", before, b"<body>Old product</body>", "text/html", 200)
    second = Capture("https://example.com/", "https://web.archive.org/web/20220102000000id_/https://example.com/", after, b"<body>New product</body>", "text/html", 200)
    assert store(db, source, first)[0] == "stored"
    assert store(db, source, first)[0] == "duplicate"
    changed_payload = Capture(first.original_url, first.archive_url, first.captured_at, b"<body>Changed archive bytes</body>", "text/html", 200)
    with pytest.raises(ValueError, match="payload changed"):
        store(db, source, changed_payload)
    db.rollback()
    assert store(db, source, second)[0] == "stored"
    with db.cursor() as cur:
        cur.execute("SELECT count(*) FROM snapshots")
        assert cur.fetchone()["count"] == 2
    result = evidence(db, "example", datetime(2021, 12, 31, 23, 59, 59, tzinfo=timezone.utc))
    assert result["sources"][0]["snapshot"]["captured_at"] == before.isoformat()
    assert evidence(db, "example", datetime(2021, 1, 1, tzinfo=timezone.utc))["sources"][0]["status"] == "missing"
    inventory = overview(db)
    assert inventory["totals"]["captures"] == 2
    assert inventory["companies"][0]["coverage"]["2021"]["latest_capture_at"] == before.isoformat()
    assert inventory["companies"][0]["coverage"]["2024"]["latest_capture_at"] == after.isoformat()


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
    database_name = "migration_" + uuid.uuid4().hex
    connection_parameters = conninfo_to_dict(database_url)
    admin_parameters = {**connection_parameters, "dbname": "postgres"}
    test_parameters = {**connection_parameters, "dbname": database_name}
    initial_sql = (Path(__file__).parents[1] / "sql/001_initial.sql").read_text()
    with psycopg.connect(**admin_parameters, autocommit=True) as admin:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    try:
        with psycopg.connect(**test_parameters, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
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
                assert cur.fetchone()["count"] == 12
                cur.execute("SELECT count(*) AS count FROM warehouse.page_observations")
                assert cur.fetchone()["count"] == 1
    finally:
        with psycopg.connect(**admin_parameters, autocommit=True) as admin:
            with admin.cursor() as cur:
                cur.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)")
                            .format(sql.Identifier(database_name)))


def test_warehouse_views_preserve_grain_time_and_provenance(db):
    source_id = ensure_source(db, "warehouse-example", "Warehouse Example",
                              "https://example.com/", "homepage")
    captured_at = datetime(2024, 6, 1, tzinfo=timezone.utc)
    capture = Capture("https://example.com/", "https://web.archive.org/example", captured_at,
                      b"<body>Long enough historical product evidence for the observation view.</body>",
                      "text/html", 200)
    _, snapshot_id = store(db, source_id, capture)

    second_row = ROW.replace("Example Market", "Second Market")
    market_rows = parse_cboe((HEADER + ROW + second_row).encode(), 2022)
    _, file_id = store_market_file(db, 2022, "https://example.com/warehouse.csv",
                                   (HEADER + ROW + second_row).encode(), market_rows)

    artifact_version = "a" * 64
    raw_hash = "b" * 64
    with db.cursor() as cur:
        cur.execute("""INSERT INTO sec_artifacts(artifact_version,source_url,etag,last_modified,
            content_length,observed_at) VALUES (%s,'https://sec.example/archive.zip','etag','date',1,%s)""",
                    (artifact_version, captured_at))
        cur.execute("""INSERT INTO sec_companyfacts(artifact_version,cik,member_name,entity_name,
            raw_json,raw_sha256) VALUES (%s,'0000000001','CIK0000000001.json','Example Inc.',%s,%s)
            RETURNING id""", (artifact_version, b"{}", raw_hash))
        member_id = cur.fetchone()["id"]
        cur.execute("""INSERT INTO sec_financial_facts(companyfacts_id,concept_group,taxonomy,tag,
            unit,fact_index,value,start_date,end_date,filed_date)
            VALUES (%s,'revenue','us-gaap','Revenues','USD',0,100,'2024-01-01','2024-12-31','2025-02-01')
            RETURNING id""", (member_id,))
        fact_id = cur.fetchone()["id"]
    db.commit()

    with db.cursor() as cur:
        cur.execute("""SELECT observation_id, company_slug, source_id, provider,
            captured_at, raw_sha256 FROM warehouse.page_observations""")
        page = cur.fetchone()
        assert page["observation_id"] == snapshot_id
        assert page["company_slug"] == "warehouse-example"
        assert page["captured_at"] == captured_at
        assert page["raw_sha256"] == sha256(capture.raw_html)

        cur.execute("""SELECT file_id, trade_date, participant_rows, total_shares,
            total_notional FROM warehouse.market_daily_totals""")
        market = cur.fetchone()
        assert market["file_id"] == file_id
        assert market["participant_rows"] == 2
        assert market["total_shares"] == 12
        assert market["total_notional"] == 15
        cur.execute("""SELECT sum(participant_rows)::bigint AS rows,
            count(*) AS trading_days FROM warehouse.market_daily_totals
            WHERE file_id=%s""", (file_id,))
        export_summary = cur.fetchone()
        assert json.loads(json.dumps(export_summary)) == {"rows": 2, "trading_days": 1}

        cur.execute("""SELECT fact_id, cik, artifact_version, artifact_source_url,
            start_date, end_date, filed_date, raw_sha256
            FROM warehouse.sec_fact_observations""")
        fact = cur.fetchone()
        assert fact["fact_id"] == fact_id
        assert fact["cik"].strip() == "0000000001"
        assert fact["artifact_version"].strip() == artifact_version
        assert fact["raw_sha256"] == raw_hash
