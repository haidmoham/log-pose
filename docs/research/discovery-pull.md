# historical discovery pull, 2021–2024

Checked 2026-09-24. `scripts/build_discovery_index.py` pulled eight pinned `landscape.yml` files from [CNCF](https://github.com/cncf/landscape) and [LF AI & Data](https://github.com/lfai/lfai-landscape). It maps exact source category paths to the four Log Pose *candidate tags*, preserves each raw file's SHA-256 and row path, and exports `web/discovery.json`. Cached originals are under ignored `data/discovery/`; `--offline` rebuilds from the reviewed bytes. The script rejects bytes that differ from the recorded hashes.

These are separately maintained inventories, but both sit in the Linux Foundation ecosystem. Their overlap is not independent sampling evidence and cannot estimate market coverage. The export has no retrieval timestamp, so the same pinned bytes and review file produce identical JSON bytes on an offline rebuild.

| Source | 2021 items / mapped | 2022 | 2023 | 2024 |
| --- | ---: | ---: | ---: | ---: |
| CNCF | 1,841 / 441 | 2,148 / 526 | 2,302 / 606 | 2,361 / 729 |
| LF AI & Data | 396 / 259 | 413 / 273 | 466 / 295 | 484 / 303 |

The pull contains **3,432 mapped source occurrences** and **1,111 distinct candidate keys** after grouping exact normalized name and full homepage/repository URL. These are products or projects, not verified companies. A changed URL can split one product, and the same homepage can host several products. Only seven exact name-and-homepage matches to the separate 20-company pilot are exposed as *possible navigation links*. No historical ownership or U.S. location is inferred from those links. Category counts overlap; four year-end inventory versions miss entries added and removed between cutoffs.

The 20-row fixed challenge set in `scripts/audit_discovery.py` was checked against the original pinned YAML files. **20/20 matched** name, description, homepage, category path, row position, and artifact hash. The table records the initial identity risk read. The separate `challenge-identity-reviews.json` now records a dated first-party relationship review for each row. Neither check is a market-wide eligibility or accuracy estimate.

| Candidate | Mapped tag | Identity review observation |
| --- | --- | --- |
| MongoDB | Data infrastructure | Company-like name and site; U.S. history still needs dated evidence. |
| Snowflake | Data infrastructure | Company-like name and site; U.S. history still needs dated evidence. |
| Weaviate | Data infrastructure / AI | Three directory keys share a reviewed 2023 rename and site migration. U.S. location remains unreviewed. |
| Milvus | Data infrastructure / AI | Project release links Zilliz as developer; ownership and U.S. location remain separate. |
| DVC | Data infrastructure | Iterative identifies DVC as its project; company eligibility remains separate. |
| GitLab | Developer tools | Provider link reviewed; U.S. base decision unresolved because the company declares no headquarters. |
| LaunchDarkly | Developer tools | Provider link reviewed; present in 2023–2024 inventories only. |
| 3Scale | Developer tools | Product link reviewed to Red Hat; no separate 3Scale company inferred. |
| Jenkins | Developer tools | Community project with a CloudBees distribution; no exclusive owner inferred. |
| Backstage | Developer tools | Community project with Spotify paid plugins; project stays separate. |
| Snyk | Security / observability | Company-like name and site; period-specific location remains unreviewed. |
| Datadog | Security / observability | Company-like name and site; source category changes from Monitoring to Observability. |
| Elastic | Security / observability | Company-like name and site; source category changes from Logging to Observability. |
| OpenTelemetry | Security / observability | CNCF project with no single provider inferred from its row. |
| Vault | Security / observability | Product link reviewed to HashiCorp; licensing changed in 2023. |
| Mlflow | AI / automation | Source spells the name `Mlflow`; Databricks managed service is distinct from the project. |
| Kubeflow | AI / automation | Community project with multiple distributions; no single provider inferred. |
| AutoGen | AI / automation | Research framework; no independent company or paid offering inferred. |
| Acumos | AI / automation | Foundation project; sponsors are not counted as its company. |
| TensorFlow | AI / automation | Community framework; Google origin is not a separate TensorFlow company. |

The identity review links **22 raw candidate keys to 20 review decisions**. Fifteen decisions name a provider relationship, including product lines and nonexclusive commercial distributions; five retain a project with no single provider. The [Weaviate company newsletter](https://newsletter.weaviate.io/p/jan-2023-new-year-changes) supports grouping its three source keys at the reviewed identity layer after the SeMI Technologies rename. Original source rows and raw candidate keys remain intact. A provider relationship never by itself proves legal ownership, a distinct company, U.S. location, or eligibility. Six reviews link to the selected company pilot; three of those have documented U.S. bases, one is unresolved, and two lack a location review. Two additional provider leads have dated U.S. operating-base evidence: [Iterative describes itself as based in San Francisco in 2021](https://www.globenewswire.com/news-release/2021/06/02/2240670/0/en/mlops-company-iterative-raises-20-million-series-a-funding-led-by-468-capital.html), and [LaunchDarkly lists Oakland and Atlanta hubs in 2021](https://launchdarkly.com/blog/launchdarkly-2021-galaxy-conference-20-trillion-feature-flags-hiring/). Hubs are not relabeled as headquarters. A location observation supports only its source year.

The search interface uses the original occurrence's text and tags for year/source filters. It can also match a reviewed provider or alias, but only in the review source year when a year filter is active. This avoids matching a 2021 row with an identity claim first sourced in 2024. It also searches short dated excerpts from the separately sourced pilot pages and links matching archived pages. Aggregation counts distinct directory candidate keys, reviewed provider groups, and selected pilot companies separately, with source years labeled by unit. Years and tags overlap. The resulting counts are not a company census or market-size estimate.

## Financing announcements in the pilot

Four selected company announcements are linked to their pilot records: [DataRobot, 2021](https://www.datarobot.com/newsroom/press/datarobot-unveils-major-milestones-including-300m-series-g-funding-investment/), [dbt Labs, 2022](https://www.getdbt.com/blog/dbt-labs-raises-222m-in-series-d-funding-at-4-2b-valuation-led-by-altimeter-with-participation-from-databricks-and-snowflake), [Linear, 2023](https://linear.app/now/series-b), and [Vanta, 2024](https://www.vanta.com/resources/vanta-announces-series-c). The curated records are in `financing-announcements.json`; the dashboard exporter checks that each event is in the study period and attached to a known pilot slug. Search can filter the pilot to companies with an announcement, including by announcement year. These are company-reported round and valuation claims. The selection does not establish that other pilot companies had no financing.

## Reviewed U.S. location evidence

The 12-record `us-location-reviews.json` checks three selected pilot companies per category against dated first-party filings or announcements. Eleven have an explicit U.S. headquarters or principal executive office statement. [GitLab's FY2024 filing](https://www.sec.gov/Archives/edgar/data/1653482/000162828024012963/gtlb-20240131.htm) says it is remote-only and has no headquarters, so its location decision remains unresolved. A Delaware incorporation or service-agent address is not treated as an operating base. [Snowflake's FY2024 filing](https://www.sec.gov/Archives/edgar/data/1640147/000164014724000101/snow-20240131.htm) designates a Bozeman principal executive office while saying it has no corporate headquarters; [Atlassian's FY2024 filing](https://www.sec.gov/Archives/edgar/data/1650372/000165037224000036/team-20240630.htm) lists a San Francisco principal executive office while discussing a planned Sydney global headquarters. Those distinctions stay visible in search and company detail.

The review supports a **dated U.S. base observation**, not continuous U.S. status across 2021–2024, legal domicile, beneficial ownership, or a representative sample of the market. The source notes are paraphrases of the linked filings/announcements. The DataRobot location source is [ITOCHU's 2022 partnership announcement](https://www.itochu.co.jp/en/news/press/2022/220810.html), which explicitly identifies DataRobot, Inc. as Boston headquartered. The exporter checks review cardinality, category balance, source year, decision and location-kind consistency. Human source reading is still the substantive review.

## Financing and company review still needed

The [SEC Form D quarterly files](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets) are a distinct primary source for financing *notices*, issuer CIKs and addresses. The official 2024 Q4 ZIP returned HTTP 403 for GET and HEAD from this runtime on this pass, so **no Form D records were imported**. The existing SEC companyfacts series covers ten public pilot companies. Form D notices, companyfacts, stock prices, and company claims must remain separate until reviewed CIK/security links exist. Form D reported amounts are not round size or valuation by default.

The next material step is a dated company-link review: resolve product/project ownership, historical U.S. location, name/domain changes, and broader financing evidence for a bounded set of high-value leads. This would turn search leads into defensible company records and unlock financing/performance filters beyond the current public pilot. The source repositories' generated Crunchbase fields carry separate restrictions; this pull does not import them. See the [CNCF](https://github.com/cncf/landscape#license) and [LF AI & Data](https://github.com/lfai/lfai-landscape#license) source terms.
