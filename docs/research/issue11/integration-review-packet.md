# dbt / Snowflake integration proposal

status: **human accepted; canonical import pending**. the user replied “accept
at this attributed scope.” the decision was recorded at
`2026-09-26T15:38:50.335653+00:00`; this is the recording time, not an inferred
earlier message timestamp. no database write or publication has occurred.
prepared on
2026-09-26 against application commit
`72333464855bd6a8003086a92fe89acc9d02ef34`.

## proposed statement

dbt Labs states that dbt data-transformation workloads had existing integrations
with Snowflake products in its announcement bearing publication date 2022-02-24.
the statement does not specify product editions, versions, supported features,
or the integration's start or end.

| field | proposed value |
| --- | --- |
| subject → object | existing reviewed company identities `dbt-labs` → `snowflake` |
| predicate / basis | `integrates_with` / `source_statement` |
| direction | `subject_to_object`, dbt workload → Snowflake products; not a technical data-flow assertion |
| scope | dbt data-transformation workloads with Snowflake products; editions and versions unspecified |
| temporal form | `observed_state`; no event date or validity interval |
| source publication | 2022-02-24, day precision; printed publication date, not an immutable in-period capture |
| source record | `seed-source:dbt-series-d-2022:64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece` |
| review decision / reviewer / time | `accept` / user / recorded `2026-09-26T15:38:50.335653+00:00` |

this uses the ontology's existing allowance for company endpoints with a named
product/workflow scope. it creates no dbt Core, dbt Cloud, or Snowflake product
identity. those finer endpoints need separate evidence and identity review.

## exact evidence and limits

the retained [company announcement](../source-artifacts/topology/dbt-series-d-2022.html)
has SHA-256
`64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece`.
the relevant list item is headed “Deepened partnerships.” its final phrase is:

> existing integrations with AWS, Databricks, Google Cloud, and Snowflake products.

the full list item describes partner products that support dbt transformation
workloads, distinguishes newly added integrations from existing ones, and places
Snowflake in the latter group. the machine-readable
[packet](integration-review-packet.json) binds this passage by normalized-text
hash and locator. the source bytes were checked locally; no new network
acquisition occurred.

the retained HTML reports `dateModified=2024-06-03T22:09:22Z`. Log Pose obtained
the artifact in 2026. this packet cannot prove that the exact wording was online
in February 2022. a publication-cutoff view can expose the source's printed date
under the existing reconstruction contract; an as-known-in-2022 assertion needs
an in-period capture. do not backdate this proposal or its future review.

there is one originating publisher, dbt Labs. a syndicated copy is not a second
independent source. no independent functionality test or contrary source was
checked in this bounded retained-source pass. absence of counterevidence here
does not prove there is none.

acceptance would support this attributed integration statement only. it would
not establish customer adoption, dependency, partnership, payment, revenue,
compatibility today, or continuous availability. the existing partnership and
investment reviews do not serve as reviews of this new predicate.

## decision boundary

the user accepted the statement at the proposed company/workflow scope. preserve
the source and candidate identifiers, record this explicit decision and its
recording time, rebuild through the canonical export and reviewed snapshot, and verify
that earlier immutable builds remain unchanged. production publication still
needs its own reviewed PR and approval. this document performs none of those
mutations.

## additional customer lead

the same announcement's “Customer growth” item names customer accounts:

> accounts including JetBlue, Nasdaq, Lendlease, Dunelm, and Canva.

this corrects the earlier audit's implication that no named-customer evidence
was retained. there is still **no accepted customer claim**. the statement is
attributed to the supplier, discusses growth in 2021, and does not identify
products, contract terms, workloads, or a validity interval. the current
ontology has no customer predicate. retain these names as leads; do not encode
them as partnership or integration claims. a future customer slice needs an
explicit predicate contract, entity review, and narrower evidence where needed.

## acquisition accounting

this pass rechecked one already retained document and the existing ontology,
manifest, accepted export, and identity links. new external documents: **0**.
new canonical entities or claims: **0** pending import. one scoped statement
now has explicit human acceptance. the proposed integration uses two of the
four already reviewed atlas entities. the five quoted customer names are source
mentions, not enrolled expansion-cohort entities. the program's limits remain
25 entities and 100 additional primary documents; issue #2's cohort is unchanged.
