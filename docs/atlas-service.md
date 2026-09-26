# bounded temporal atlas reads

`/atlas.html` opens the membership-first atlas. existing console and temporal
deep links remain supported by the legacy service. the new route requests
source regions, a candidate page, a focused neighborhood, then exact premises.
regions are exact source categories, not inferred markets or exclusive groups.

## query contract

`GET /api/atlas?mode=discover` returns the current immutable build, source
revisions, versions, limits and coverage. every other operation requires its
`build_id`. source revision selection uses `source`, `year`, `artifact`,
`category`, and `temporal_mode=snapshot|accumulated`. only the `inventory_year`
clock is supported. a missing snapshot fails; an ambiguous same-year revision
requires its artifact ID. unsupported layers and clocks fail explicitly.

| mode | selection and result |
| --- | --- |
| `regions` | paged exact source categories and membership counts |
| `search` | `query` and optional exact `placement`; indexed, paged candidates |
| `focus` | `candidate`, optional `top_k`; distinct neighbors and support counts |
| `explain` | `candidate`, `neighbor`; paged exact placements, hashes and both retained rows |
| `compare` | `candidate`, `compare_year`, `compare_artifact`; observed-set differences |
| `traverse` | `candidate`, `target`, `hops`; at most 3 hops and 100 visited candidates |
| `export` | one selected focus page and optional selected explanation page |

top-k uses distinct supporting placements descending, then candidate ID
ascending. repeated rows in one placement do not inflate rank. `top_k` accepts
1–100. the interface defaults to 60. the read API also supports complete
neighborhood pagination when `top_k` is omitted. ranking is a navigation rule;
it does not measure business strength, economic similarity or probability.

the heap keeps at most k ranking entries. exact support counting still scans
the focus memberships and retains a bounded candidate-count map. it does not
materialize unrelated category cliques. selected premise bodies load separately.

## enforced bounds and failure states

- 1 MiB decoded successful response; oversized detail returns 413.
- 100 results per page; explanations default to 10 placements, at most 25.
- 200,000 membership-row budget, 4,096 focus placements and 20,000 distinct
  neighbors; 750 ms application work budget checked between bounded reads.
  SQLite reports rows visited by its membership iterators. Postgres reports
  `membership_rows_estimate`, a conservative incidence-work estimate, not
  physical rows touched by the database planner.
- two immutable SQLite handles per process, 8 MiB page cache each, no mmap.
- 3 MiB serialized-response LRU in the browser; no speculative frame prefetch.

the application timer is not a hard SQLite interruption deadline. these limits
bound supported queries, not all possible filesystem or cold-start latency.
Postgres additionally sets a transaction-local 750 ms statement timeout.
budget errors return 422 and ask for a narrower revision or category. an
unhosted build returns 410. a cursor from another build, filter, top-k setting
or page size returns 409. neither condition silently switches to current data.
counts say exact or unavailable. partial scans never claim exact totals.

`frame_id` binds the evidence build, query version, source selection and focus.
`receipt_id` additionally binds the request and its page/ranking parameters.
pending requests leave the prior graph under its prior label. late responses
cannot replace an accepted frame or inspector. edge selection cannot cross a
build or selection. failures keep retained evidence visible and expose retry.

## interaction and design decisions

controls stay mounted while detail changes. the connection slider previews a
smaller already-loaded top-k locally, then requests the exact selection on
release. camera input coalesces per animation frame. panning changes the camera
transform; label collision work runs only when zoom changes. positions stay
fixed across years. the existing dark palette and typography carry through.
these are adaptations of progressive disclosure and continuous feedback, with
no imported design component or new rendering dependency.

list mode presents the same candidates and premise actions without graph
rendering. keyboard controls support zoom, pan, selection and density changes.
reduced motion skips frame fades and CSS transitions. the view needs no GPU.
the graph draws at most the selected page plus the pinned candidate.

## publication and recovery

run `npm run build:atlas`, `npm run check:atlas`, and `npm run test:atlas`.
the Python commands need the repository environment on PATH. validation checks
hashes, counts, foreign keys, FTS alignment and retained occurrence counts before
publishing `current.json`. incremental publication requires an explicit prior
build and preserves it; full rebuild is the recovery path. normalization still
reads the full input projection. no public endpoint writes evidence.

the checked-in S0 snapshots support current and earlier development deep links.
old builds need an explicit retention decision before removal. restoring their
immutable database and manifest restores their links. Vercel bundles these S0
files only. S1/S2 databases exceed its normal function bundle limit; their local
read results do not establish deployed S1 support. the Postgres provider removes
that bundle constraint without importing a whole corpus into each Node process.
see [scale receipts](atlas-scale.md) and [Railway deployment](atlas-railway.md).

`api/atlas-runtime.js` selects the provider: `ATLAS_READ_SERVICE_URL` proxies an
HTTPS hosted reader; otherwise `ATLAS_DATABASE_URL` selects indexed Postgres;
otherwise the local SQLite provider is used. provider failures never trigger an
implicit fallback. both providers share frame, cursor, ranking and error
contracts. Postgres requests use one repeatable-read, read-only transaction.

the SQLite provider streams a file checksum on first open, then retains at most
two handles. that cold integrity scan occurs before the query timer. the older
SQLite scale receipts precede this checksum and do not measure its cold cost.
the Postgres importer performs checksum and reconciliation before publication.
successful focus/export pages fetch explanation bodies separately; exports use
`evidence_limit` and `evidence_cursor`, independent of neighborhood pagination.

source text is rendered as text, and source links use the shared safe-link
primitive. hashes identify evidence; they do not grant redistribution rights.
the read derivative inherits the retained source scope and attribution.
