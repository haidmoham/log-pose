# issue 11 completion audit

audited on 2026-09-26 against main
`72333464855bd6a8003086a92fe89acc9d02ef34` (merged PR #16).
**the epic is incomplete.** this audit preserves the issue's full scope; a
passing S0 test does not establish S1 deployment or complete evidence coverage.

the source of requirements is [issue #11](https://github.com/haidmoham/log-pose/issues/11).
the numbered rows below follow its acceptance checklist in order. “supported”
means the named implementation and checks cover the stated slice. “partial”
means evidence is missing for part of the requirement, not that the remainder
can be assumed to pass.

| # | current evidence | result and remaining proof |
| --- | --- | --- |
| 1 | `scripts/check_browser_smoke.cjs` verifies legacy topology deep links and retained-row drill, plus the reviewed atlas deep link and claim trail. current and older inventory SQLite manifests remain hosted. | supported compatibility slice; expand the deployed smoke to cover inventory `/atlas.html` and failure/recovery on the exact new release. |
| 2 | `tests/test_atlas_membership.py::test_real_pinned_s0_matches_every_legacy_pair_and_supporting_placement` compares all 47,288 pairs and supporting placements. `tests/atlas-api.test.js` checks focused S0 reads. | supported: 1,240 candidates, 5,964 memberships, fourteen revisions, and the separate 100-item review worklist. |
| 3 | membership tables index both incidence directions. 1,000/10,000-member fixtures and focused reads avoid mandatory clique construction; exact support ranking and ties have tests. | supported for inventory; the 49,995,000 potential pairs in the giant bucket are not materialized. exact focus still scans a bounded incidence neighborhood. |
| 4 | SQLite and Postgres query indexed selected rows; public responses and browser caches have byte limits. retained claim bodies are fetched for selected pages. | supported read path. full canonical normalization still reads its input projection; that is a build limitation, not a claim of fully incremental ingestion. |
| 5 | inventory and reviewed route tests cover late responses, pending frames, disposal, and matching graph/inspector frames. `reviewed-production-browser.json` records a manual public-origin missing-build, retry and back-navigation recovery check. | supported cases; extend the automated deployment smoke beyond its current happy path. |
| 6 | inventory rejects unsupported clocks and ambiguous revisions. reviewed queries require all supporting/contradicting premise publication dates by cutoff. explicit current-review and present-day identity/layout limitations remain visible. | supported reconstruction contracts. historical relationship validity and operational replay are unavailable in the atlas; do not call these delivered clocks. |
| 7 | reviewed detail retains scope, direction, typed claims, full premises, reviews, unknowns, and event/reporting/publication times. hypotheses require selection. | supported for four accepted claims. integrations, customer claims and ownership have no accepted slice yet. |
| 8 | exact taxonomy regions drill to candidate pages and retained records; camera updates do not alter query selectors or saved cohort. | supported chosen design. the requested small comparison of alternative prototypes on real neighborhoods lacks a durable decision receipt with measured interaction cost. |
| 9 | `layer-evidence-review.md`, source manifest, three retained topology bodies, fourteen inventory artifacts, and the four-claim reviewed layer. | partial: competition/workflow, partnership, capital participation and observation history exist. the user accepted the scoped integration proposal; canonical import remains pending. named-customer source mentions were found, but need a predicate and reviews; ownership and relationship validity remain unsupported. |
| 10 | browser saves selected inventory/reviewed pages and notes. `src/log_pose/atlas_read.py` validates bounded inventory research exports. three retained investigations and the isolated experimental attachment validator exist. | partial: Python adapter still accepts only inventory-year pages; the isolated attachment validator has its own generic provenance contract. cross-layer receipt predates the reviewed API, and historical receipt excludes later inventory rows, not a later filing/review/premise through the reviewed route. add reproducible reviewed-read walkthroughs. |
| 11 | S1/S2 synthetic SQLite build/read receipts; corrected S1 Postgres publication and concurrency measurements; S2 Postgres import time-limit receipt. | partial: the final S0 constrained browser profile and twenty-minute soak pass in `browser-playwright-s0.json`. no S1 browser profile or hosted large-fixture latency proof. current fixtures model memberships, not mixed predicates/long claim histories. S2 Postgres remains incomplete after the declared 30-minute budget. |
| 12 | tests cover duplicate rows, dense buckets, same-year revisions, corrections, immutable publication/rollback, cursor mismatch, cache bounds and route disposal. topology database tests cover review reversals and additional premises. | partial: do not substitute these unit cases for an S1 mixed-history benchmark. large SQLite first-open checksum cost is outside the old scale query timings; measure it explicitly before making a cold-start claim. |
| 13 | unit tests cover keyboard selection, stable controls/camera, reduced motion, non-color absence text and list fallback; real earlier browser receipts cover selected flows. | partial: new-route touch targeting, emulated media preference, keyboard focus across updates and actual non-GPU fallback need a consolidated browser receipt. a narrow viewport alone is not a touch test. |
| 14 | required CI creates disposable Postgres, runs database tests, and rejects silent skips. snapshot publication reconciles keys, counts, hashes and references; migrations preserve applied history. | supported automated migration/read-derivative checks. full retained evidence-clone reconciliation remains explicitly unavailable in CI; an empty test database is not a substitute. |
| 15 | bounded pages/work/bytes/cache/handles, read-only runtime, text rendering and safe-link primitives. acquisition jobs are separate from public queries. | supported public retained slice; hashes are not redistribution permission. authenticated/restricted evidence is not hosted here. no broad private-data access-control claim. |
| 16 | required CI and production read-health passed for the audited SHA. production receipt checks exact public assets and reviewed build, coherent frame, source drill, and no page errors. the fresh manual public-origin receipt adds missing-build/retry/recovery. | partial release verification: unique production URL was SSO-protected in CI; signed-in PR preview passed previously. Chrome is currently disconnected. automated atlas asset hashing and failure coverage remain incomplete. |
| 17 | PR #16 adds a separately versioned reviewed provider and real typed claim layer through runtime routing and the shared renderer; candidate mappings are explicit. | supported extension demonstration; adding this layer did not rewrite inventory semantics or conflate its clock. |
| 18 | capacity, browser, Postgres, hobby-cost and evidence-limit reports remain in the repository. | partial until remaining measurements and research walkthroughs have results and a final prioritized frontier report. no unlimited-scale or complete-market claim. |

## additional section-level requirements

the checklist is not the entire specification. the following concrete gaps also
remain visible:

- **bounded typed traversal (§6):** inventory has a cycle-safe three-hop,
  100-candidate traversal. reviewed mode has no traversal operation. predicate,
  direction and publication filters are available for reviewed focus/explain,
  but they do not establish a constrained typed-path workflow.
- **coverage (§8):** the existing report distinguishes accepted claims and
  unresolved layers. the new review packet records named-customer leads and
  retained-page modification metadata. no new canonical acceptance is implied.
- **reproducible research (§9):** each walkthrough must retain the exact
  selectors, build/frame IDs, eligible premises and exclusions. preserve old
  receipts as historical outputs; write new reviewed-layer receipts separately.
- **retention/recovery (§5):** immutable SQLite rollback and Postgres staged
  publication are tested. hosted Postgres backup/restore is deferred with the
  user's no-Railway decision. old public SQLite builds require a retention
  decision before removal; no silent expiry is authorized.
- **scale (§10):** a membership fixture is not a mixed-predicate/history fixture.
  at least the supported typed-history subset still needs a bounded scale
  workload. no resource-budget increase or paid deployment is implied.

## authoritative release evidence inspected

- [required application/data run 36211190158](https://github.com/haidmoham/log-pose/actions/runs/36211190158): successful on the audited main SHA.
- [production run 36211205562](https://github.com/haidmoham/log-pose/actions/runs/36211205562): successful; artifact `production-read-health-36211205562` contains the HTTP and six-check Chromium receipts. both were downloaded and inspected for this audit.
- [scheduled production run 36250335041](https://github.com/haidmoham/log-pose/actions/runs/36250335041): successful on the same SHA; this is later availability evidence, not a new release.
- reviewed build: `bb773ae69b9991bed00afcf39948e66660eb4d5d51b8037be174ef273d30e7e7`; inventory build: `990c81ef7202ecab9a0c9bf8185c459537dd1d48d7981d2839a297ed242396b5`.

the production HTTP verifier currently hashes legacy assets and checks the
legacy field API. the browser verifier adds reviewed deep-link and retained
claim checks. neither fact should be widened into an automated hash check of
every atlas asset. the earlier manual atlas asset comparison is separate.

the [manual public-origin receipt](reviewed-production-browser.json) keeps the
two-claim Snowflake/dbt frame, missing-build state with no rendered claims,
and recovery to frame
`73acebb67529aac73ec53ad0b668d98fbbf13dea384460f39620b6079b5d15c9`.
graph and inspector agree before and after recovery. this bounded UI check
does not provide a latency distribution or independently hash served assets.

## canonical import environment

the user accepted the integration at its attributed scope; the decision is
saved in `integration-review-packet.json`. import is still pending. a search
including Git-ignored files located the retained PostgreSQL 18 cluster in the
main checkout's `data/postgres/` (140 MiB) and
`data/logpose-market-2020-2026.dump` (3,006,198 bytes, dated 2026-09-24).
the first search omitted ignored files and therefore missed them.

no Postgres process was running. `postmaster.opts` records the former executable
under `/tmp/log-pose-pg18/`, with port 55439; the runtime must be restored before
read-only inspection and a fresh backup. these filesystem observations locate
the data but do not prove its database contents or reconciliation. do not use
the separate synthetic scale cluster as a canonical evidence replacement.

Docker was checked as another possible storage location. stale runtime sockets
blocked startup; preserving the socket-only directories and recreating them
allowed startup. Docker had only unrelated existing ODS containers/volumes and
was stopped again before the browser measurement. no factory reset, volume
deletion, credential change, evidence recreation, or paid backend occurred.
the user authorized local/Chrome investigation and excluded desktop control.
the remaining canonical work is local database verification, backup, scoped
append-only import, and export reconciliation after the browser run.

## next work and reserved decisions

1. retain the completed S0 browser protocol, thirty passing timing samples and
   twenty-minute soak; failed and interrupted receipts remain separate.
2. add reviewed Python reads and fresh cross-layer/publication-cutoff research
   receipts, including explicit rejection of unsupported historical clocks.
3. add constrained typed traversal and browser accessibility/failure receipts.
4. measure S1 browser and mixed-history workloads inside the existing budget;
   report the first binding constraint and keep unmeasured hosted costs visible.
5. apply the user's explicit integration acceptance through canonical storage,
   immutable rebuilds and a reviewable PR. that decision does not authorize
   broader assertions or product/customer identities.

the user chose bundled SQLite and withdrew Railway provisioning. no paid
resource, acquisition-cap expansion, other semantic acceptance, or future main
merge is authorized by this audit. required PR gates and publication approval
still apply. independent implementation can continue while review is pending.

## release-check follow-up in PR #17

the follow-up implementation adds exact-commit atlas asset hashes to the HTTP
check, a real inventory top-100 browser assertion, and unavailable-build,
retry and history-recovery assertions for both atlas layers. the benchmark's
small contract test now joins `test:atlas` in the required CI job. focused
checker tests pass locally. the expanded browser checks passed CI run 36254562378 on commit `986d129`;
post-merge deployment verification remains pending; this does not retroactively widen the
older production receipts above.

PR #18 independently extends the Python adapter to reviewed reads and retains
fresh cross-layer and publication-cutoff investigations. seven focused tests
pass, including the actual later-filing exclusion. these read-only records
preserve current review semantics and explicitly reject system-known replay;
they do not implement historical review filtering or canonical acceptance.
the Node CLI already routes both providers through `atlas-runtime.js`; only the
Python adapter needed the corresponding clock contract. publication of the new
research support is pending its required checks and approval.

## verified local recovery result

[database-recovery-20260926.json](database-recovery-20260926.json) supersedes the
initial filesystem-only inference above. the original cluster was not started
or edited. all 1,851 files matched an isolated copy before recovery and still
match their original hashes after inspection. PostgreSQL 18.6 was restored from
official Ubuntu packages in a persistent user cache, without a system install.
the copy used a private Unix socket, no TCP listener, unchanged authentication,
and read-only transactions by default. its server is now stopped.

`logpose_market` contains 14 inventory artifacts, 18,076 inventory rows and
6,096 occurrence rows. it has **zero** companies, page snapshots, SEC artifacts,
market files/rows, topology sources, candidates and reviews. `logpose_test` has
the same partial inventory plus 20 company rows. restoring the saved dump into
a separate database succeeded and reproduced the same partial counts.

searches covered the project checkouts including ignored files, WSL cache/local
share/temporary and standard PostgreSQL directories, and Windows Downloads,
Documents and Desktop. no fuller retained-evidence database backup was found.
the synthetic scale cluster cannot fill this gap. Docker remains stopped.
a fresh inventory-only dump and both recovery copies are retained under
`~/.cache/log-pose-evidence-recovery-20260926/`; they are explicitly not full
evidence backups.

the published read projections and three retained topology source bodies remain
available. those projections do not contain every canonical field or raw body:
for example, original entity creation and secondary-evidence arrival times are
not fully recoverable from the public topology shape. a reconstruction would
need an explicit provenance policy for missing values and separately preserved
source families. do not run the full rebuild against the partial database,
invent old timestamps, or label such a reconstruction a verified full restore.
the accepted integration decision remains durable and pending canonical import.
