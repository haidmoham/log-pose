"""Persist topology evidence and project reviewed claims at two time cutoffs."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from psycopg.rows import dict_row

from .core import sha256


def store_source(conn, *, source_id: str, source_url: str, publisher: str,
                 title: str, source_type: str, retrieved_at: datetime,
                 raw_body: bytes | None = None, snapshot_id: int | None = None,
                 raw_sha256: str | None = None, published_on: date | None = None,
                 captured_at: datetime | None = None, error: str | None = None) -> str:
    """Store one retrieval immutably; a changed retrieval needs a new source ID."""
    if (raw_body is None) == (snapshot_id is None) and error is None:
        raise ValueError("retrieved source needs exactly one payload or snapshot")
    if error is not None and (raw_body is not None or snapshot_id is not None):
        raise ValueError("failed retrieval cannot contain evidence")
    if raw_body is not None:
        computed = sha256(raw_body)
        if raw_sha256 is not None and raw_sha256 != computed:
            raise ValueError("source digest does not match payload")
        raw_sha256 = computed
    if snapshot_id is not None:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT raw_sha256 FROM snapshots WHERE id=%s", (snapshot_id,))
            snapshot = cur.fetchone()
        if snapshot is None:
            raise ValueError("unknown snapshot evidence")
        if raw_sha256 is not None and raw_sha256 != snapshot["raw_sha256"]:
            raise ValueError("source digest does not match snapshot")
        raw_sha256 = snapshot["raw_sha256"]
    status = "failed" if error is not None else "retrieved"
    expected = (source_url, publisher, title, source_type, published_on,
                captured_at, retrieved_at, raw_sha256, snapshot_id, status, error)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO topology_sources(id,source_url,publisher,title,
            source_type,published_on,captured_at,retrieved_at,raw_body,raw_sha256,
            snapshot_id,retrieval_status,error)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING RETURNING id""",
            (source_id, *expected[:7], raw_body, *expected[7:]))
        inserted = cur.fetchone() is not None
        if not inserted:
            cur.execute("""SELECT source_url,publisher,title,source_type,published_on,
                captured_at,retrieved_at,raw_body,raw_sha256,snapshot_id,
                retrieval_status,error FROM topology_sources WHERE id=%s""", (source_id,))
            row = cur.fetchone()
            stored = (row["source_url"], row["publisher"], row["title"],
                      row["source_type"], row["published_on"], row["captured_at"],
                      row["retrieved_at"], row["raw_sha256"], row["snapshot_id"],
                      row["retrieval_status"], row["error"])
            if stored != expected or (raw_body is not None and bytes(row["raw_body"]) != raw_body):
                raise ValueError("source ID already holds different evidence")
    conn.commit()
    return "stored" if inserted else "duplicate"


def ensure_entity(conn, *, entity_id: str, name: str, entity_kind: str,
                  identity_status: str = "lead", pilot_company_id: int | None = None) -> str:
    """Create a stable entity lead without silently changing an existing identity."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO topology_entities(id,name,entity_kind,identity_status,pilot_company_id)
            VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING RETURNING id""",
            (entity_id, name, entity_kind, identity_status, pilot_company_id))
        inserted = cur.fetchone() is not None
        if not inserted:
            cur.execute("""SELECT name,entity_kind,identity_status,pilot_company_id
                FROM topology_entities WHERE id=%s""", (entity_id,))
            row = cur.fetchone()
            if tuple(row.values()) != (name, entity_kind, identity_status, pilot_company_id):
                raise ValueError("entity ID already holds a different identity")
    conn.commit()
    return "stored" if inserted else "duplicate"


def plan_acquisition(conn, *, job_id: str, source_url: str, source_family: str,
                     source_key: str, target_entity_id: str | None = None) -> str:
    """Add a discovery lead to the durable, idempotent acquisition queue."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO topology_acquisition_jobs(id,source_url,source_family,
            source_key,target_entity_id,status) VALUES (%s,%s,%s,%s,%s,'pending')
            ON CONFLICT (id) DO NOTHING RETURNING id""",
            (job_id, source_url, source_family, source_key, target_entity_id))
        inserted = cur.fetchone() is not None
        if not inserted:
            cur.execute("""SELECT source_url,source_family,source_key,target_entity_id
                FROM topology_acquisition_jobs WHERE id=%s""", (job_id,))
            row = cur.fetchone()
            if tuple(row.values()) != (source_url, source_family, source_key, target_entity_id):
                raise ValueError("job ID already holds a different acquisition target")
    conn.commit()
    return "stored" if inserted else "duplicate"


