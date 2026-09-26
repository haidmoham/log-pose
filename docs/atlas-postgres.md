# atlas postgres snapshots

The Postgres atlas tables are an immutable gold serving derivative. They do not replace retained evidence, write canonical claims, or change the SQLite snapshot contract.

`public.atlas_snapshot` has one row per build. Its key is the logical `build_id`; `manifest` binds source hashes, versions, counts, clocks, and the validated SQLite file. Candidate, artifact, placement, and membership rows use `(build_id, id)` keys. Placement foreign keys bind an exact artifact revision and category. Membership foreign keys bind one candidate to one placement. `detail_json` retains occurrence IDs and source rows. The matching `gold.atlas_*` views are the read path.

The row grains are one candidate summary, one immutable source artifact, one artifact/category placement, and one candidate/placement membership within one build. `inventory_year` is source-time evidence with year precision. Artifact IDs distinguish immutable revisions, including revisions from the same source and year. Source-row precision and source hashes remain in the JSON evidence. The tables add no system-known or validity clock; the manifest and transaction identify a serving publication, not when a claim became true. Postgres transaction time is operational arrival time and is not evidence time.

The importer validates the SQLite byte count, SHA-256, logical build ID, foreign keys, row counts, search index, membership rows, and occurrence totals before it connects those rows to the Postgres pointer. It streams ordered SQLite rows into bounded COPY batches inside one transaction. Candidate search source text passes through a temporary table and becomes a Postgres `simple`-configuration `tsvector`. It does not load the global projection or generate candidate pairs.

An existing build is reusable only when its stored JSONB manifest exactly equals the validated immutable manifest and all reconciliation checks pass. Published build rows are never updated. Old builds remain addressable. The singleton `public.atlas_current` pointer changes only after the imported or reused build passes validation; an exception rolls back both rows and pointer changes.

Run migration and import with an administrator connection supplied only through the environment:

```bash
ATLAS_PUBLISH_DATABASE_URL='postgresql://…' \
  PYTHONPATH=src .venv/bin/python scripts/publish_atlas_postgres.py \
  --snapshot-root api/data/atlas --build-id BUILD_ID
```

Use `--no-current` to stage a validated immutable build without selecting it. Use `--batch-size` to tune COPY pages from 1 through 50,000 rows. The command prints status, build ID, and counts; it never prints the connection string. Recovery is idempotent: rerun the same command after a failed transaction, or select any retained build by importing it with `--build-id`.

Tests that exercise Postgres require `LOG_POSE_TEST_DATABASE_URL` for a disposable database. They apply all migrations and truncate only atlas tables. Local tests without that variable still validate manifest rejection and argument bounds using canonical SQLite fixtures.
