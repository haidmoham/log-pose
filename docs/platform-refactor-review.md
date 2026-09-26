# atlas platform refactor review

this pass gives repeated protocol rules one tested owner. It follows the atlas
ux base in [PR 22](https://github.com/haidmoham/log-pose/pull/22) and tracks the
bounded cleanup in [issue 23](https://github.com/haidmoham/log-pose/issues/23).
it does not change snapshot SQL, evidence selection, limits, clocks, rendering,
or view lifecycle policy.

## before and after

| path | before | after |
| --- | --- | --- |
| server request protocol | `api/atlas.js` and `api/atlas-reviewed.js` each defined errors, hashes, parameter and integer checks, cursor encoding, and stable positions | `api/atlas-protocol.js` owns those byte-compatible primitives; each provider keeps a small wrapper for its own limits and messages |
| browser request IO | both atlas views serialized queries, used the byte cache, fetched JSON, selected HTTP errors, and checked pinned builds | `web/atlas-client.js` owns that sequence; each view configures its two messages once |
| provider and view policy | mixed with repeated plumbing | remains local: selectors, work budgets, snapshots, SQL, tickets, abort controllers, retries, disposal, URL state, frame acceptance, inspectors, and rendering |

the server runtime changed from 930 lines across the two providers to 922 lines
across both providers and the 68-line shared protocol module: a net reduction of
8 lines. the browser runtime changed from 883 lines across both views and the
model to 894 lines including the 28-line client: a net addition of 11 lines.
the value is one owner for compatibility-sensitive behavior, not a large source
line reduction. the two view files themselves lose 17 lines.

the browser client reuses `atlas-model.js`'s existing byte-bounded cache. It
caches only successful, build-matched responses. Its cache key is the complete
serialized query, so layers, builds, selectors, pages, and frames remain
isolated. inventory retains its 2,048-character page cursor and 240-character
evidence cursor. reviewed reads retain their 2,048-character cursor policy and
their existing fallback and build-change messages.

| action | code path |
| --- | --- |
| inventory read | `atlas-view.js` → `atlas-client.js` → `/api/atlas` → `atlas-runtime.js` → bundled SQLite, indexed Postgres, or HTTPS proxy → pinned-build guard → view frame gate |
| reviewed read | `atlas-reviewed-view.js` → `atlas-client.js` → `/api/atlas?layer=reviewed` → independent reviewed SQLite → pinned-build guard → reviewed frame gate |
| inspect | accepted focus frame → client request → exact retained membership rows or typed claim premises → same-frame inspector; the full research entry remains `/index.html` |

The ux base already makes the bounded atlas the `/` entry and keeps the explicit
research desk at `/index.html`. this refactor preserves that route choice; it
only moves repeated transport rules behind the client seam.

## verification

the protocol matrix pins literal hash and layout outputs, exact error status,
code and message, repeated parameters, cursor boundaries, malformed and
mismatched cursors, and current versus pinned builds. the client matrix covers
cache hits and query isolation, uncached network, JSON and HTTP failures,
uncached build mismatches, provider fallback wording, and abort-signal forwarding. existing
view tests continue to cover late-response exclusion, accepted-frame coherence,
cache eviction, disposal, deep links, review clocks, and evidence inspection.

the bounded checks are `npm run test:atlas`, `npm run test:dashboard`, the
deployment-health test, and targeted Oxlint over changed JavaScript. database integration tests require the disposable CI database; local skips are
not counted as passes. this refactor does not combine the inventory-year and source-publication
clocks, or introduce a shared lifecycle runner; those differences remain visible
at their call sites.

local results: 57 atlas tests passed (3 database checks skipped), 109 dashboard
tests passed, and 11 saved-read tests passed. both snapshot validators passed.
changed JavaScript has no lint findings; the full repository baseline retains
20 existing errors and 8 warnings. all 7 exact-commit deployment tests and 12 real-browser smoke checks passed,
with no page errors. required CI and Vercel results are recorded on the refactor
pull request; they include the disposable-database checks skipped locally.

this is a structural refactor, with no measured speedup claim. it adds one small
browser script request and no dependency. retained data and applied SQL are
checked byte-for-byte against the pre-refactor baseline.

independent response comparison used 40 handler calls against the retained
inventory and reviewed builds. responses matched after excluding only
`work.elapsed_ms`, except for the reviewed-layer link deliberately changed by
PR 22. both original readers emitted nonempty pagination cursors; the refactored
readers accepted those exact cursors and returned the same continuation rows.
