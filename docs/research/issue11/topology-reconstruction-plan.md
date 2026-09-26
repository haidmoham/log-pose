# scoped topology reconstruction proposal

status: proposed; no reconstruction or canonical write performed.

[the recovery receipt](database-recovery-20260926.json) establishes that the
located database and saved dump contain inventory only. this proposal concerns
the retained topology slice. it cannot restore the other evidence families.
[the preflight](topology-reconstruction-preflight.json) pins the published
projection, three retained source hashes, four claim IDs and four review IDs.
all three source bodies still match the acquisition manifest.

## proposed boundary

build a separate local reconstruction from the pinned published topology and
retained source bodies. preserve the recovered inventory database and existing
public exports. use an additive, tested recovery-provenance contract through
the raw -> bronze -> silver -> gold read path. do not replace the canonical
database or run `scripts/rebuild_data.py` from an incomplete store.

| record grain | available evidence | missing provenance and proposed treatment |
| --- | --- | --- |
| source artifact | three original IDs, retained HTML, hashes, URL, publisher, title, publication, retrieval and capture metadata | preserve exactly; verify every raw hash and quoted passage before loading |
| reviewed entity | four slugs, names, kinds and reviewed identity status | original entity creation times and numeric company foreign keys are not exported; original creation stays unknown; local reconstruction arrival and foreign-key mapping are separate provenance |
| accepted claim | four database/public IDs, original creation times, endpoints, predicates, scope, basis, source locators, narrative and time fields | preserve exported values exactly; do not re-run seed import, which would generate new proposal arrival times |
| additional premise | one source/claim/role/locator tuple and its text/quote/time fields | original internal row ID and `added_at` are absent; record a reconstruction identifier and current reconstruction arrival separately; do not assert original arrival |
| review decision | four original IDs, candidate IDs, reviewers, decisions, timestamps and rationale | copy history exactly; preserve sequence safety for later append-only reviews |
| other topology records | no complete projection of aliases, eligibility reviews, acquisition jobs or old graph-build rows | mark recovery coverage unavailable; an empty reconstructed table is not proof no such rows existed |
| page, SEC and market evidence | existing public read projections | preserve the projections; normalized exports cannot recreate missing raw evidence or prove a full restore |

## implementation and verification after the policy decision

1. create a new isolated local recovery database, with a separately named backup.
   retain a manifest of each input file/hash and known/missing field. recovery
   rows must identify the projection they came from and their new local arrival.
2. reconcile the four existing claims against the pinned projection: IDs,
   source hashes, quotes, scope, direction, clock fields and complete exported
   review history. test a second run for idempotence and conflicting records
   for rejection. no existing source or claim is overwritten.
3. append only the user's accepted integration from
   `integration-review-packet.json`, using its recorded review decision and
   exact attributed scope. keep product editions, validity and current
   availability unknown. record actual proposal/import arrival separately
   from the preserved human decision time.
4. export the topology slice into a fresh staging directory. compare the four
   existing claims byte-for-byte after canonical JSON normalization; only the
   new claim and explicit reconstruction metadata may differ. rebuild reviewed
   SQLite from that staged topology, preserving all old immutable builds.
5. use a reviewable PR for any migration, importer, projection and snapshot
   changes. require the application/data and Vercel gates before any proposed
   production publish. no page/SEC/market or inventory family is regenerated
   from the incomplete recovery store.

## decision required

accept a **scoped reconstruction with unknown original arrival metadata** as
the source for future topology work, or keep canonical import paused until a
fuller backup is found. this is a provenance-policy choice: neither the missing
historical values nor a verified full restore can be supplied by the retained
files. the user's claim acceptance is already recorded and does not need to be
repeated. any later publish remains a separate decision.
