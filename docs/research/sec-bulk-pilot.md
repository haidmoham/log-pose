# SEC companyfacts bulk adapter

## Source and access

The adapter reads selected `CIK##########.json` members from the official [SEC companyfacts bulk ZIP](https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip). SEC documentation says this ZIP contains the XBRL Company Facts and Frames API data and is republished nightly; facts in the JSON endpoints are updated as filings are disseminated. See the SEC [EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). The company-specific JSON API at `data.sec.gov/api/xbrl/companyfacts/` remains an alternative when it is reachable.

The initial bounded probe found a roughly 1.4 GB ZIP with byte-range support and 20,395 members. The completed cohort ingestion below verifies the production adapter against the live ZIP.

The range reader requires a declared `SEC_USER_AGENT` (or `--user-agent`) and issues aligned, cached range requests. It pins the exact ETag, Last-Modified value, and Content-Length observed by `HEAD`, sends the ETag as `If-Range`, and rejects changed validators, ignored ranges, encoded responses, mismatched `Content-Range`, or wrong byte counts. It does not download or hash the full ZIP. The saved `artifact_version` is a SHA-256 fingerprint of URL plus those version headers and byte length; it is an artifact identity key, **not** a full-ZIP content hash. SEC's current [fair-access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) sets a maximum of 10 requests per second and asks clients to identify their user agent. The default 0.11-second request interval stays below that rate.

The adapter resolves only exact member names for CIKs in the reviewed cohort. It checks ZIP directory sizes before extraction, caps compressed and uncompressed JSON member size, validates member CIK against the payload, and saves the original JSON bytes with their SHA-256. It stores one member at a time. Range block size and cache size are bounded by defaults in `sec_bulk.py`.

## Facts retained

For each companyfacts member, the pilot retains eligible standard-taxonomy candidates for `revenue`, `net_income`, and `assets`, including both assessed-tax variants of the revenue tag. Revenue and net income need a start/end period from 330 to 400 days; assets need an instant period with no start date. Only annual forms 10-K, 20-F, and 40-F and three-letter monetary units are retained for end years in the requested range (default 2021–2024). The adapter does not choose one value per company and year.

Each fact keeps the taxonomy and tag, group, unit, numeric value, start/end period, filed date, accession, form, fiscal-year / period labels, frame, and its original index within that tag/unit array. Exact fact rows are immutable within a companyfacts member and artifact version; reruns validate the raw-member hash and extracted facts rather than replacing them. Use `filed_date` and accession when a query needs information available by a cutoff. A 10-K can repeat comparative-period facts filed later, and amendments or later filings can change a current bulk member's history. The current extraction is fixed to the 2021–2024 pilot window; a future change to that window or candidate rules needs an extraction version rather than writing different facts under the same member key.

## Use and limits

Run after setting a contact-bearing SEC User-Agent and migrating the database:

```bash
export SEC_USER_AGENT='Log Pose/0.1 name@your-domain.example'
log-pose migrate
log-pose sec-bulk --cohort docs/research/pilot-cohort.json
```

The command reads CIK-bearing cohort rows only (currently ten), unless narrowed with `--slug`. It reports the ETag-derived artifact version, transferred bytes, and range request count.

## Live cohort result (2026-09-23)

The production adapter ingested all ten CIK-bearing companies from the fixed cohort into the isolated `logpose_pilot` database. It retained 369 candidate annual fact observations. Every company has at least one candidate for each of the three concepts in every 2021–2024 period-end year: **120/120 company × concept × year cells**. This is candidate coverage, not 120 comparable, as-of financial values. The SEC ZIP was 1,409,331,196 bytes; the adapter transferred 12,627,964 bytes in 14 requests, including the HEAD request. The ETag-derived artifact version was `195841c02f152dad11e5dd3eb8ee2680fa792a3b13ffcbd760c606491b61ec01`. A second run identified all ten members as duplicates, with no added facts.

The source evidence shows why a selection layer is necessary. CrowdStrike's fiscal year ending 2024-01-31 has revenue under `RevenueFromContractWithCustomerIncludingAssessedTax`: USD 3,055,555,000 in accession `0001535527-24-000007`, filed 2024-03-07. The same value appears again in later filings dated 2025 and 2026. Across the cohort, 117 company/concept/period/unit groups have more than one retained observation. A query must choose a filing cutoff, unit, period, and tag policy and retain the chosen accession and raw-member hash. The currently retrieved nightly ZIP does not reproduce the ZIP vintage available in 2021–2024.

This is a small historical fundamentals adapter. It does not infer a common fiscal year, map CIKs to share classes or tickers, convert currencies, annualize partial periods, or construct as-of SEC artifact vintages. The SEC companyfacts API aggregates standardized entity-wide facts from submissions; it does not replace filing context or guarantee a single universal revenue definition. Tag aliases, accounting standards, units, fiscal calendars, comparative values, and reporting changes still need review before financial comparisons. The adapter does not extract custom taxonomies or dimensional segments, and absence of a selected fact means only that the preferred standard tags in this member did not satisfy the selection rules.

Focused adapter tests use synthetic ZIP files and an in-process range responder. The live cohort run is separate from the disposable test database.
