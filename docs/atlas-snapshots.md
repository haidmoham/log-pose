# Atlas SQLite snapshots

The atlas API reads an immutable SQLite derivative. PostgreSQL and the retained
source files remain the evidence stores. A snapshot is a bounded serving format,
not a canonical database migration.

## Tables and grains

| Table | Row grain and key |
| --- | --- |
| `candidate` | One inventory candidate, keyed by candidate ID. `summary_json` preserves the projected summary without observations. |
| `artifact` | One immutable source revision, keyed by artifact ID. `detail_json` retains its raw SHA-256, source, inventory-year precision, revision, paths, and coverage metadata. |
| `placement` | One exact artifact revision and source category, keyed by placement ID. `member_count` is reconciled against memberships. |
| `membership` | One candidate in one exact placement, keyed by candidate ID plus placement ID. `detail_json` retains occurrence IDs and complete projected source rows. |
| `candidate_search` | One FTS5 document per candidate with name, description, tags, and exact source categories. It is a lookup aid, not evidence. |
| `metadata` | The logical manifest under the `manifest` key. |

The index stores both membership directions through the primary key and the
`membership_placement_candidate` index. Inventory year stays a year-precision
clock. Artifact identity supplies the immutable revision boundary.

## Immutable files and publication

Run:

```sh
PYTHONPATH=src python scripts/build_atlas_snapshot.py \
  --projection web/data/topology-discovery.json \
  --output api/data/atlas
```

Each logical build produces `<build_id>.sqlite` and `<build_id>.json`.
`current.json` contains the same complete manifest. Its build ID binds the
membership build, inputs, counts, clock declarations, and membership/query/
layout/snapshot versions. The outer manifest also records database bytes and a
SHA-256 checksum; the checksum stays outside SQLite to avoid a circular hash.

Before publication, validation checks SQLite integrity, foreign keys, logical
metadata, table and FTS counts, placement member counts, supporting occurrence
rows, file length, and checksum. The exporter writes the immutable database and
manifest before it replaces `current.json` atomically. A failed validation
leaves the prior pointer in place. Old immutable builds remain addressable.

Use `--check` to validate the current snapshot. Use
`--rollback <build_id>` to validate an earlier immutable snapshot and atomically
restore its manifest as `current.json`. Neither operation edits retained
evidence.

## Rebuild boundary

An unchanged, already validated immutable snapshot is reused. Changed logical
input currently receives a tested full rebuild. The manifest marks partitioned
incremental updates as `not_implemented`; it does not claim that copying an old
database is incremental derivation. Candidate and placement IDs, table keys,
and the logical manifest are the extension seam for later partition-level
replacement and full-build equivalence checks.
