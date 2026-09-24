# historical discovery pull, 2021–2024

Checked 2026-09-24. `scripts/build_discovery_index.py` pulled eight pinned `landscape.yml` files from [CNCF](https://github.com/cncf/landscape) and [LF AI & Data](https://github.com/lfai/lfai-landscape). It maps exact source category paths to the four Log Pose *candidate tags*, preserves each raw file's SHA-256 and row path, and exports `web/discovery.json`. Cached originals are under ignored `data/discovery/`; `--offline` rebuilds from the reviewed bytes. The script rejects bytes that differ from the recorded hashes.

| Source | 2021 items / mapped | 2022 | 2023 | 2024 |
| --- | ---: | ---: | ---: | ---: |
| CNCF | 1,841 / 441 | 2,148 / 526 | 2,302 / 606 | 2,361 / 729 |
| LF AI & Data | 396 / 259 | 413 / 273 | 466 / 295 | 484 / 303 |

The pull contains **3,432 mapped source occurrences** and **1,111 distinct candidate keys** after grouping exact normalized name and full homepage/repository URL. These are products or projects, not verified companies. A changed URL can split one product, and the same homepage can host several products. Only seven exact name-and-homepage matches to the separate 20-company pilot are exposed as *possible navigation links*. No historical ownership or U.S. location is inferred from those links. Category counts overlap; four year-end inventory versions miss entries added and removed between cutoffs.

The 20-row fixed challenge set in `scripts/audit_discovery.py` was checked against the original pinned YAML files. **20/20 matched** name, description, homepage, category path, row position, and artifact hash. The table records a manual identity-risk read of those same rows. It is not an eligibility or accuracy estimate.

| Candidate | Mapped tag | Identity risk visible at this stage |
| --- | --- | --- |
| MongoDB | Data infrastructure | Company-like name and site; U.S. history still needs dated evidence. |
| Snowflake | Data infrastructure | Company-like name and site; U.S. history still needs dated evidence. |
| Weaviate | Data infrastructure / AI | Several source URLs split one apparent product; resolve aliases before counting. |
| Milvus | Data infrastructure / AI | Project-to-commercial-vendor relationship needs review. |
| DVC | Data infrastructure | Tool-to-commercial-vendor relationship needs review. |
| GitLab | Developer tools | Company-like name and site; period-specific location remains unreviewed. |
| LaunchDarkly | Developer tools | Company-like name and site; present in 2023–2024 inventory versions only. |
| 3Scale | Developer tools | Product-to-company relationship needs review. |
| Jenkins | Developer tools | Community project should not become a company automatically. |
| Backstage | Developer tools | Open-source project should not become a company automatically. |
| Snyk | Security / observability | Company-like name and site; period-specific location remains unreviewed. |
| Datadog | Security / observability | Company-like name and site; source category changes from Monitoring to Observability. |
| Elastic | Security / observability | Company-like name and site; source category changes from Logging to Observability. |
| OpenTelemetry | Security / observability | Community project should not become a company automatically. |
| Vault | Security / observability | Product-to-company relationship needs review. |
| Mlflow | AI / automation | Source spells the name `Mlflow`; project/vendor relationship needs review. |
| Kubeflow | AI / automation | Community project should not become a company automatically. |
| AutoGen | AI / automation | Project/vendor relationship needs review; first mapped in the 2023 file. |
| Acumos | AI / automation | Project/vendor relationship needs review. |
| TensorFlow | AI / automation | Framework should not become a company automatically. |

The search interface uses the original occurrence's text and tags for year/source filters. This avoids matching a 2021 record with a description first present in 2024. Aggregation counts distinct candidate keys matching the current query and filters, with overlapping tags and years shown explicitly. The existing pilot company and SEC-fact counts use separate units.

## Financing announcements in the pilot

Four selected company announcements are linked to their pilot records: [DataRobot, 2021](https://www.datarobot.com/newsroom/press/datarobot-unveils-major-milestones-including-300m-series-g-funding-investment/), [dbt Labs, 2022](https://www.getdbt.com/blog/dbt-labs-raises-222m-in-series-d-funding-at-4-2b-valuation-led-by-altimeter-with-participation-from-databricks-and-snowflake), [Linear, 2023](https://linear.app/now/series-b), and [Vanta, 2024](https://www.vanta.com/resources/vanta-announces-series-c). The curated records are in `financing-announcements.json`; the dashboard exporter checks that each event is in the study period and attached to a known pilot slug. Search can filter the pilot to companies with an announcement, including by announcement year. These are company-reported round and valuation claims. The selection does not establish that other pilot companies had no financing.

## Financing and company review still needed

The [SEC Form D quarterly files](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets) are a distinct primary source for financing *notices*, issuer CIKs and addresses. The official 2024 Q4 ZIP returned HTTP 403 for GET and HEAD from this runtime on this pass, so **no Form D records were imported**. The existing SEC companyfacts series covers ten public pilot companies. Form D notices, companyfacts, stock prices, and company claims must remain separate until reviewed CIK/security links exist. Form D reported amounts are not round size or valuation by default.

The next material step is a dated company-link review: resolve product/project ownership, historical U.S. location, name/domain changes, and broader financing evidence for a bounded set of high-value leads. This would turn search leads into defensible company records and unlock financing/performance filters beyond the current public pilot. The source repositories' generated Crunchbase fields carry separate restrictions; this pull does not import them. See the [CNCF](https://github.com/cncf/landscape#license) and [LF AI & Data](https://github.com/lfai/lfai-landscape#license) source terms.
