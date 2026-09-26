# reliability and evidence checks

the platform must be available, its data must preserve its evidence, and its presentation must not knowingly mislead. these are related responsibilities with different checks. automation checks declared contracts; people remain accountable for source selection, interpretation, and review.

## what a passing check means

| responsibility | evidence required | what it cannot establish |
| --- | --- | --- |
| platform health | successful build, working routes, correct deployed assets and API responses | every user's network or device is healthy |
| data integrity | retained paths, byte hashes, identifiers, references, counts, and reproducible projections agree | a source publisher was truthful |
| derivation correctness | tested exact joins, filters, pagination, arithmetic, missing-value handling, and stable build IDs | the selected measure answers the research question |
| evidence discipline | preserved source/arrival times, scope, uncertainty, provenance, and explicit review status | an unreviewed lead is an accepted fact |

never repair a failed check by changing retained source bytes to fit the desired answer. fix the code or contract when evidence supports that change; otherwise report the contradiction or missing input. corrections retain the prior source identity and explain the new derivation or review. do not relabel a current capture as historical evidence, replace unknown with zero, remove failed observations from a denominator without disclosure, or present an inventory co-listing as a company relationship.

## before merge

`app-and-data-health` runs on pull requests and `main`. it uses the repository's Node and Python tests, a disposable PostgreSQL service, a read-only retained-data checker, and a deterministic graph rebuild comparison. the report records what was checked, failed, and not evaluated. required failures stop the job. the database is created for the job and never points to production.

the prepared evidence-clone reconciliation test is a separate check. an empty disposable database cannot stand in for the retained evidence clone. CI reports that reconciliation as unavailable unless an explicit prepared clone is supplied through the documented local procedure. this exception is named; the other database integration tests must run successfully rather than disappear as skips.

experimental ML and provisional studies keep their separate explicit test commands. normal CI checks that the application does not require experimental assets. passing canonical checks does not promote an experiment or its conclusions.

`main` requires the application/data check and the Vercel preview build before merge. force pushes and branch deletion are blocked. use a pull request even for a small correction. new source inputs, changed migrations, evidence contracts, and review decisions still need substantive human inspection; required checks are not a substitute for that inspection.

## deployment and observation

Vercel's existing Git integration publishes `main`. CI does not run a second deployment command or mutate ingestion/review data. a successful Vercel production event starts `production-http-smoke`; a manual run must identify the commit being checked. the workflow checks a bounded set of routes and source-detail behavior against the exact deployed commit and graph build.

check the public project alias and the custom domain separately. the unique Vercel deployment URL is also checked when accessible; SSO protection stays enabled and is reported as `not_evaluated` when it prevents this unauthenticated read. a successful deployment event alone does not prove that either public alias serves its bytes. daily checks pin `main` once at the start of the run and retain that expected commit throughout the check. a newer deployment superseding the event is a distinct condition, not evidence that old bytes were successfully served. keep finite retry limits for propagation and transient errors, then fail visibly. never retry forever or silently switch the expected commit to whatever happens to be live.

the HTTP check hashes the atlas HTML, both route implementations, shared model/UI/renderer scripts, and their styles against the selected commit. the browser check exercises the pinned inventory top-100 deep link, reviewed claims and their source trail. for both atlas layers, it also requests an unavailable build, retries the same selector, and returns through browser history to the original graph/inspector frame. these checks do not measure production latency or GPU memory.

the smoke report and CI test reports are retained as run artifacts. a green workflow means those checks passed for that commit at that time. it is not an uptime guarantee, an automatic freshness claim, or a claim that every research statement is true.

## when a check fails

1. read the failing check and its artifact. identify the affected commit, graph build, source IDs, and whether the failure is operational, a data mismatch, or missing evidence.
2. reproduce with the corresponding local command. keep production reads separate from ingestion or review writes.
3. fix code or restore the intended artifact through a reviewed change. if evidence contradicts a published claim, preserve the contradiction and correct the claim explicitly. do not weaken the check to recover a green status.
4. rerun the relevant checks and the deployed smoke check. record residual gaps. rollback is an explicit operator decision; no workflow rewrites evidence or rolls production back automatically.

## local checks

```sh
npm ci
npm run test:dashboard
python3 -m pip install -e '.[test]'
python3 -m pytest -q tests \
  --deselect=tests/test_data_export.py::test_catalog_reconciles_retained_database_and_partitions \
  --junitxml=/tmp/log-pose-pytest.xml
python3 scripts/check_ci_pytest.py /tmp/log-pose-pytest.xml
PYTHONPATH=src python3 scripts/check_data_health.py
npm run build:market-field
git diff --exit-code -- api/data/market-field-graph.json
```

the CI workflow also runs `node --test tests/deployment-health.test.mjs` and an isolated Chromium smoke test. `scripts/check_deployment_health.mjs` accepts `EXPECTED_SHA` (full commit), `PRODUCTION_URL`, `ALIAS_URL`, optional `DEPLOYMENT_URL`, and `REPORT_PATH`; it only permits this project's public origins. use the production workflow's manual dispatch to repeat a release check with its exact commit and deployment URL.

for database integration tests, set `LOG_POSE_TEST_DATABASE_URL` to a disposable PostgreSQL database: the fixtures delete its records. for read-only reconciliation with a prepared evidence clone, use the different variable `LOG_POSE_CATALOG_TEST_DATABASE_URL` and the named catalog reconciliation test. never reuse the prepared clone as the disposable fixture database.

the market-field performance evidence and response limits are in [market-field-service.md](market-field-service.md). browser throttling is emulation, not physical-device measurement. production checks must not imply that an unmeasured device or live latency budget was tested.
