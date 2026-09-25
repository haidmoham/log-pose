# Benchmark scorecard

- Benchmark: `benchmark-cases-v1`
- Case manifest SHA-256: `c8f07d0b70686037b7db025ef3950f247239610384f366f42a624e579d85e422`
- Code commit: `95266f4a6ec7b44e32d9cb3596f4bfb87f8b8f2f`
- Run: `offline_deterministic_controls_only`; credentialed models executed: `false`
- Cases: 20 across 7 companies; semantic labels provisional or blocked: 20

## Controls

| Control | Answered | Abstained | Coverage | Temporal violations | Semantic score |
| --- | ---: | ---: | ---: | ---: | --- |
| `capture_aware_exact_span` | 6 | 14 | 0.300 | 0 | not scored |
| `publication_date_only` | 13 | 7 | 0.650 | 7 | not scored |
| `supplied_prediction_fixture` | 5 | 15 | 0.250 | 0 | not scored |

## Case receipts: `capture_aware_exact_span`

| Case | Status | Evidence | Temporal violations | Semantic label |
| --- | --- | --- | --- | --- |
| `case-01` | answered | page:28 | — | provisional |
| `case-02` | answered | page:16 | — | provisional |
| `case-03` | answered | page:12 | — | provisional |
| `case-04` | answered | page:63 | — | provisional |
| `case-05` | answered | page:27 | — | provisional |
| `case-06` | abstained | — | — | provisional |
| `case-07` | abstained | — | — | provisional |
| `case-08` | abstained | — | — | provisional |
| `case-09` | abstained | — | — | blocked |
| `case-10` | abstained | — | — | blocked |
| `case-11` | abstained | — | — | blocked |
| `case-12` | abstained | — | — | blocked |
| `case-13` | abstained | — | — | blocked |
| `case-14` | abstained | — | — | blocked |
| `case-15` | abstained | — | — | blocked |
| `case-16` | abstained | — | — | blocked |
| `case-17` | abstained | — | — | unresolved |
| `case-18` | abstained | — | — | blocked_missing_evidence |
| `case-19` | abstained | — | — | provisional |
| `case-20` | answered | cncf-2024-pinned-snapshot | — | provisional |

## Case receipts: `publication_date_only`

| Case | Status | Evidence | Temporal violations | Semantic label |
| --- | --- | --- | --- | --- |
| `case-01` | answered | page:28 | — | provisional |
| `case-02` | answered | page:16 | — | provisional |
| `case-03` | answered | page:12 | — | provisional |
| `case-04` | answered | page:63 | — | provisional |
| `case-05` | answered | page:27 | — | provisional |
| `case-06` | abstained | — | — | provisional |
| `case-07` | abstained | — | — | provisional |
| `case-08` | answered | page:70 | date_only_eligible_missing_proof | provisional |
| `case-09` | answered | dbt-series-d-2022 | date_only_eligible_missing_proof | blocked |
| `case-10` | abstained | — | — | blocked |
| `case-11` | abstained | — | — | blocked |
| `case-12` | answered | snowflake-fy2024-10k | date_only_eligible_missing_proof | blocked |
| `case-13` | answered | dbt-series-d-2022 | date_only_eligible_missing_proof | blocked |
| `case-14` | answered | dbt-series-d-2022 | date_only_eligible_missing_proof | blocked |
| `case-15` | answered | snowflake-fy2024-10k | date_only_eligible_missing_proof | blocked |
| `case-16` | abstained | — | — | blocked |
| `case-17` | abstained | — | — | unresolved |
| `case-18` | abstained | — | — | blocked_missing_evidence |
| `case-19` | answered | snowflake-fy2024-10k | date_only_eligible_missing_proof | provisional |
| `case-20` | answered | cncf-2024-pinned-snapshot | — | provisional |

## Case receipts: `supplied_prediction_fixture`

| Case | Status | Evidence | Temporal violations | Semantic label |
| --- | --- | --- | --- | --- |
| `case-01` | answered | page:28 | — | provisional |
| `case-02` | answered | page:16 | — | provisional |
| `case-03` | answered | page:12 | — | provisional |
| `case-04` | answered | page:63 | — | provisional |
| `case-05` | answered | page:27 | — | provisional |
| `case-06` | abstained | — | — | provisional |
| `case-07` | abstained | — | — | provisional |
| `case-08` | abstained | — | — | provisional |
| `case-09` | abstained | — | — | blocked |
| `case-10` | abstained | — | — | blocked |
| `case-11` | abstained | — | — | blocked |
| `case-12` | abstained | — | — | blocked |
| `case-13` | abstained | — | — | blocked |
| `case-14` | abstained | — | — | blocked |
| `case-15` | abstained | — | — | blocked |
| `case-16` | abstained | — | — | blocked |
| `case-17` | abstained | — | — | unresolved |
| `case-18` | abstained | — | — | blocked_missing_evidence |
| `case-19` | abstained | — | — | provisional |
| `case-20` | abstained | — | — | provisional |

## Unmeasured

- semantic claim correctness
- forecast skill and calibration
- diligence ranking utility
- research policy value
- investment returns
- causal effects

## Blocked

- contradiction case lacks a retained contradictory source pair
- independent semantic review is unavailable
- historical SEC companyfacts version is not proven as-of its filing date
- portfolio entry terms, ownership, dilution, cash flows, and liquidity are absent

## Verification limits

- Common Crawl raw WARC payloads are referenced but not vendored; the harness recomputes normalized-text and partition hashes and checks the cataloged raw-source digest metadata. Exact source-byte verification needs the retained WARC payload.

## Gates

- Prospective forecasting: **no-go** — no append-only forecast registry or independent resolution process is in place
- Historical portfolio evaluation: **no-go** — entry security and price, allocation access, dated contributions and distributions, dilution and follow-on rules, liquidation preferences, realized liquidity, fees and carry, mature outcome/censoring rules
