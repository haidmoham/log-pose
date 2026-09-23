# bounded retrieval pilot, 2021–2024

Checked 2026-09-23. The goal covers two separate questions: what software companies said about their products and buyers, and how the U.S. public equity market and listed companies changed. These observations test access paths. They do not measure the software market yet.

## Historical company pages

Run `.venv/bin/python scripts/probe_commoncrawl.py --output docs/research/commoncrawl-probe.json` from the repo root. The probe checks the three existing curated URLs against **one late-year Common Crawl collection per year**: `CC-MAIN-2021-49`, `CC-MAIN-2022-49`, `CC-MAIN-2023-50`, and `CC-MAIN-2024-51`. It selects a 200 HTML index row dated before that year's end, downloads its WARC record by byte range, checks the WARC source and date against the index, and requires at least 100 normalized visible characters. It retains the locator, capture time, body hash, and failure status. [Common Crawl documents the URL index and record retrieval](https://commoncrawl.org/cdxj-index).

The saved run fetched usable bodies for **10 of 12** company/year cells, including all four years. The two remaining cells, dbt Labs 2022 and Confluent 2023, ended in HTTP 502 index errors after one retry. Other bounded runs got usable bodies for those cells, while different cells sometimes got 502/504 errors. Thus all 12 combinations proved retrievable at least once, but no run established reliable 12/12 access. The saved run transferred 1,101,855 compressed WARC bytes for successful records. The index service's transient failures need bounded retries and attempt logs before scaling.

This sample is selected from already known archived companies, so it cannot estimate market coverage. One crawl per year cannot establish that an absent page was never captured. The 100-character check confirms basic extractability, not useful product or buyer claims. Page quality, redirects, duplicate content, capture age, and Wayback-only coverage still need review.

### Fixed 20-company cohort

The [cohort manifest](pilot-cohort.json) fixes five companies in each of four software categories before archive retrieval. Each company has four planned year-end cells. The first full run used one exact homepage URL and one late-year crawl per cell. After retrying nine index-error cells, that pass yielded **68 extractable / 7 short-text / 5 no exact match** out of 80. Every year had at least 16 extractable pages: 18/20 in 2021, 16/20 in 2022, 17/20 in 2023, and 17/20 in 2024. All nine index errors recovered on retry, which shows why a single request is not a reliable coverage estimate.

The five initial misses mean no eligible exact-homepage index row in the selected crawl. They did not imply that the company was absent from another crawl or historical URL. The seven initial short-text bodies have fewer than 100 normalized visible characters. They are retained with `text_status=short` and their original source bytes. The 68/80 initial figure measures **basic text extractability for this purposive cohort and narrow query**, not software-market coverage or an actionable-claim rate.

A bounded re-fetch inspected all seven short-text cells. Postman 2021–2023 and Palantir 2022–2024 returned nonempty HTML bodies (33–436 KB), titles, several scripts, and **zero** normalized visible characters. They behave as JavaScript shells for the current extractor, rather than missing WARC bodies. GitLab 2022 returned a 1 MB HTML body with only the title, “The One DevOps Platform | GitLab,” as normalized text. An earlier GitLab retry hit HTTP 502 then 504; a later retry fetched the body. These raw artifacts are retained for a later extraction comparison.

The [fixed 16-cell evidence audit](evidence-audit.md) found exact, concrete claims in 15 cells. One cell, GitLab 2022, yielded only a title. That is evidence that reviewed captures can support positioning analysis, not a 15/16 estimate for the broader cohort. The initial run had six WARC bodies explicitly marked `WARC-Truncated: length`; five still contained extractable text. The report records the marker separately from text status so an excerpt is not mistaken for a complete page.

### Bounded recovery

The [12-request recovery plan](recovery-plan.json) tried earlier same-year crawls for short or missed homepages and language-path candidates for three misses. It made 13 index HTTP attempts and transferred 661,224 compressed WARC bytes. Four cells gained extractable same-year text: Snowflake 2022–2024 and CrowdStrike 2024. The Snowflake 2023–2024 language-path bodies are marked truncated, but contain usable source passages. The other eight requests stored short-text bodies; trying an earlier homepage crawl did not fix the Postman or Palantir JavaScript-shell problem or GitLab's truncation. See the [recovery report](recovery-report.json) for the exact URL, crawl, capture time, hash, size, and outcome of every request.

The refreshed [80-cell ingestion report](ingestion-report.json) now has **72 extractable / 8 short-text / 0 unresolved exact-URL misses** after recovery: 18/20, 17/20, 18/20, and 19/20 extractable by year. It records 87 Common Crawl captures across those cells and keeps all earlier attempts. Eight selected captures carry the WARC truncation marker. The extra same-year Snowflake and CrowdStrike passages were checked for concrete product claims in the [evidence audit](evidence-audit.md). Regenerate the report with `DATABASE_URL=... PYTHONPATH=src .venv/bin/python scripts/summarize_ingestion.py --output docs/research/ingestion-report.json`.

