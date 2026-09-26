# Issue 11 retained layer evidence review

Review date: 2026-09-25. This is a read-only audit of retained records. It adds
no claim, identity decision, or canonical evidence. “Accepted” below means an
existing explicit review accepted the stated, bounded claim. It does not widen
that claim or establish present validity.

2026-09-26 correction: the retained dbt announcement's “Customer growth” item
does name customer accounts. the original pass below correctly found no
accepted customer claim, but missed these source mentions. the
[integration review packet](integration-review-packet.md) binds the integration
and customer passages and records their remaining identity, scope, time, and
review limits. no claim or identity was accepted by this correction.

## Result by research layer

| Layer | Retained support | Review state | Material gap |
| --- | --- | --- | --- |
| Products, buyers, and workflows | Exact CNCF/LFAI placements; Datadog names Elastic as a log-management competitor; dbt announcement names customer accounts | One accepted competitor claim; inventory placements and customer mentions remain leads | No retained reviewed buyer/customer relationship; category overlap does not prove substitution |
| Technology and integrations | dbt Labs announcement describes existing Snowflake integrations | Source retained, but no separately reviewed `integrates_with` claim | Direction, product endpoints, integration scope, event/validity time, and current status need review |
| Commercial relationships | dbt Labs announcement says dbt Labs and Snowflake were deepening a partnership and serving joint customers | Accepted dated `announced_partnership_with` claim | No named-customer claim, contract value, exclusivity, revenue contribution, or present-validity finding |
| Capital and ownership | Same announcement names Snowflake as a Series D strategic investor; four financing announcements are indexed | One accepted `invested_in` claim for Snowflake→dbt Labs | Ownership percentage, governance rights, continuing holdings, acquisition/ownership relations, and participant claims for the other rounds are unsupported |
| Historical development | Fourteen pinned CNCF/LFAI revisions from 2020–2026; dated claim events and filing periods | Source observations are retained; four topology claims have accepted reviews under their stated clocks | Observation history is not relationship validity, operational replay, founding, entry, exit, or continuous presence |

## Exact retained records

### Products, buyers, and workflows

Accepted claim
`datadog-named-competitor-elastic-log-management-2024` has database ID
`seed-claim:datadog-named-competitor-elastic-log-management-2024:929d80cd58d5`,
predicate `named_competitor_of`, status `documented`, and accepted review ID 1
dated 2026-09-24. Its scope is Datadog fiscal-2024 log management. The source
record is
`seed-source:datadog-2024-10k:711ee14f238f3e12597a03d889b7d8c29785eee865e1cecd8e20e0578a67facf`,
manifest ID `datadog-2024-10k`, SHA-256
`711ee14f238f3e12597a03d889b7d8c29785eee865e1cecd8e20e0578a67facf`,
at [the retained filing](../source-artifacts/topology/datadog-2024-10k.html).
The locator is Form 10-K, Item 1, “Our Competition,” printed page 11.

The inventory contains reviewed candidate-to-company identity links but
unreviewed relationship semantics. Examples are Datadog candidate
`4d9ade2bfb2aa6cb4afb`, identity review `identity-review-12`, and Elastic
candidate `0b53be52084e857862ac`, identity review `identity-review-13`. Their
retained CNCF occurrence IDs include Datadog
`e3c312df09b33814bd5b` and Elastic `678ca0057c1d627e628c` in the 2020 artifact
SHA-256 `9b14a66831a391b1d15ee0068e9acbea06a119c26c9aaf2903e02246aaf38577`.
These exact placements support navigation only. They do not add competition,
buyer, customer, or switching claims.

Review needed: keep the existing competitor acceptance at its current scope.
Any product/workflow alternative claim needs reviewed company/product
identities, a named workflow and user, primary evidence of substitutability,
time basis, counterevidence, and a separate accept/reject decision. A buyer or
customer edge needs a named customer source and explicit contract/use scope.

### Technology and integrations

Manifest source `dbt-series-d-2022`, SHA-256
`64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece`,
is [retained locally](../source-artifacts/topology/dbt-series-d-2022.html).
Topology source record
`seed-source:dbt-series-d-2022:64694c906f3c8be8b3fd90d88725fe3598a896533adf3123a24dc684610ffece`
summarizes the announcement’s statement that existing integrations connected
dbt with Snowflake products. The accepted records derived from this source are
partnership and investment claims. There is no accepted `integrates_with`
record in the public topology projection.

