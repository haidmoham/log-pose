# U.S. software company universe, 2021–2024: first research pass

Checked 2026-09-24. This note expands the company discovery problem. The existing [20-company cohort](cohort-notes.md) is a retrieval pilot with five selected companies in each of four overlapping categories: data infrastructure, developer tools, security and observability, and AI and automation. Its 72 extractable homepage cells do not define a market denominator. The first expansion target is **U.S. companies**, public or private, that offered an eligible software product at any point from 2021-01-01 through 2024-12-31. This working rule includes companies later acquired, renamed, or shut down. It needs an explicit review rubric before a market-wide count is published.

## The unit and the boundary

Use a **company-year** as the coverage unit, with separate records for legal entities, products, open-source projects, domains, SEC registrants, and traded securities. A product or project can lead to a candidate company, but it is not automatically one company. Keep category labels overlapping. Store the interval during which the company offered the eligible product and the dated evidence for U.S. location and product fit. Do not use a present-day headquarters, domain redirect, ticker, or directory description to fill a past year silently.

The four pilot labels are broad. Before counting the universe, review examples at their edges: infrastructure services versus applications built on them; developer tools versus agencies; security services versus software; and AI-native products versus ordinary software with an AI feature. Record `included`, `excluded`, or `unresolved` with the reason and dated source. This contract should also decide whether subsidiaries and acquired products count under their historical owner or as independent firms in each year. The working rule is historical control during the observed interval.

## Discovery sources, in order

| Source family | Candidate yield | What it cannot establish alone |
| --- | --- | --- |
| [CNCF landscape](https://github.com/cncf/landscape) and [LF AI & Data landscape](https://github.com/lfai/lfai-landscape), pinned to historical Git commits | Names, product/project categories, websites and repositories in dated curated inventories. CNCF includes closed-source products; LF AI & Data covers many open-source AI/data projects. | A project is not necessarily a company. Inclusion is curated and biased toward visible/open-source ecosystems. Neither file establishes U.S. location or commercial activity in every year. Their generated Crunchbase fields have separate use restrictions; do not import them as generally licensed data. |
| [SEC historical EDGAR indexes](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) and [submissions bulk data](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | In-period filer names, CIKs, forms, filing dates, and original filing paths. This can recover public companies absent from today's ticker mapping. | Filing status is not product eligibility. Current submissions metadata can contain later names/tickers; use in-period filings for historical status. SEC-only discovery omits much of the private universe. |
| [SEC quarterly Form D data](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets) | 2021–2024 issuer and financing-notice candidates, including some private firms outside the landscapes. | It covers specified exempt offerings, not all firms or all venture rounds. Amendments are not new companies or independent rounds; verify issuer identity and original filing. |
| [YC directory](https://www.ycombinator.com/companies) and dated company/investor announcements | Accelerator and investor-specific private candidates, with batches, domains and dated events. | Selection and survival bias. Current categories and status must not be projected backward. Investor pages are discovery leads, not a universal census. |
| [Common Crawl columnar index](https://commoncrawl.org/columnar-index) and [Wayback CDX](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server) | Historical pages for candidate domains, product and buyer evidence, and alias discovery. Use columnar queries for bulk work; the public exact-URL index is for bounded lookups. | Neither web archive is a uniform census of websites. Capture absence is not company absence. |

These sources have different selection mechanisms. Their union can support a high-recall **documented frame**, but no free source above proves a complete U.S. software-company census. Keep that limitation visible in any market-size or prevalence claim.

## Bounded historical-manifest check

I fetched and parsed the original `landscape.yml` from the last identified commits before two year-end cutoffs. The counts below are YAML **items**, which include products, projects, and member entries; they are not unique companies or eligible U.S. firms. The check only establishes that dated inventories can be retrieved and parsed.

| Inventory | 2021 pinned file | 2024 pinned file | Parsed items, 2021 / 2024 |
| --- | --- | --- | ---: |
| CNCF | [2021-12-24](https://github.com/cncf/landscape/blob/f3ff2dc3fd73c9239eb454e189934fb150afb383/landscape.yml) | [2024-12-31](https://github.com/cncf/landscape/blob/e4f13c918275affaefb3dbe1a21a4a8e38ee3842/landscape.yml) | 1,841 / 2,361 |
| LF AI & Data | [2021-12-18](https://github.com/lfai/lfai-landscape/blob/b7bad8d8d544f2a7dca4c933ac76652e0ae5cee0/landscape.yml) | [2024-12-19](https://github.com/lfai/lfai-landscape/blob/9999a5ca4ddae6d202e83606ed6f84b368bc0099/landscape.yml) | 396 / 484 |

For example, the 2021 CNCF file contains MongoDB, Snowflake, GitLab, Datadog, Elastic, and Snyk product entries with homepage URLs. It also contains member and project entries, which demonstrates why row counts cannot become company counts. The 2022 and 2023 files have since been pinned and imported into the [discovery pull](discovery-pull.md). Candidate-level U.S. checks remain open.

## Next bounded run

1. Freeze a versioned eligibility rubric and assemble a candidate union from the four year-end landscape files, SEC historical filing indexes, Form D files, and a bounded set of dated company/investor directories. Keep source file URL, version/hash, candidate row, and discovery date. Include firms that disappeared before 2024.
2. Resolve an initial **50–100 candidates** across the four categories. Include public, private, acquired, discontinued, and bootstrapped examples. Keep product-to-company mapping and name/domain/CIK relationships with validity intervals; queue ambiguous matches for review.
3. For each candidate, find dated first-party evidence for product fit and U.S. boundary. Record the eligible company-years, unresolved company-years, and exclusions. A Git commit date establishes directory inclusion, not product launch or founding.
4. Measure source yield as unique eligible candidates added by each source family, overlap between families, unresolved identity rate, and evidence retrieval rate by company-year. Report each denominator. Hold out one discovery source during the first pass to expose obvious omissions, then add it and measure incremental yield.
5. Only after the frame and error rates are visible, budget the broader historical page pull. The current exact-homepage, one-late-crawl approach should expand to reviewed aliases and dated product, pricing, documentation, changelog, and announcement pages. Keep separate metrics for retrieved HTML, usable text, and supported claims.

The existing [source landscape](source-landscape.md) covers acquisition and market-data rights in detail. Public-company prices remain a separate unresolved access and redistribution question; that gap does not block company-universe research.