def claim_acquisitions(conn, *, limit: int, max_attempts: int = 3,
                       lease_minutes: int = 15) -> list[dict]:
    """Lease a bounded page; abandoned running jobs become retryable."""
    if not 1 <= limit <= 500 or max_attempts < 1 or lease_minutes < 1:
        raise ValueError("invalid acquisition budget")
    expired_before = datetime.now(timezone.utc) - timedelta(minutes=lease_minutes)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""WITH available AS (
            SELECT id FROM topology_acquisition_jobs
            WHERE attempts < %s AND (
                status IN ('pending', 'failed')
                OR (status = 'running' AND last_attempt_at < %s))
            ORDER BY created_at, id LIMIT %s FOR UPDATE SKIP LOCKED
        )
        UPDATE topology_acquisition_jobs AS job
        SET status = 'running', attempts = job.attempts + 1,
            last_attempt_at = now(), error = NULL
        FROM available WHERE job.id = available.id
        RETURNING job.id, job.source_url, job.source_family, job.source_key,
            job.target_entity_id, job.attempts""",
            (max_attempts, expired_before, limit))
        jobs = cur.fetchall()
    conn.commit()
    return jobs


def finish_acquisition(conn, *, job_id: str, source_id: str | None = None,
                       error: str | None = None) -> None:
    if (source_id is None) == (error is None):
        raise ValueError("supply exactly one source or error")
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""UPDATE topology_acquisition_jobs
            SET status=%s, source_id=%s, error=%s
            WHERE id=%s AND status='running' RETURNING id""",
            ("retrieved" if source_id else "failed", source_id, error, job_id))
        if cur.fetchone() is None:
            raise ValueError("job is not leased")
    conn.commit()


def record_eligibility_review(conn, *, entity_id: str, universe_status: str,
                              source_id: str, reviewer: str, rationale: str,
                              reviewed_at: datetime) -> int:
    """Review U.S. software-universe eligibility separately from identity."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO topology_eligibility_reviews(entity_id,
            universe_status,source_id,reviewer,rationale,reviewed_at)
            VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
            (entity_id, universe_status, source_id, reviewer, rationale, reviewed_at))
        review_id = cur.fetchone()["id"]
    conn.commit()
    return review_id


def store_candidate(conn, *, candidate_id: str, source_id: str,
                    subject_entity_id: str, object_entity_id: str, predicate: str,
                    direction: str, scope: str, evidence_locator: str,
                    evidence_text: str, interpretation: str,
                    alternative_or_unknown: str,
                    temporal_form: str, temporal_basis: str,
                    proposed_basis: str, generator: str, generator_version: str,
                    exact_quote: str | None = None,
                    event_on: date | None = None, valid_from: date | None = None,
                    valid_to: date | None = None, period_start: date | None = None,
                    period_end: date | None = None) -> str:
    """A proposal is not an accepted relationship until a review accepts it."""
    values = (source_id, subject_entity_id, object_entity_id, predicate, direction,
              scope, evidence_locator, evidence_text, exact_quote, interpretation,
              alternative_or_unknown, temporal_form, temporal_basis,
              event_on, valid_from, valid_to, period_start, period_end,
              proposed_basis, generator, generator_version)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO topology_candidates(id,source_id,subject_entity_id,
            object_entity_id,predicate,direction,scope,evidence_locator,evidence_text,exact_quote,
            interpretation,alternative_or_unknown,temporal_form,temporal_basis,
            event_on,valid_from,valid_to,period_start,period_end,
            proposed_basis,generator,generator_version)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING RETURNING id""", (candidate_id, *values))
        inserted = cur.fetchone() is not None
        if not inserted:
            cur.execute("""SELECT source_id,subject_entity_id,object_entity_id,
                predicate,direction,scope,evidence_locator,evidence_text,exact_quote,
                interpretation,alternative_or_unknown,temporal_form,temporal_basis,
                event_on,valid_from,valid_to,period_start,
                period_end,proposed_basis,generator,generator_version
                FROM topology_candidates WHERE id=%s""", (candidate_id,))
            if tuple(cur.fetchone().values()) != values:
                raise ValueError("candidate ID already holds a different proposal")
    conn.commit()
    return "stored" if inserted else "duplicate"