Review needed: create a distinct candidate claim only after a reviewer verifies
the exact passage, integration endpoints and direction, product versus company
identity, source date, whether the statement is an event or observed state, and
what it does not imply about dependency, adoption, partnership, revenue, or
present availability. The decision must be separate from review ID 2’s
partnership acceptance.

### Commercial relationships

Accepted claim `dbt-labs-announced-partnership-snowflake-2022`, database ID
`seed-claim:dbt-labs-announced-partnership-snowflake-2022:14301c1bd839`, uses
the same retained dbt source and accepted review ID 2 dated 2026-09-24. Its
event date is 2022-02-24 and its scope is joint analytics-engineering workflows.
The claim explicitly leaves start date, current status, exclusivity, commercial
terms, and results unknown. “Joint customers” is aggregate wording; it does not
identify or establish any customer edge.

Review needed: no change is required for the bounded announcement claim. A
current partnership assertion needs newer primary evidence and a validity
decision. Each customer relation needs a named customer story or announcement,
the products/workload, publication and described-event times, evidence role,
and an independent review. Logo presence alone is insufficient.

### Capital and ownership

Accepted claim `snowflake-invested-in-dbt-labs-series-d-2022`, database ID
`seed-claim:snowflake-invested-in-dbt-labs-series-d-2022:14301c1bd839`, uses
accepted review ID 3 and the dbt source above. It establishes Snowflake’s
announced participation in dbt Labs’ Series D on 2022-02-24. It explicitly does
not establish the amount invested by Snowflake, ownership percentage,
governance rights, later holdings, or a continuing strategic relationship.

[The financing index](../financing-announcements.json) also has dated company
announcement rows for DataRobot Series G (2021-07-27), dbt Labs Series D
(2022-02-24), Linear Series B (2023-09-14), and Vanta Series C (2024-07-24).
Those rows have source URLs but no retained body hash or claim review in this
file. They support navigation to financing announcements, not participant,
ownership, or acquisition edges.

Review needed: retain Snowflake→dbt Labs at financing-participation scope. For
the other rounds, retain and hash the primary body, extract exact participant
passages, resolve participant identities, distinguish total round size from
participant amount, and review each scoped participation claim. No acquisition
or current-ownership record should be accepted without transaction-specific
primary evidence, event/closing distinction, ownership scope, and a separate
review.

### Historical development

The retained inventory has fourteen immutable source artifacts: CNCF and LFAI
for each year 2020–2026. [The discovery projection](../../../web/data/topology-discovery.json)
binds every occurrence to source, inventory year, exact category, occurrence
ID, and raw artifact SHA-256. Representative CNCF hashes are 2020
`9b14a66831a391b1d15ee0068e9acbea06a119c26c9aaf2903e02246aaf38577`,
2024 `f1036cb6b8e9b9ef7647a0203ac349ba308173bf407f79cc8ccd4d4a2e7d46fd`,
and 2026 `23b2b56cf6cb60d48b7f0923a527ebd9aac1e3418d30ce593ff7739cc8483e9b`.
Representative LFAI hashes are 2020
`7bff0e731a826d45fe71f1793e19c850ac3f1640ebcb62c83c82a84876e1dd09`
and 2026 `8a929756135009f7373b9c4b0a8a1a965f681f70972eefdaa39336774619a378`.

The reviewed topology also preserves distinct event, reporting-period,
retrieval, and review clocks. The accepted Datadog/Snowflake
`shared_exposure_hypothesis` is intentionally a hypothesis, not a historical
business relationship. Its sources are manifest IDs `datadog-2024-10k` and
`snowflake-fy2024-10k`, hashes
`711ee14f238f3e12597a03d889b7d8c29785eee865e1cecd8e20e0578a67facf`
and `6c1f7dc96b0e484160a38025fcf2895a016a02a5f918ad5fb2250476e191a5a6`.

Review needed: inventory appearance/disappearance needs a coverage decision
before interpretation. Relationship history needs its own event or explicit
validity claims, source-publication and described-event precision, arrival time
for operational replay, and reviews for corrections or supersession. Missing
inventory observations must remain “not observed in this source slice,” not
exit or termination.

## Acquisition accounting

No network retrieval was needed or performed. The bounded attempt checked the
retained topology export, topology source manifest, three hash-pinned topology
bodies, fourteen discovery artifacts, identity reviews in the discovery
projection, and the financing announcement index. These sources were enough to
identify existing support and the exact gaps. External documents acquired: 0
of the authorized maximum 5 for this audit. The unsupported integration,
named-customer, acquisition, current-ownership, and relationship-validity
layers remain gaps rather than inferred facts.
