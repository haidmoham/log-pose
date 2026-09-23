import os
import json
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .core import Capture, normalize, sha256
from .market import NUMBER_FIELDS
from .sec_bulk import ArtifactMetadata, CompanyFactsMember


def connect():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def migrate(conn):
    migration_dir = Path(__file__).parents[2] / "sql"
    with conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
            version text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )""")
        for path in sorted(migration_dir.glob("[0-9][0-9][0-9]_*.sql")):
            cur.execute("SELECT 1 FROM schema_migrations WHERE version=%s", (path.name,))
            if cur.fetchone():
                continue
            cur.execute(path.read_text())
            cur.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (path.name,))
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


def finish_attempt(conn, attempt_id: int, outcome: str, detail: str | None = None,
                   resolved_url: str | None = None, *, index_attempts: int | None = None,
                   index_rows: int | None = None, compressed_bytes: int | None = None,
                   elapsed_ms: int | None = None):
    with conn.cursor() as cur:
        cur.execute("""UPDATE ingestion_attempts SET finished_at=now(),outcome=%s,detail=%s,
            resolved_archive_url=%s,index_attempts=%s,index_rows=%s,compressed_bytes=%s,elapsed_ms=%s
            WHERE id=%s""",
            (outcome, detail, resolved_url, index_attempts, index_rows, compressed_bytes, elapsed_ms, attempt_id))
    conn.commit()


def store(conn, source_id: int, capture: Capture) -> tuple[str, int]:
    text = normalize(capture.raw_html)
    text_status = "extractable" if len(text) >= 100 else "short"
    raw_hash = sha256(capture.raw_html)
    record_id = capture.provider_record_id or capture.archive_url
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO snapshots(source_id,provider,archive_url,captured_at,status_code,content_type,raw_html,raw_sha256,normalized_text,text_sha256,normalizer_version,provider_record_id,provenance,text_status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s,%s)
            ON CONFLICT (provider,provider_record_id) DO NOTHING RETURNING id""",
            (source_id,capture.provider,capture.archive_url,capture.captured_at,capture.status_code,capture.content_type,capture.raw_html,raw_hash,text,sha256(text),record_id,json.dumps(capture.provenance),text_status))
        row = cur.fetchone()
        if row:
            result = ("stored", row["id"])
        else:
            cur.execute("""SELECT id,source_id,captured_at,archive_url,raw_sha256
                FROM snapshots WHERE provider=%s AND provider_record_id=%s""", (capture.provider,record_id))
            existing = cur.fetchone()
            if (existing["raw_sha256"] != raw_hash or existing["source_id"] != source_id
                    or existing["captured_at"] != capture.captured_at
                    or existing["archive_url"] != capture.archive_url):
                raise ValueError("archive capture payload changed; existing evidence preserved")
            result = ("duplicate", existing["id"])
    conn.commit()
    return result


