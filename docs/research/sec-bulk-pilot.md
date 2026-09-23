# SEC companyfacts bulk adapter

## Source and access

The adapter reads selected `CIK##########.json` members from the official [SEC companyfacts bulk ZIP](https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip). SEC documentation says this ZIP contains the XBRL Company Facts and Frames API data and is republished nightly; facts in the JSON endpoints are updated as filings are disseminated. See the SEC [EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). The company-specific JSON API at `data.sec.gov/api/xbrl/companyfacts/` remains an alternative when it is reachable.

The project owner reported a bounded probe of the ZIP endpoint: `HEAD` returned HTTP 200 with a roughly 1.4 GB length, ETag, and byte-range support; byte ranges worked. A prototype listed 20,395 members and extracted Confluent, Snowflake, and GitLab members with about 5.3 MB transferred. Those are probe observations, not values assumed by the adapter or a completed ingestion run.

The range reader requires a declared `SEC_USER_AGENT` (or `--user-agent`) and issues aligned, cached range requests. It pins the exact ETag, Last-Modified value, and Content-Length observed by `HEAD`, sends the ETag as `If-Range`, and rejects changed validators, ignored ranges, encoded responses, mismatched `Content-Range`, or wrong byte counts. It does not download or hash the full ZIP. The saved `artifact_version` is a SHA-256 fingerprint of URL plus those version headers and byte length; it is an artifact identity key, **not** a full-ZIP content hash. SEC's current [fair-access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) sets a maximum of 10 requests per second and asks clients to identify their user agent. The default 0.11-second request interval stays below that rate.

The adapter resolves only exact member names for CIKs in the reviewed cohort. It checks ZIP directory sizes before extraction, caps compressed and uncompressed JSON member size, validates member CIK against the payload, and saves the original JSON bytes with their SHA-256. It stores one member at a time. Range block size and cache size are bounded by defaults in `sec_bulk.py`.

## Facts retained

For each companyfacts member, the pilot selects preferred standard-taxonomy tags for `revenue`, `net_income`, and `assets`. It checks the `us-gaap` and `ifrs-full` concept candidates in fixed preference order. Revenue and net income need a start/end period from 330 to 400 days; assets need an instant period with no start date. Only annual forms 10-K, 20-F, and 40-F and three-letter monetary units are selected for end years in the requested range (default 2021–2024).

Each fact keeps the taxonomy and tag, group, unit, numeric value, start/end period, filed date, accession, form, fiscal-year / period labels, frame, and its original index within that tag/unit array. Exact fact rows are immutable within a companyfacts member and artifact version; reruns validate the raw-member hash and extracted facts rather than replacing them. Use `filed_date` and accession when a query needs information available by a cutoff. A 10-K can repeat comparative-period facts filed later, and amendments or later filings can change a current bulk member's history.

## Use and limits

Run after setting a contact-bearing SEC User-Agent and migrating the database:

```bash
export SEC_USER_AGENT='Log Pose/0.1 name@your-domain.example'
log-pose migrate
log-pose sec-bulk --cohort docs/research/pilot-cohort.json
```

The command reads CIK-bearing cohort rows only (currently ten), unless narrowed with `--slug`. It reports the ETag-derived artifact version, transferred bytes, and range request count. It is not run as part of tests or this implementation task; the account/project owner should perform the first live ingestion after review.

This is a small historical fundamentals adapter. It does not infer a common fiscal year, map CIKs to share classes or tickers, convert currencies, annualize partial periods, or construct as-of SEC artifact vintages. The SEC companyfacts API aggregates standardized entity-wide facts from submissions; it does not replace filing context or guarantee a single universal revenue definition. Tag aliases, accounting standards, units, fiscal calendars, comparative values, and reporting changes still need review before financial comparisons. The adapter does not extract custom taxonomies or dimensional segments, and absence of a selected fact means only that the preferred standard tags in this member did not satisfy the selection rules.

Focused adapter tests use synthetic ZIP files and an in-process range responder. A real cohort ZIP download remains an explicitly bounded follow-up, separate from the existing pilot database.
