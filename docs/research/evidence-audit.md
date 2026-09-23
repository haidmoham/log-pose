# fixed-sample homepage evidence audit

Checked 2026-09-23 against the stored Common Crawl HTML and normalized text. The review rule was fixed before reading page passages: take the first company listed in each of the four [cohort](pilot-cohort.json) categories and check all four year cells. This gives Confluent, GitLab, Datadog, and UiPath, 16 cells total. **Fifteen cells contain a concrete product or workflow claim; GitLab 2022 does not.** The review took about five minutes, without stopwatch timing. This purposive sample tests whether the capture path can produce dated claims; it cannot estimate the quality of all 80 cells or market prevalence.

The quotations below are exact spans in the stored normalized text. A homepage statement records the vendor's positioning at capture time. It does not independently verify product use, customer outcomes, or the date when the product feature first became available. Snapshot IDs map to capture locators and hashes in the [ingestion report](ingestion-report.json).

| Company | Year | Snapshot | Claim type | Source quotation |
| --- | ---: | ---: | --- | --- |
| Confluent | 2021 | 3 | Capability/workflow | “connect your apps, systems, and your entire organization with real-time data flow and processing.” |
| Confluent | 2022 | 4 | Capability | “With 120+ connectors, stream processing, security & data governance, and global availability for all of your data in motion needs.” |
| Confluent | 2023 | 62 | Capability | “a secure, cost-effective, and serverless Kafka cluster that autoscales to meet any demand, powered by the Kora engine” |
| Confluent | 2024 | 5 | Workflow | “Shift left by moving processing and governance closer to the source with a complete Data Streaming Platform.” |
| GitLab | 2021 | 16 | Positioning | “Deliver software faster with better security and collaboration in a single platform.” |
| GitLab | 2022 | 72 | No usable claim | Only the 32-character title was extracted; the raw WARC body is truncated inside CSS. |
| GitLab | 2023 | 17 | Capability | “All the essential DevSecOps tools in one place.” |
| GitLab | 2024 | 18 | Capability | “Automate software delivery, boost productivity, and secure your end-to-end software supply chain.” |
| Datadog | 2021 | 28 | Capability | “Analyze and explore your logs for rapid troubleshooting” |
| Datadog | 2022 | 29 | Capability | “Monitor, optimize, and investigate app performance” |
| Datadog | 2023 | 30 | Capability | “Identify potential threats to your systems in real time” |
| Datadog | 2024 | 70 | Capability | “Monitor user journeys and frontend performance in one place” |
| UiPath | 2021 | 46 | Positioning | “We make software robots, so people don’t have to be robots.” |
| UiPath | 2022 | 47 | Workflow | “UiPath streamlines processes, uncovers efficiencies and provides insights” |
| UiPath | 2023 | 48 | Capability | “Deploy and manage AI-powered automation across your enterprise.” |
| UiPath | 2024 | 49 | Capability | “Rapidly build AI-powered automation across any technology.” |

The Datadog feature cards repeat across captures, so these quotes support category coding but do not establish year-to-year changes in those features. Confluent's 2024 quote is present in a WARC body marked `WARC-Truncated: length`; it is valid evidence of that excerpt, not evidence that the full homepage was preserved. Five other stored bodies carry the same truncation marker. The first-eight candidate extractor can over-select navigation, promotions, event headlines, and report teasers; useful Datadog statements appear later in the page. Reviews must inspect the source text beyond those candidates. Customer testimonials and advertised savings are vendor claims, not corroborated outcomes.
