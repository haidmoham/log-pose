# bounded retrieval pilot, 2021–2024

Checked 2026-09-23. The goal covers two separate questions: what software companies said about their products and buyers, and how the U.S. public equity market and listed companies changed. These observations test access paths. They do not measure the software market yet.

## Historical company pages

Run `.venv/bin/python scripts/probe_commoncrawl.py --output docs/research/commoncrawl-probe.json` from the repo root. The probe checks the three existing curated URLs against **one late-year Common Crawl collection per year**: `CC-MAIN-2021-49`, `CC-MAIN-2022-49`, `CC-MAIN-2023-50`, and `CC-MAIN-2024-51`. It selects a 200 HTML index row dated before that year's end, downloads its WARC record by byte range, checks the WARC source and date against the index, and requires at least 100 normalized visible characters. It retains the locator, capture time, body hash, and failure status. [Common Crawl documents the URL index and record retrieval](https://commoncrawl.org/cdxj-index).

The saved run fetched usable bodies for **10 of 12** company/year cells, including all four years. The two remaining cells, dbt Labs 2022 and Confluent 2023, ended in HTTP 502 index errors after one retry. Other bounded runs got usable bodies for those cells, while different cells sometimes got 502/504 errors. Thus all 12 combinations proved retrievable at least once, but no run established reliable 12/12 access. The saved run transferred 1,101,855 compressed WARC bytes for successful records. The index service's transient failures need bounded retries and attempt logs before scaling.

This sample is selected from already known archived companies, so it cannot estimate market coverage. One crawl per year cannot establish that an absent page was never captured. The 100-character check confirms basic extractability, not useful product or buyer claims. Page quality, redirects, duplicate content, capture age, and Wayback-only coverage still need review.

## Public-market activity

Run `.venv/bin/python scripts/probe_cboe.py --output docs/research/cboe-probe.json`. It downloads Cboe's four annual U.S. equities historical market-volume CSVs and checks the schema, year, numeric fields, and row counts. [Cboe describes daily shares, notional value, and trade counts by market center and tape](https://www.cboe.com/markets/us/equities/market-statistics/historical-market-volume) and asks for attribution in published reports.

| Year | Rows | Trading days | Date range |
| --- | ---: | ---: | --- |
| 2021 | 4,788 | 252 | Jan 4–Dec 31 |
| 2022 | 4,769 | 251 | Jan 3–Dec 30 |
| 2023 | 4,750 | 250 | Jan 3–Dec 29 |
| 2024 | 4,786 | 252 | Jan 2–Dec 31 |

Each CSV contained 19 market-participant names. The probe saves source URLs and SHA-256 hashes in `cboe-probe.json`; it does not import the rows into Postgres. This is usable market-wide trading activity, not per-company returns or prices.

## Next acquisition decision

Use Common Crawl plus the existing Wayback path for a predeclared, mixed company sample; measure index hits, fetched bodies, usable passages, capture age, and each provider's incremental coverage at all four year-end cutoffs. Review product/buyer claims against exact dated text before classifying markets. Keep failures in the denominator.

Use Cboe for aggregate trading context and SEC filings for public-company reported fundamentals, with filing availability and accession dates controlling as-of queries. [Alpaca says its free plan can query historical consolidated SIP data older than 15 minutes](https://docs.alpaca.markets/us/docs/market-data-faq), but company-level OHLCV remains unverified here because the endpoint requires account credentials. Verify entitlement, symbol history, adjustment behavior, request limits, and use rights in a separate credentialed pilot before depending on it. Keep this market-data layer separate from archived company claims.