def store_market_file(conn, year: int, url: str, raw: bytes, rows: list[dict]) -> tuple[str, int]:
    digest = sha256(raw)
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO market_files(provider,source_url,study_year,raw_csv,raw_sha256,parser_version)
            VALUES ('cboe',%s,%s,%s,%s,1)
            ON CONFLICT (provider,source_url,raw_sha256) DO NOTHING RETURNING id""",
            (url, year, raw, digest))
        inserted = cur.fetchone()
        if inserted is None:
            cur.execute("SELECT id FROM market_files WHERE provider='cboe' AND source_url=%s AND raw_sha256=%s", (url, digest))
            file_id = cur.fetchone()["id"]
            cur.execute("SELECT count(*) AS rows FROM market_daily WHERE file_id=%s", (file_id,))
            if cur.fetchone()["rows"] != len(rows):
                raise ValueError("stored market file has an incomplete row set")
            return "duplicate", file_id

        file_id = inserted["id"]
        columns = ("tape_a_shares", "tape_b_shares", "tape_c_shares", "total_shares",
                   "tape_a_notional", "tape_b_notional", "tape_c_notional", "total_notional",
                   "tape_a_trade_count", "tape_b_trade_count", "tape_c_trade_count", "total_trade_count")
        sql = "INSERT INTO market_daily(file_id,row_number,trade_date,market_participant," + ",".join(columns) + ") VALUES (" + ",".join(["%s"] * (4 + len(columns))) + ")"
        values = [
            (file_id, row["row_number"], row["trade_date"], row["market_participant"],
             *(row[field] for field in NUMBER_FIELDS))
            for row in rows
        ]
        cur.executemany(sql, values)
    conn.commit()
    return "stored", file_id


def store_sec_companyfacts(conn, artifact: ArtifactMetadata,
                           member: CompanyFactsMember) -> tuple[str, int]:
    """Store one exact ZIP member and its selected facts without overwriting evidence."""
    inserted_member = False
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO sec_artifacts(
                artifact_version,source_url,etag,last_modified,content_length,observed_at)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (artifact_version) DO NOTHING""",
            (artifact.artifact_version, artifact.source_url, artifact.etag,
             artifact.last_modified, artifact.content_length, artifact.observed_at))
        cur.execute("""SELECT source_url,etag,last_modified,content_length
            FROM sec_artifacts WHERE artifact_version=%s""", (artifact.artifact_version,))
        stored_artifact = cur.fetchone()
        expected_artifact = {
            "source_url": artifact.source_url,
            "etag": artifact.etag,
            "last_modified": artifact.last_modified,
            "content_length": artifact.content_length,
        }
        if stored_artifact != expected_artifact:
            raise ValueError("SEC artifact version metadata does not match stored provenance")

        cur.execute("""INSERT INTO sec_companyfacts(
                artifact_version,cik,member_name,entity_name,raw_json,raw_sha256)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (artifact_version,cik) DO NOTHING RETURNING id""",
            (artifact.artifact_version, member.cik, member.member_name,
             member.entity_name, member.raw_json, member.raw_sha256))
        inserted = cur.fetchone()
        if inserted:
            companyfacts_id = inserted["id"]
            inserted_member = True
        else:
            cur.execute("""SELECT id,member_name,entity_name,raw_sha256
                FROM sec_companyfacts WHERE artifact_version=%s AND cik=%s""",
                (artifact.artifact_version, member.cik))
            existing = cur.fetchone()
            if (existing["member_name"] != member.member_name
                    or existing["entity_name"] != member.entity_name
                    or existing["raw_sha256"] != member.raw_sha256):
                raise ValueError("SEC companyfacts member changed; existing evidence preserved")
            companyfacts_id = existing["id"]

        insert_fact_sql = """INSERT INTO sec_financial_facts(
                companyfacts_id,concept_group,taxonomy,tag,unit,fact_index,value,
                start_date,end_date,filed_date,accession_number,form,fy,fp,frame)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (companyfacts_id,taxonomy,tag,unit,fact_index) DO NOTHING"""
        fact_values = [(
            companyfacts_id, fact["concept_group"], fact["taxonomy"], fact["tag"],
            fact["unit"], fact["fact_index"], fact["value"], fact["start_date"],
            fact["end_date"], fact["filed_date"], fact["accession_number"],
            fact["form"], fact["fy"], fact["fp"], fact["frame"],
        ) for fact in member.facts]
        if fact_values:
            cur.executemany(insert_fact_sql, fact_values)

        cur.execute("""SELECT concept_group,taxonomy,tag,unit,fact_index,value,
                start_date,end_date,filed_date,accession_number,form,fy,fp,frame
            FROM sec_financial_facts WHERE companyfacts_id=%s""", (companyfacts_id,))
        stored_facts = {
            (row["taxonomy"], row["tag"], row["unit"], row["fact_index"]): row
            for row in cur.fetchall()
        }
        expected_facts = {
            (fact["taxonomy"], fact["tag"], fact["unit"], fact["fact_index"]): {
                "concept_group": fact["concept_group"],
                "taxonomy": fact["taxonomy"], "tag": fact["tag"],
                "unit": fact["unit"], "fact_index": fact["fact_index"],
                "value": fact["value"], "start_date": fact["start_date"],
                "end_date": fact["end_date"], "filed_date": fact["filed_date"],
                "accession_number": fact["accession_number"], "form": fact["form"],
                "fy": fact["fy"], "fp": fact["fp"], "frame": fact["frame"],
            } for fact in member.facts
        }
        if stored_facts != expected_facts:
            raise ValueError("SEC selected facts differ from immutable stored extraction")
    conn.commit()
    return ("stored" if inserted_member else "duplicate"), companyfacts_id


