# Benchmark scorecard

- Benchmark: `benchmark-cases-v1`
- Case manifest SHA-256: `c8f07d0b70686037b7db025ef3950f247239610384f366f42a624e579d85e422`
- Code commit: `511e7449d51f33ec3388c39c7a58cf3f6ee5c29e`
- Run: `offline_deterministic_controls_only`; credentialed models executed: `false`
- Cases: 20 across 7 companies; semantic labels provisional or blocked: 20

## Controls

| Control | Answered | Abstained | Coverage | Temporal violations | Calls / tokens / ms | Semantic score |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `capture_aware_exact_span` | 6 | 14 | 0.300 | 0 | 0 / 0 / 0 | not scored |
| `publication_date_only` | 13 | 7 | 0.650 | 7 | 0 / 0 / 0 | not scored |
| `supplied_prediction_fixture` | 5 | 15 | 0.250 | 0 | 0 / 0 / 0 | not scored |

## Case receipts: `capture_aware_exact_span`

| Case | Run status | Evidence | Temporal violations | Evaluator status | Semantic label |
| --- | --- | --- | --- | --- | --- |
| `case-01` | answered | page:28 | — | source_stated_marketing_claim | provisional |
| `case-02` | answered | page:16 | — | company_homepage_statement | provisional |
| `case-03` | answered | page:12 | — | company_homepage_statement | provisional |
| `case-04` | answered | page:63 | — | company_homepage_statement | provisional |
| `case-05` | answered | page:27 | — | historical_company_page | provisional |
| `case-06` | abstained | — | — | insufficient_retained_text | provisional |
| `case-07` | abstained | — | — | insufficient_retained_text | provisional |
| `case-08` | abstained | — | — | captured_before_but_ingested_after_cutoff | provisional |
| `case-09` | abstained | — | — | old_publication_date_without_version_proof | blocked |
| `case-10` | abstained | — | — | post_cutoff_filing | blocked |
| `case-11` | abstained | — | — | SEC_fact_retrieved_later | blocked |
| `case-12` | abstained | — | — | historical_filing_version_proof | blocked |
| `case-13` | abstained | — | — | event_before_cutoff_publication_before_cutoff_but_version_unknown | blocked |
| `case-14` | abstained | — | — | 2026_topology_review_not_known_at_cutoff | blocked |
| `case-15` | abstained | — | — | hypothesis_not_supported_relationship | blocked |
| `case-16` | abstained | — | — | identity_alias_review_arrived_later | blocked |
| `case-17` | abstained | — | — | no_claim_found_in_frozen_slice | unresolved |
| `case-18` | abstained | — | — | contradictory_pair_not_retained | blocked_missing_evidence |
| `case-19` | abstained | — | — | accepted_hypothesis_not_calibrated_probability | provisional |
| `case-20` | answered | cncf-2024-pinned-snapshot | — | co_listing_is_not_economic_relationship | provisional |

## Case receipts: `publication_date_only`

| Case | Run status | Evidence | Temporal violations | Evaluator status | Semantic label |
| --- | --- | --- | --- | --- | --- |
| `case-01` | answered | page:28 | — | source_stated_marketing_claim | provisional |
| `case-02` | answered | page:16 | — | company_homepage_statement | provisional |
| `case-03` | answered | page:12 | — | company_homepage_statement | provisional |
| `case-04` | answered | page:63 | — | company_homepage_statement | provisional |
| `case-05` | answered | page:27 | — | historical_company_page | provisional |
| `case-06` | abstained | — | — | insufficient_retained_text | provisional |
| `case-07` | abstained | — | — | insufficient_retained_text | provisional |
| `case-08` | answered | page:70 | date_only_eligible_missing_proof | captured_before_but_ingested_after_cutoff | provisional |
| `case-09` | answered | dbt-series-d-2022 | date_only_eligible_missing_proof | old_publication_date_without_version_proof | blocked |
| `case-10` | abstained | — | — | post_cutoff_filing | blocked |
| `case-11` | abstained | — | — | SEC_fact_retrieved_later | blocked |
| `case-12` | answered | snowflake-fy2024-10k | date_only_eligible_missing_proof | historical_filing_version_proof | blocked |
| `case-13` | answered | dbt-series-d-2022 | date_only_eligible_missing_proof | event_before_cutoff_publication_before_cutoff_but_version_unknown | blocked |
| `case-14` | answered | dbt-series-d-2022 | date_only_eligible_missing_proof | 2026_topology_review_not_known_at_cutoff | blocked |
| `case-15` | answered | snowflake-fy2024-10k | date_only_eligible_missing_proof | hypothesis_not_supported_relationship | blocked |
| `case-16` | abstained | — | — | identity_alias_review_arrived_later | blocked |
| `case-17` | abstained | — | — | no_claim_found_in_frozen_slice | unresolved |
| `case-18` | abstained | — | — | contradictory_pair_not_retained | blocked_missing_evidence |
| `case-19` | answered | snowflake-fy2024-10k | date_only_eligible_missing_proof | accepted_hypothesis_not_calibrated_probability | provisional |
| `case-20` | answered | cncf-2024-pinned-snapshot | — | co_listing_is_not_economic_relationship | provisional |

## Case receipts: `supplied_prediction_fixture`

| Case | Run status | Evidence | Temporal violations | Evaluator status | Semantic label |
| --- | --- | --- | --- | --- | --- |
| `case-01` | answered | page:28 | — | source_stated_marketing_claim | provisional |
| `case-02` | answered | page:16 | — | company_homepage_statement | provisional |
| `case-03` | answered | page:12 | — | company_homepage_statement | provisional |
| `case-04` | answered | page:63 | — | company_homepage_statement | provisional |
| `case-05` | answered | page:27 | — | historical_company_page | provisional |
| `case-06` | abstained | — | — | insufficient_retained_text | provisional |
| `case-07` | abstained | — | — | insufficient_retained_text | provisional |
| `case-08` | abstained | — | — | captured_before_but_ingested_after_cutoff | provisional |
| `case-09` | abstained | — | — | old_publication_date_without_version_proof | blocked |
| `case-10` | abstained | — | — | post_cutoff_filing | blocked |
| `case-11` | abstained | — | — | SEC_fact_retrieved_later | blocked |
| `case-12` | abstained | — | — | historical_filing_version_proof | blocked |
| `case-13` | abstained | — | — | event_before_cutoff_publication_before_cutoff_but_version_unknown | blocked |
| `case-14` | abstained | — | — | 2026_topology_review_not_known_at_cutoff | blocked |
| `case-15` | abstained | — | — | hypothesis_not_supported_relationship | blocked |
| `case-16` | abstained | — | — | identity_alias_review_arrived_later | blocked |
| `case-17` | abstained | — | — | no_claim_found_in_frozen_slice | unresolved |
| `case-18` | abstained | — | — | contradictory_pair_not_retained | blocked_missing_evidence |
| `case-19` | abstained | — | — | accepted_hypothesis_not_calibrated_probability | provisional |
| `case-20` | abstained | — | — | co_listing_is_not_economic_relationship | provisional |

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
