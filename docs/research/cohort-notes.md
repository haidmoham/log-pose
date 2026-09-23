# predeclared company pilot cohort, 2021–2024

## Selection contract

This is a purposive coverage cohort for two linked but distinct analyses: **company and product positioning** from dated company pages, and **public-market context** from exchange/SEC data. It is not a representative market sample or an estimate of category size. We fixed the four strata and five candidates per stratum from company/product descriptions and documented entity events, without querying Common Crawl, Wayback, or other archive coverage to select members.

The data file is a top-level JSON array so the existing Common Crawl probe can consume its `slug` and `url` fields. Each row also retains the ingest fields `name`, `purpose`, and `captures`; `captures` is deliberately empty. A separate retrieval/quality pass must determine actual historical capture timestamps. Empty captures do not mean that archives lack the pages. The `url` is one official homepage candidate per entity, not a claim that this precise URL was canonical in every study year. Redirects, historical aliases, changed page paths, and product domains need dated verification during retrieval.

## Strata and candidates

| Category | Five predeclared candidates |
| --- | --- |
| Data infrastructure | Confluent, Snowflake, MongoDB, ClickHouse, dbt Labs |
| Developer tools | GitLab, Atlassian, Linear, Postman, InVision |
| Security and observability | Datadog, CrowdStrike, Elastic, Snyk, Vanta |
| AI and automation | UiPath, Palantir, Weights & Biases, Replit, DataRobot |

The ten SEC registrants and ten non-registrant/service-history candidates create variation in ownership and public disclosure. This is a cohort-design choice, not an equal-weighted sample of software firms. Product categories overlap in practice; the category is a stable sampling label for this pilot, not an exclusive industry classification.

## Identity and status evidence

For product eligibility, use the official product/company sources on each row in [pilot-cohort.json](pilot-cohort.json). Examples include Confluent's [About page](https://www.confluent.io/about/), Snowflake's [company overview](https://www.snowflake.com/en/company/overview/about-snowflake/), GitLab's [company site](https://about.gitlab.com/), Linear's [Series B announcement](https://linear.app/now/series-b), Postman's [company overview](https://www.postman.com/company/about-postman/), Snyk's [Series G announcement](https://snyk.io/news/snyk-closes-196-5-million-series-g-funding-at-7-4-billion-valuation/), Vanta's [Series C announcement](https://www.vanta.com/resources/vanta-announces-series-c), and UiPath's [RPA product overview](https://www.uipath.com/rpa/robotic-process-automation). The JSON links the remaining members to official company/product pages and their dated funding or SEC records where relevant.

Public CIK values were checked directly against the SEC's [company ticker list](https://www.sec.gov/files/company_tickers.json), except Confluent, whose CIK/name match was verified using its official [SEC submissions record](https://data.sec.gov/submissions/CIK0001699838.json). Ten public entities are represented: Confluent, Snowflake, MongoDB, GitLab, Atlassian, Datadog, CrowdStrike, Elastic, UiPath, and Palantir. CIK establishes the SEC registrant identity; use period-specific filings to set the dates of public status, security class, fiscal period, and disclosure availability. Do not treat today's SEC ticker mapping as a historical constituent list.

Private status notes cite public company financing releases as evidence that the company was privately financed on the release date. A round announcement by itself does not prove ownership status on 2024-12-31, so each row says where cutoff confirmation remains needed. InVision is retained because it provides a verifiable product-lifecycle event: Miro's official [January 2024 transition update](https://miro.com/blog/future-miro-freehand/) says InVision announced design products, including Prototype and DSM, would end on December 31, 2024. The old InVision notice URL now redirects to Miro. The shutdown of those products does not establish that InVision's legal entity dissolved. Miro's official [acquisition announcement](https://miro.com/newsroom/miro-acquires-freehand-app-from-invision/) says it acquired Freehand from InVision in November 2023. These are distinct facts about a product transfer and InVision's other design services.

For identity changes, MongoDB's [company history](https://www.mongodb.com/company/our-story) records its former 10gen name and 2013 company rename. For a post-period acquisition example, CoreWeave's [2025 announcement](https://investors.coreweave.com/news/news-details/2025/CoreWeave-to-Acquire-Weights--Biases---Industry-Leading-AI-Developer-Platform-for-Building-and-Deploying-AI-Applications/default.aspx) says it had reached an agreement to acquire Weights & Biases and expected closing in the first half of 2025; later [CoreWeave product material](https://www.coreweave.com/solutions/ai-model-training) describes the acquisition as completed. The later transaction is recorded as an entity-history caveat and is not used to choose the 2021–2024 candidate.

## Historical identity and URL cautions

- **MongoDB:** the company says its earlier name was 10gen. The current `mongodb.com` homepage is a candidate; the old company name and historical page paths must be checked against dated evidence before a URL join.
- **dbt Labs:** `getdbt.com` is the current candidate. Do not silently merge historical `Fishtown Analytics` references until dated company material confirms entity continuity and the page/domain.
- **InVision / Freehand:** use `invisionapp.com` as the historical homepage candidate for InVision. Freehand moved to Miro in 2023; do not join Miro pages to InVision after the transfer without a product-level continuity rule. InVision's prototype/DSM sunset was announced for December 31, 2024.
- **Weights & Biases:** `wandb.ai/site` is the product/company candidate during the study period. Preserve the standalone company label for 2021–2024, and annotate the 2025 CoreWeave transaction rather than rewriting the cohort row to CoreWeave.
- **All members:** canonical status of the chosen homepage URL for each past year is unknown until redirects, archived redirects, and contemporaneous official links are checked. A live homepage only identifies today's candidate.

## Remaining checks before analysis

1. Resolve archive snapshots for all 20 fixed rows and four year cutoffs, retaining misses and fetch failures in the denominator. Inspect redirects, capture dates, language, duplicate pages, and useful text before classifying product or buyer claims.
2. Verify the official URL/path and historical aliases against dated first-party pages. Preserve both the exact archived URL and the cohort homepage URL as separate values.
3. For each company marked private, verify status from a source that directly establishes status at the chosen cutoff. For each public entity, use its filings and exchange records to construct the in-period listing interval; CIK alone does not establish this interval.
4. Join public-company financial and price series only after ticker/security history, corporate actions, filing dates, and exchange/calendar conventions are resolved. Keep aggregate market activity separate from per-company OHLCV and fundamentals.

The cohort does not encode archive hits, historical capture IDs, later company descriptions as past-tense facts, or unverified CIKs. These remain acquisition and analysis tasks.
