# combined atlas release candidate

status: implemented and locally verified; combined CI and production approval
remain pending. this release does not complete issue #11.

PR #19 includes PR #17 at `fd9d3ff` and PR #18 at `0d4ee9c`, plus the approved
scoped reconstruction. the integrated application revision is `587ba13`.
three test files were then updated to assert the accepted additional claim
across traversal, runtime selection and browser exports.

- inventory top 100 returns and draws the complete bounded page. missing-build
  retry and back navigation preserve the selected version.
- typed traversal retains directions and exact premises, with three-hop and
  100-visited-entity limits. Python research exports preserve each layer's
  build and clock. existing investigation receipts stay pinned to their old build.
- the current reviewed build is
  `710ab7d36a1cca9fc0f55b0c18ba42b963245268f4d614e0089fea2f6cde91bc`: five claims
  total, including three between Snowflake and dbt Labs. the retained old
  `bb773ae69b9991bed00afcf39948e66660eb4d5d51b8037be174ef273d30e7e7` build still
  returns its original two claims for that pair.
- the source catalog is
  `7c9b1952f7c0f9c962251c77a57ad4e093a131338bf35fac1b935dbd30f33802`.
  no inventory, page, SEC or market family was regenerated from a partial DB.

## local verification

- `npm run test:atlas`: 46 passed, zero failed; three PostgreSQL cases are
  skipped locally and must run in the required disposable-database CI job.
- reviewed Python reads and snapshots: 16 passed.
- deployment-health regression checks: seven passed.
- [real browser smoke](browser-combined-s0.json): eleven passed, zero page
  errors; current reviewed evidence/source links, inventory top 100, missing
  build recovery, keyboard, emulated touch, reduced motion and no-WebGL paths.
  the owned local preview process was terminated after this run.
- retained data health: six checked, zero failed, two declared unevaluated
  checks (semantic truth and full retained-database reconciliation).
- changed JS files pass targeted Oxlint. repository-wide legacy findings
  remain recorded in the completion audit.
- the [reconstruction receipt](topology-reconstruction-receipt.json) records
  the separate backup, original-store boundary and nine unknown arrivals.

## release and evidence limits

main is unchanged; merging PR #19 requires user publication approval after
required CI and Vercel checks. the branch retains both feature heads so one
reviewed release can include all three milestones. signed-in preview access
remains unavailable through the current Chrome connection. Vercel Git
integration remains the production deployment authority. SQLite stays bundled;
no Railway resources are deployed.

S0 performance measurements and the twenty-minute soak are retained in the
[performance report](../../atlas-browser-performance.md). they are local
headless measurements, not GPU FPS or hosted cold-start proof. S1 browser,
mixed-predicate/history workloads, S2 PostgreSQL completion, hosted packaging,
and remaining source/relationship reviews remain open in
[the operating envelope](../../atlas-frontier.md).