def add_candidate_evidence(conn, *, candidate_id: str, source_id: str,
                           evidence_role: str, evidence_locator: str,
                           evidence_summary: str, exact_quote: str | None = None,
                           event_on: date | None = None,
                           period_start: date | None = None,
                           period_end: date | None = None) -> str:
    """Retain an additional source passage without combining source claims."""
    values = (candidate_id, source_id, evidence_role, evidence_locator,
              evidence_summary, exact_quote, event_on, period_start, period_end)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO topology_candidate_evidence(candidate_id,source_id,
            evidence_role,evidence_locator,evidence_summary,exact_quote,event_on,
            period_start,period_end) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (candidate_id,source_id,evidence_role,evidence_locator)
            DO NOTHING RETURNING id""", values)
        inserted = cur.fetchone() is not None
        if not inserted:
            cur.execute("""SELECT evidence_summary,exact_quote,event_on,period_start,
                period_end FROM topology_candidate_evidence WHERE candidate_id=%s
                AND source_id=%s AND evidence_role=%s AND evidence_locator=%s""",
                values[:4])
            if tuple(cur.fetchone().values()) != values[4:]:
                raise ValueError("evidence reference changed; original passage preserved")
    conn.commit()
    return "stored" if inserted else "duplicate"


def record_review(conn, *, candidate_id: str, decision: str, reviewer: str,
                  rationale: str, reviewed_at: datetime) -> int:
    """Append a decision. A later decision supersedes it only in projections."""
    with conn.cursor(row_factory=dict_row) as cur:
        if decision == "accept":
            cur.execute("""SELECT predicate FROM topology_candidates WHERE id=%s""",
                        (candidate_id,))
            candidate = cur.fetchone()
            if candidate is None:
                raise ValueError("unknown candidate")
            if candidate["predicate"] == "shared_exposure_hypothesis":
                cur.execute("""SELECT count(DISTINCT source_id) AS sources FROM (
                    SELECT source_id FROM topology_candidates WHERE id=%s
                    UNION ALL
                    SELECT source_id FROM topology_candidate_evidence
                    WHERE candidate_id=%s AND evidence_role='support'
                ) AS premises""", (candidate_id, candidate_id))
                if cur.fetchone()["sources"] < 2:
                    raise ValueError("shared exposure needs two supporting sources")
        cur.execute("""INSERT INTO topology_reviews(candidate_id,decision,reviewer,
            rationale,reviewed_at) VALUES (%s,%s,%s,%s,%s) RETURNING id""",
            (candidate_id, decision, reviewer, rationale, reviewed_at))
        review_id = cur.fetchone()["id"]
    conn.commit()
    return review_id


def reviewed_claims(conn, *, source_date_cutoff: date | None = None,
                    review_cutoff: datetime | None = None,
                    entity_id: str | None = None, limit: int = 100,
                    offset: int = 0) -> list[dict]:
    """Read accepted source assertions with public-date and review-time filters.

    The source cutoff says when evidence was published, not whether a relation
    remained active at that date. Event and reporting dates are returned intact.
    """
    if limit < 1 or limit > 500 or offset < 0:
        raise ValueError("invalid neighborhood page")
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""SELECT candidate.id, candidate.subject_entity_id,
            subject.name AS subject_name, candidate.object_entity_id,
            object_entity.name AS object_name, candidate.predicate,
            candidate.direction, candidate.scope, candidate.evidence_locator,
            candidate.evidence_text, candidate.exact_quote,
            candidate.interpretation,
            candidate.alternative_or_unknown,
            candidate.temporal_form, candidate.temporal_basis,
            candidate.event_on, candidate.valid_from, candidate.valid_to,
            candidate.period_start, candidate.period_end,
            candidate.proposed_basis, candidate.generator,
            candidate.generator_version, candidate.created_at,
            source.id AS source_id, source.source_url, source.publisher,
            source.title AS source_title, source.source_type,
            source.published_on, source.captured_at, source.retrieved_at,
            source.raw_sha256, source.snapshot_id,
            COALESCE(extra.evidence, '[]'::jsonb) AS additional_evidence,
            review.id AS review_id, review.reviewer, review.reviewed_at,
            review.rationale
        FROM topology_candidates AS candidate
        JOIN topology_sources AS source ON source.id = candidate.source_id
        JOIN topology_entities AS subject ON subject.id = candidate.subject_entity_id
        JOIN topology_entities AS object_entity ON object_entity.id = candidate.object_entity_id
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object(
                'source_id', evidence.source_id,
                'source_url', other_source.source_url,
                'publisher', other_source.publisher,
                'published_on', other_source.published_on,
                'retrieved_at', other_source.retrieved_at,
                'raw_sha256', other_source.raw_sha256,
                'role', evidence.evidence_role,
                'locator', evidence.evidence_locator,
                'summary', evidence.evidence_summary,
                'exact_quote', evidence.exact_quote,
                'event_on', evidence.event_on,
                'period_start', evidence.period_start,
                'period_end', evidence.period_end
            ) ORDER BY evidence.id) AS evidence
            FROM topology_candidate_evidence AS evidence
            JOIN topology_sources AS other_source ON other_source.id=evidence.source_id
            WHERE evidence.candidate_id=candidate.id
        ) AS extra ON true
        JOIN LATERAL (
            SELECT id, decision, reviewer, reviewed_at, rationale
            FROM topology_reviews
            WHERE candidate_id = candidate.id
                AND (%s::timestamptz IS NULL OR reviewed_at <= %s)
            ORDER BY reviewed_at DESC, id DESC LIMIT 1
        ) AS review ON review.decision = 'accept'
        WHERE source.retrieval_status = 'retrieved'
            AND NOT EXISTS (
                SELECT 1 FROM topology_candidate_evidence AS premise
                JOIN topology_sources AS premise_source ON premise_source.id=premise.source_id
                WHERE premise.candidate_id=candidate.id AND premise.evidence_role='support'
                    AND premise_source.retrieval_status <> 'retrieved'
            )
            AND (%s::date IS NULL OR source.published_on <= %s)
            AND (%s::date IS NULL OR NOT EXISTS (
                SELECT 1 FROM topology_candidate_evidence AS premise
                JOIN topology_sources AS premise_source ON premise_source.id=premise.source_id
                WHERE premise.candidate_id=candidate.id AND premise.evidence_role='support'
                    AND (premise_source.published_on IS NULL OR premise_source.published_on > %s)
            ))
            AND (%s::timestamptz IS NULL OR source.retrieved_at <= %s)
            AND (%s::timestamptz IS NULL OR candidate.created_at <= %s)
            AND (%s::timestamptz IS NULL OR NOT EXISTS (
                SELECT 1 FROM topology_candidate_evidence AS premise
                JOIN topology_sources AS premise_source ON premise_source.id=premise.source_id
                WHERE premise.candidate_id=candidate.id AND premise.evidence_role='support'
                    AND (premise.added_at > %s OR premise_source.retrieved_at > %s)
            ))
            AND (%s::text IS NULL OR candidate.subject_entity_id = %s
                OR candidate.object_entity_id = %s)
        ORDER BY source.published_on DESC NULLS LAST, candidate.id
        LIMIT %s OFFSET %s""",
            (review_cutoff, review_cutoff, source_date_cutoff, source_date_cutoff,
             source_date_cutoff, source_date_cutoff,
             review_cutoff, review_cutoff, review_cutoff, review_cutoff,
             review_cutoff, review_cutoff, review_cutoff,
             entity_id, entity_id, entity_id, limit, offset))
        return cur.fetchall()
