# atlas operating envelope and next constraints

as of 2026-09-26, issue #11 remains incomplete. this report separates local
capacity measurements, reviewed evidence coverage and deployed behavior.
PR #17 and PR #18 are reviewable milestones; they are not a production release
until approved, merged and checked at the matching Vercel deployment.

## measured envelope

| surface | verified result | limit of the result |
| --- | --- | --- |
| real S0 inventory | 1,240 candidates, 5,964 memberships, fourteen artifact revisions; exact parity with 47,288 legacy pairs and their retained support | co-listing is not a company or commercial relationship; the separate review worklist has 100 pairs |
| bounded top-k | 60 default, 100 maximum; top-100 page-size regression fixed in PR #17 | exact ranking still scans incident memberships; a bounded response does not mean constant query work |
| S0 browser | thirty samples across inventory top 60/top 100/reviewed frames; desktop graph-ready p95 at most 209 ms, constrained at most 1,116 ms | fresh cache-disabled browser contexts, warm local server/OS; no hosted cold-start or physical-phone claim |
| S0 updates/camera | worst profile/workload p95 frame acceptance 565 ms; zoom JavaScript 4.2 ms; pan JavaScript 0.7 ms | measures application work, not compositor completion or FPS |
| S0 retained state | 20-minute soak; 171 API and 1,064 total HTTP requests, all complete, no errors; final resting heap -15,384 bytes, DOM/listener growth zero | forced-GC resting samples; GPU memory was unavailable; no general leak-freedom claim |
| access paths | both layers pass real-browser keyboard, visible focus, touch-selection, reduced-motion and SVG/list fallback checks with WebGL disabled | 390x844 emulation; not a physical-device, screen-reader or full accessibility-conformance audit |
| synthetic S1 SQLite | 10,000 candidates, 1,000,000 memberships, 32 revisions; top-100 compact response 32,363 bytes, 20-client p95 238.18 ms | local membership fixture, not mixed typed claims or full S1 product support |
| synthetic S2 SQLite | 50,000 candidates, 5,000,000 memberships, 64 revisions; top-100 compact response 32,372 bytes, 20-client p95 270.87 ms | local membership fixture; no S2 browser or hosted deployment measurement |
| synthetic S1 Postgres | prepared/validated publication; true 1/5/20-client batches all passed; focus p95 at most 186.9 ms | local PostgreSQL 18.6; no Railway or remote-service measurement |
| synthetic S2 Postgres | generation completed; import/reconciliation did not finish within the cumulative 30-minute tier budget | rolled back; S1 stayed current; no S2 read matrix; a fresh run needs a new approved budget |

S0 browser API payloads were at most 32,821 bytes. initial application plus data
transfer was 218,474-443,401 bytes without compression. peak sampled browser RSS
was 1,019,224,064 bytes; server RSS was 155,078,656 bytes. the raw receipts retain
all measurements, including failed and interrupted attempts.

## first binding deployment constraint

S1 and S2 SQLite snapshots occupy 687,386,624 and 3,432,722,432 bytes. neither
fits the standard function bundle described in the dated
[backend scale report](atlas-scale.md). the small production SQLite backend
stays in place under the user's hobby-cost decision. Railway is undeployed,
and this work adds no billable backend resource.

a first local S1 SQLite handler request, including file checksum validation,
returned in 782.36 ms; query work accounted for 56.52 ms. this is one first-open
observation, not a cold-start distribution or an OS-cold measurement. the old
warm scale timings exclude that startup work. [raw reference](research/issue11/postgres-scale-sqlite-cold-s1.json).

the next serving decision is packaging or partitioning the immutable read
artifact, or an explicitly budgeted external reader. local query speed does
not choose that deployment for the user. no free-tier capacity, beta feature,
monthly price or spending cap is assumed by these measurements.

## evidence and research coverage

four accepted scoped claims cover named competition, a shared-workload
hypothesis, an announced partnership and financing participation. each retains
its supporting passages, source hashes, review history and temporal limits.
financing participation does not establish current ownership. the reviewed
publication clock uses current accepted reviews at the selected immutable
build; it cannot replay historical review state or assert relationship validity.

PR #18 adds deterministic typed paths (three hops, 100 visited entities) and
Python investigations that keep inventory and reviewed clocks/builds separate.
real retained walkthroughs demonstrate an explicit cross-layer identity link
and exclusion of a later filing before its publication cutoff. saved paths are
research records, not new accepted claims or calibrated model predictions.

the user accepted one attributed dbt/Snowflake integration and approved a scoped
topology reconstruction. its canonical import is a separate milestone. the
recovered local database contains inventory only; three retained topology
source bodies and four published claims/reviews permit partial reconstruction.
original entity creation and one secondary-evidence arrival remain unknown.
page, SEC and market raw evidence has not been restored. customer leads,
product editions, ownership and relationship-validity intervals remain
unresolved; no new semantic acceptance is inferred.

## prioritized continuation

1. finish and reconcile the approved topology reconstruction and integration
   import; preserve every known ID/hash/review and the original-time gaps.
2. approve and verify the milestone releases at exact deployed commits; retain
   failed-build/retry/back-navigation checks. signed-in preview access currently
   remains unavailable to Codex's Chrome connection.
3. measure an S1 browser profile and a bounded mixed-predicate/long-history
   workload. membership capacity alone does not satisfy those requirements.
4. choose the next deployment packaging boundary within the hobby constraint,
   then measure first-open and hosted latency on that chosen path. do not
   provision a paid service implicitly.
5. retain a comparison of the existing visual alternatives on real
   neighborhoods, including task steps and interaction cost; do not substitute
   this performance report for a user research result.
6. source and review remaining layer gaps only within the 25-entity/100-document
   acquisition cap. a missing layer stays explicitly incomplete.

## receipts and reproducibility

- [browser protocol and budgets](research/issue11/browser-measurement-protocol.md)
- [S0 browser result and limitations](atlas-browser-performance.md)
- [raw S0 timing and soak](research/issue11/browser-playwright-s0.json)
- [eleven-check browser access receipt](research/issue11/browser-accessibility-s0.json)
- [SQLite fixture/build/read results](atlas-scale.md)
- [Postgres results, failed attempts and S2 boundary](atlas-postgres-scale.md)
- [Python reviewed research walkthroughs](https://github.com/haidmoham/log-pose/blob/0d4ee9c51de345e78976fcaf70f0aac5eab8224b/docs/atlas-research.md) (PR #18)
- [complete acceptance audit](research/issue11/completion-audit.md)
- [database recovery receipt](research/issue11/database-recovery-20260926.json)
- [approved reconstruction boundary](research/issue11/topology-reconstruction-decision.json)
