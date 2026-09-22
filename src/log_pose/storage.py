import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .core import Capture, normalize, sha256


def connect():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def migrate(conn):
    with conn.cursor() as cur:
        cur.execute((Path(__file__).parents[2] / "sql/001_initial.sql").read_text())
    conn.commit()


def ensure_source(conn, slug: str, name: str, url: str, purpose: str) -> int:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO companies(slug,name) VALUES (%s,%s) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id", (slug, name))
        company_id = cur.fetchone()["id"]
        cur.execute("INSERT INTO sources(company_id,original_url,purpose) VALUES (%s,%s,%s) ON CONFLICT (company_id,original_url) DO UPDATE SET purpose=EXCLUDED.purpose RETURNING id", (company_id, url, purpose))
        source_id = cur.fetchone()["id"]
    conn.commit()
    return source_id


def start_attempt(conn, source_id: int, cutoff: datetime, timestamp: str) -> int:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO ingestion_attempts(source_id,target_cutoff,requested_capture) VALUES (%s,%s,%s) RETURNING id", (source_id, cutoff, timestamp))
        result = cur.fetchone()["id"]
    conn.commit()
    return result


def finish_attempt(conn, attempt_id: int, outcome: str, detail: str | None = None, resolved_url: str | None = None):
    with conn.cursor() as cur:
        cur.execute("UPDATE ingestion_attempts SET finished_at=now(),outcome=%s,detail=%s,resolved_archive_url=%s WHERE id=%s", (outcome, detail, resolved_url, attempt_id))
    conn.commit()


def store(conn, source_id: int, capture: Capture) -> tuple[str, int]:
    text = normalize(capture.raw_html)
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO snapshots(source_id,provider,archive_url,captured_at,status_code,content_type,raw_html,raw_sha256,normalized_text,text_sha256,normalizer_version)
            VALUES (%s,'wayback',%s,%s,%s,%s,%s,%s,%s,%s,1)
            ON CONFLICT (source_id,provider,captured_at) DO NOTHING RETURNING id""",
            (source_id,capture.archive_url,capture.captured_at,capture.status_code,capture.content_type,capture.raw_html,sha256(capture.raw_html),text,sha256(text)))
        row = cur.fetchone()
        if row:
            result = ("stored", row["id"])
        else:
            cur.execute("SELECT id,raw_sha256 FROM snapshots WHERE source_id=%s AND provider='wayback' AND captured_at=%s", (source_id,capture.captured_at))
            existing = cur.fetchone()
            if existing["raw_sha256"] != sha256(capture.raw_html):
                raise ValueError("archive capture payload changed; existing evidence preserved")
            result = ("duplicate", existing["id"])
    conn.commit()
    return result


def evidence(conn, slug: str, cutoff: datetime) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT id,name FROM companies WHERE slug=%s", (slug,))
        company = cur.fetchone()
        if company is None:
            raise KeyError(slug)
        cur.execute("""SELECT s.id,s.original_url,s.purpose, p.id AS snapshot_id,p.archive_url,p.captured_at,p.ingested_at,p.raw_sha256,p.text_sha256,p.normalized_text
            FROM sources s LEFT JOIN LATERAL (
                SELECT * FROM snapshots WHERE source_id=s.id AND captured_at<=%s ORDER BY captured_at DESC,id DESC LIMIT 1
            ) p ON true WHERE s.company_id=%s ORDER BY s.id""", (cutoff, company["id"]))
        sources = cur.fetchall()
    return {"company":slug,"name":company["name"],"cutoff":cutoff.isoformat(),"sources":[{
        "original_url":s["original_url"],"purpose":s["purpose"],
        "status":"available" if s["snapshot_id"] else "missing",
        "snapshot":({k:(v.astimezone(timezone.utc).isoformat() if isinstance(v,datetime) else v) for k,v in s.items() if k in ("snapshot_id","archive_url","captured_at","ingested_at","raw_sha256","text_sha256","normalized_text")}) if s["snapshot_id"] else None
    } for s in sources]}