def evidence(conn, slug: str, cutoff: datetime) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT id,name FROM companies WHERE slug=%s", (slug,))
        company = cur.fetchone()
        if company is None:
            raise KeyError(slug)
        cur.execute("""SELECT s.id,s.original_url,s.purpose, p.id AS snapshot_id,p.provider,p.provider_record_id,p.provenance,p.archive_url,p.captured_at,p.ingested_at,p.raw_sha256,p.text_sha256,p.normalized_text,p.text_status
            FROM sources s LEFT JOIN LATERAL (
                SELECT * FROM snapshots WHERE source_id=s.id AND captured_at<=%s
                ORDER BY captured_at DESC, CASE provider WHEN 'wayback' THEN 0 ELSE 1 END, provider_record_id, id LIMIT 1
            ) p ON true WHERE s.company_id=%s ORDER BY s.id""", (cutoff, company["id"]))
        sources = cur.fetchall()
    return {"company":slug,"name":company["name"],"cutoff":cutoff.isoformat(),"sources":[{
        "original_url":s["original_url"],"purpose":s["purpose"],
        "status":"available" if s["snapshot_id"] else "missing",
        "snapshot":({k:(v.astimezone(timezone.utc).isoformat() if isinstance(v,datetime) else v) for k,v in s.items() if k in ("snapshot_id","provider","provider_record_id","provenance","archive_url","captured_at","ingested_at","raw_sha256","text_sha256","normalized_text","text_status")}) if s["snapshot_id"] else None
    } for s in sources]}


def list_companies(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug, name FROM companies ORDER BY name")
        return cur.fetchall()


def overview(conn) -> dict:
    cutoff_2021 = datetime(2021, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    cutoff_2024 = datetime(2024, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    with conn.cursor() as cur:
        cur.execute("""SELECT
            (SELECT count(*) FROM companies) AS companies,
            (SELECT count(*) FROM sources) AS sources,
            (SELECT count(*) FROM snapshots) AS captures,
            (SELECT count(*) FROM ingestion_attempts WHERE outcome = 'failed') AS failed_attempts""")
        totals = cur.fetchone()
        cur.execute("""SELECT company.slug, company.name,
            count(DISTINCT source.id) AS source_count,
            count(DISTINCT snapshot.id) AS capture_count,
            count(DISTINCT source.id) FILTER (WHERE snapshot.captured_at <= %s) AS available_2021,
            max(snapshot.captured_at) FILTER (WHERE snapshot.captured_at <= %s) AS latest_2021,
            count(DISTINCT source.id) FILTER (WHERE snapshot.captured_at <= %s) AS available_2024,
            max(snapshot.captured_at) FILTER (WHERE snapshot.captured_at <= %s) AS latest_2024
            FROM companies AS company
            LEFT JOIN sources AS source ON source.company_id = company.id
            LEFT JOIN snapshots AS snapshot ON snapshot.source_id = source.id
            GROUP BY company.id, company.slug, company.name
            ORDER BY company.name""", (cutoff_2021, cutoff_2021, cutoff_2024, cutoff_2024))
        rows = cur.fetchall()

    companies = []
    for row in rows:
        companies.append({
            "slug": row["slug"],
            "name": row["name"],
            "source_count": row["source_count"],
            "capture_count": row["capture_count"],
            "coverage": {
                "2021": {
                    "available_sources": row["available_2021"],
                    "latest_capture_at": row["latest_2021"].astimezone(timezone.utc).isoformat() if row["latest_2021"] else None,
                },
                "2024": {
                    "available_sources": row["available_2024"],
                    "latest_capture_at": row["latest_2024"].astimezone(timezone.utc).isoformat() if row["latest_2024"] else None,
                },
            },
        })
    return {"totals": totals, "companies": companies}
