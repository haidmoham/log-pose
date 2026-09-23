# market data sourcing: next work

Checked 2026-09-23. The target is free, actionable, provenance-preserving data for **both** historical software-company/product positioning and public-market financial and price analysis across 2021–2024. The fixed 20-company cohort is a retrieval pilot, not a representative software-market sample. Keep the sourcing goal open until the remaining gates below are verified.

## Verified so far

- [Source landscape](docs/research/source-landscape.md) records candidate access, fields, limits, and use rights. The [pilot results](docs/research/pilot-results.md) record live retrievals for all four years.
- Common Crawl has 72 extractable and 8 short-text homepage cells across the fixed 80-cell cohort. The [ingestion report](docs/research/ingestion-report.json) preserves capture locators, dates, hashes, attempts, and truncation markers. A 16-cell [quote audit](docs/research/evidence-audit.md) found concrete claims in 15 selected cells; it is not a market-wide claim rate.
- Cboe's four 2021–2024 annual files are stored in the isolated Postgres pilot with 19,093 typed market-activity rows. Repeat imports were idempotent. Cboe gives aggregate trading activity, not per-security prices.
- The official SEC companyfacts ZIP yielded ten CIK-bearing members with 12,627,964 bytes transferred from the 1,409,331,196-byte ZIP. The pilot retained 369 annual candidate facts. The [named as-of build](docs/research/sec-analysis-build.json) selects all 120 company/concept/year cells as of 2025-04-01, with accession, filing date, period, unit, tag, member hash, and ZIP version. Forty-four cells' earliest retained filing came after their period-end calendar year. One CrowdStrike revenue value was checked against its original 2024 10-K. See the [SEC pilot note](docs/research/sec-bulk-pilot.md).
- The branch's database-backed test suite passed: `LOG_POSE_TEST_DATABASE_URL=postgresql://127.0.0.1:55434/logpose_test PYTHONPATH=src .venv/bin/pytest -q` (21 tests on 2026-09-23). The isolated local pilot database is `postgresql://127.0.0.1:55434/logpose_pilot`; it is ignored by Git and is not required to read the committed reports.

## Next gates

1. **Historical price access.** Verify one free, permitted daily per-security OHLCV path with real 2021, 2022, 2023, and 2024 bars before adding a price adapter. Alpaca's Basic plan is the leading candidate, but the user has no account, so entitlement and use rights have not been tested. Alpha Vantage's free daily endpoint exposes only the latest 100 rows; Stooq returned browser verification. Keep any credential out of Git and do not publish vendor bars without cleared rights. If the account path remains unavailable, document the gap explicitly rather than substituting aggregate Cboe activity for company returns.
2. **Positioning evidence in the eight short cells.** Test a small, dated list of first-party product/blog pages, beginning with the known 2022 and 2023 Postman articles. Keep those as `product_page` or `company_blog` sources. The homepage report must count only the manifest URL and reviewed homepage aliases; `scripts/summarize_ingestion.py` now enforces this. Review exact claims against stored source text. Do not label a current page as historical without a dated capture.
3. **Financial interpretation.** Check selected revenue, net income, and assets against independent original filings for more than one company and fiscal-calendar pattern. Record any tag conflicts or restatements. The current SEC ZIP is a 2026 retrieval and cannot reproduce the ZIP vintage available at each 2021–2024 cutoff. Add an extraction version before changing the 2021–2024 window or candidate rules under an existing member key.
4. **Identity and scale.** Add dated company/domain/CIK/security links before joining positioning, SEC facts, and prices. After price access and evidence quality are measured, choose a next cohort size and request budget. Use Common Crawl's columnar URL index for bulk URL discovery; the public exact-URL index is for bounded lookups. Do not infer market share or category prevalence from the purposive 20-company cohort.

## Rebuild commands

```bash
DATABASE_URL=postgresql://127.0.0.1:55434/logpose_pilot PYTHONPATH=src .venv/bin/python scripts/summarize_ingestion.py --output docs/research/ingestion-report.json
DATABASE_URL=postgresql://127.0.0.1:55434/logpose_pilot PYTHONPATH=src .venv/bin/python scripts/build_sec_analysis.py --as-of 2025-04-01
LOG_POSE_TEST_DATABASE_URL=postgresql://127.0.0.1:55434/logpose_test PYTHONPATH=src .venv/bin/pytest -q
```

The isolated pilot cluster is under ignored `data/postgres-pilot` on port 55434. Confirm it is running before the commands. Re-fetching source artifacts is unnecessary to rebuild these reports from the existing database.