A separate [five-cell Wayback check](wayback-recovery-report.json) replayed a verified Snowflake 2022 capture with 9,996 visible characters and a verified Palantir 2021 capture with zero. The Wayback Availability endpoint returned empty results on a later run for the same queries that had previously returned capture timestamps. Three other queries also returned empty results; those responses do **not** establish archive absence. The two verified replays added no new extractable company-year cell beyond Common Crawl. Wayback raw short pages are now retained for later extraction work.

## Public-market activity

Run `.venv/bin/python scripts/probe_cboe.py --output docs/research/cboe-probe.json`. It downloads Cboe's four annual U.S. equities historical market-volume CSVs and checks the schema, year, numeric fields, and row counts. [Cboe describes daily shares, notional value, and trade counts by market center and tape](https://www.cboe.com/markets/us/equities/market-statistics/historical-market-volume) and asks for attribution in published reports.

| Year | Rows | Trading days | Date range |
| --- | ---: | ---: | --- |
| 2021 | 4,788 | 252 | Jan 4–Dec 31 |
| 2022 | 4,769 | 251 | Jan 3–Dec 30 |
| 2023 | 4,750 | 250 | Jan 3–Dec 29 |
| 2024 | 4,786 | 252 | Jan 2–Dec 31 |

Each CSV contained 19 market-participant names. The probe saves source URLs and SHA-256 hashes in `cboe-probe.json`; it does not import the rows into Postgres. This is usable market-wide trading activity, not per-company returns or prices.

The ingestion pilot also stored all four original CSVs and **19,093 typed rows** in Postgres. A repeat import returned four duplicates. Selecting one recorded file hash per year, then summing the 19 market-participant rows by trading date, gives a reproducible first market-level readout (source: [Cboe Exchange, Inc.](https://www.cboe.com/markets/us/equities/market-statistics/historical-market-volume)):

| Year | Mean daily shares, billions | Mean daily notional, USD billions | Mean daily trades, millions | FINRA TRF share of shares |
| --- | ---: | ---: | ---: | ---: |
| 2021 | 11.40 | 564.66 | 68.8 | 43.6% |
| 2022 | 11.87 | 573.09 | 77.5 | 41.9% |
| 2023 | 11.04 | 514.64 | 70.6 | 44.0% |
| 2024 | 12.16 | 607.72 | 77.3 | 47.0% |

The selected hashes are `bb67715f...` (2021), `61051498...` (2022), `17d673f4...` (2023), and `da755580...` (2024); the report has the full hashes. Each statistic divides its annual sum by that year's observed trading-day count. The TRF numerator uses participant names beginning `FINRA /`. These are aggregate equity-market observations across sectors. Today's retrieved CSV version does not establish the value available on each historical trade date. A later revised Cboe file must be selected explicitly; summing across file versions would double-count activity.

## Next acquisition decision

For the eight short-text cells, test dated product pages or other first-party sources and an alternate extractor before expanding the company list. A second homepage crawl produced no useful text for any of those eight cells. The recovery pass yielded four extra extractable cells from 12 requests, but this purposive ratio is an engineering measurement, not a population estimate. Keep the original 80-cell denominator and distinguish a retrieved body, visible text, and a reviewed claim. The public Common Crawl URL index is intended for lookups, not bulk enumeration; use its [columnar URL index](https://commoncrawl.org/url-index) for a measured bulk discovery workload.

Use Cboe for aggregate trading context and SEC filings for public-company reported fundamentals, with filing availability and accession dates controlling as-of queries. [Alpaca says its free plan can query historical consolidated SIP data older than 15 minutes](https://docs.alpaca.markets/us/docs/market-data-faq), but company-level OHLCV remains unverified here because the endpoint requires account credentials. Verify entitlement, symbol history, adjustment behavior, request limits, and use rights in a separate credentialed pilot before depending on it. Keep this market-data layer separate from archived company claims.

## Architecture decision after the pilot

Keep Python and Postgres for this cohort. The next limit is **discovery and evidence quality**, not database throughput. Separate five responsibilities as the corpus grows:

1. A research manifest fixes companies, cutoffs, page purposes, discovery rules, and request budget before acquisition.
2. An acquisition catalog retains candidate index rows, all request attempts, source locators, and immutable raw artifacts. Discovery can then run separately from WARC-body retrieval. For substantial domain-wide filtering, use the Common Crawl columnar index instead of multiplying live exact-URL index requests.
3. Versioned observations link extracted page text, filing facts, and market rows to their original artifact and parser. A new extractor must not silently overwrite old text or invalidate quote offsets.
4. Evidence assertions store exact supporting spans or numeric facts with subject, claim type, capture/event/filing/retrieval dates, and review decision. A vendor homepage statement is evidence of positioning, not verified customer adoption.
5. Analysis builds pin their input artifact versions, entity links, time rules, and transformations. Do not add Cboe revisions together or treat a current CSV as a historical availability vintage.

The company, product, domain, SEC registrant, and traded security need evidence-backed links with validity dates before joining positioning to financials. A ticker or homepage URL is an alias, not a permanent company identifier. For millions of records, raw content can move to content-addressed files/object storage and large analytical scans to Parquet; this pilot does not justify that migration yet. The cohort is purposive and can test retrieval and interpretation methods, but it cannot estimate category shares in the software market.
