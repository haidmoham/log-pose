# market topology ontology · version 1

Log Pose records claims about relationships between identified entities. A claim says what a source stated or what a reviewer inferred, within a stated scope and time. Acceptance means a reviewer found enough evidence for **that basis**. It does not turn a hypothesis into an observed fact.

Several claims may connect the same pair. A company can compete with, integrate with, partner with, and invest in another company. No recorded claim means no supported claim in this research slice. It does not mean the companies are independent.

This is a vocabulary for collection and inspection, not a model of investment returns. It has no edge weights, calibrated probabilities, or inferred relationship duration.

## record meanings

| record | grain and meaning |
| --- | --- |
| discovery occurrence | one row in a pinned inventory. it is a lead, not a verified company or relationship. |
| acquisition job | one bounded request for source material, with retries and failures retained. |
| source artifact | one retrieved body or existing immutable snapshot reference, with URL, publisher, hash, and source, capture, and retrieval dates where known. |
| entity | one stable identity for a company, product, project, or unresolved mention. |
| candidate claim | one source-backed proposal about an ordered entity pair, predicate, and scope. it has its own evidence summary and locator. |
| review | a dated `accept`, `reject`, or `needs_evidence` decision on a candidate. later reviews do not erase earlier decisions or source bytes. |
| graph build | a reproducible projection of accepted claims under stated source-date and review-time cutoffs. |

The current public export presents reviewed claims in a readable form. A composite claim may cite more than one source. The normalized candidate store has one primary source and a separate evidence-reference row for each additional supporting or contradicting source. A shared-exposure hypothesis needs at least two distinct supporting sources before review can accept it. Every premise remains visible in the projection.

## entities and eligibility

`company` is an organization. `product` is an offering with its own lifecycle. `project` is a named technical project, which may have no sole commercial provider. `unresolved` is an identity placeholder, not a verified company. A name, domain, ticker, product, and company are not interchangeable. Aliases record the source and validity dates when known.

Identity status is `lead`, `reviewed`, or `unresolved`. It answers whether the entity link has been reviewed. U.S. software-universe eligibility is a separate, dated decision: `included`, `excluded`, `unresolved`, or no review yet. A reviewed identity is not automatically an eligible company. Current landscape candidate keys remain leads, even if several rows share a name or website.

## relationship predicates

Each predicate requires a readable scope. Company endpoints are allowed for the current review, but a product-level competitive or integration claim must name the actual offering or workflow. `direction` records how to read the ordered endpoints; `symmetric` means the claim concerns both parties, not that both parties made the statement.

| predicate and reading | evidence required | does not establish |
| --- | --- | --- |
| `named_competitor_of`: **subject names object as a competitor**. direction follows the speaker → named company. | attributable statement, dated source, and named product or market scope. | reciprocal acknowledgment, market share, customer switching, or competitive intensity. |
| `possible_substitute_for`: **subject may substitute for object** in the named buyer and workflow. | dated evidence for both offerings and a reviewer explanation of substitutability. | equal capabilities or observed switching. shared category membership alone stays a candidate lead. |
| `integrates_with`: **subject integrates with object** in the named product workflow. | product documentation or a dated integration statement, with direction and supported products. | a commercial partnership, customer adoption, or ongoing availability. |
| `announced_partnership_with`: **the parties were named in a partnership announcement**. | attributable announcement and its scope; preserve who announced it. | the partnership's start, present activity, exclusivity, or financial contribution. |
| `invested_in`: **subject participated as investor in a financing of object**. investor → recipient. | a dated financing announcement that names both parties and the round. | amount invested by that party, ownership percentage, later holdings, or control. |
| `shared_exposure_hypothesis`: **both parties may be affected by a named business driver**. | evidence for each party, a proposed mechanism, and an explicit alternative. | shared customers, observed co-movement, effect size, or causation. |

There is no generic `related_to` or `collaborates_with` predicate. If the meaning is unclear, retain the source and a review lead instead of forcing it into an edge. An investment can accompany a partnership, but the investment does not prove the partnership. A source can name a competitor while another source documents an integration with that same company; both claims remain visible.

## basis, review, strength, and confidence

The basis of a claim is `source_statement`, `reviewed_inference`, or `hypothesis`. In the public seed these appear as `documented`, `reviewed_inference`, and `hypothesis`; the display reads **source-stated**, **reviewer inference**, and **untested hypothesis**. These are kinds of interpretation, not a ranked confidence scale. `accept` means the evidence supports inclusion under the stated basis. An accepted hypothesis remains untested. `reject` means the proposed claim failed review; it does not prove the opposite relation.

**Relationship strength** would describe the extent of a scoped tie, such as actual workflow overlap or a measurable share of dependency. **Extraction confidence** would describe whether text was parsed and linked correctly. **Relation probability** would require a defined event, a calibrated model, and evaluation data. **Review priority** can order work without measuring any of those. None is currently estimated. No graph distance, color, line thickness, status label, or count should be read as strength or probability.

An explicit denial or contradiction needs its own attributed source, scope, and date. The current predicate set has no polarity field. Keep denials in the review queue; do not encode them as a rejected positive candidate, absent edge, or negative weight. Syndicated copies of one announcement are one originating claim, not independent corroboration.

## time vocabulary

| time | question it answers |
| --- | --- |
| source publication | when the publisher released the source. the public graph's “sources through” filter uses this date. |
| described event | when an event occurred **if the source establishes that date**. an announcement date is not automatically a transaction date. |
| reporting period | which fiscal or other period the source discusses. it is not a relationship interval. |
| archive capture | when a historical page was captured. |
| retrieval | when Log Pose obtained the artifact. |
| proposal and review | when Log Pose recorded and assessed a claim. |
| explicit validity interval | when a source establishes that a relationship held, with both inclusive day boundaries. |

`temporal_form` is `event`, `observed_state`, `explicit_interval`, or `unknown`. An event has an `event_on` date and a basis that names the event. An observed state is described in a source but has no proven duration. An explicit interval has `valid_from` and `valid_to`; both boundaries are required in the current schema. Unknown preserves the gap. If a source establishes a start but no end, record the statement in its temporal basis and leave the validity interval unset. Do not invent a one-day expiry, an open-ended active state, or a default timestamp.

“Claims published by a date” and “relationships valid on a date” are different queries. `reviewed_claims` supports publication-date and Log Pose review-time cutoffs. It also checks source arrival and candidate creation for the latter. It does **not** assert that all returned relationships were valid on the cutoff date. A current retrieval of a page with a printed old date is weaker historical evidence than an immutable in-period capture; keep that limitation visible.

## provenance and wording

Every displayed claim retains endpoint IDs, predicate, direction, scope, interpretation, remaining unknowns, source attribution, source URL, evidence summary, publication date, and available event, reporting, retrieval, artifact-hash, and review details. `evidence_text` in the present seed is a **paraphrase**, so the UI labels it “evidence summary.” Only an exact retained passage may be styled as a quotation. A source locator or passage hash should be added when extraction moves beyond these manually reviewed seeds.

The [source-backed seed](research/market-topology.json) illustrates the boundaries:

- Datadog names Elastic as a log-management competitor in a filing published in 2025 about fiscal 2024. That is Datadog's attributed view in one scope, not a 2024 validity interval.
- dbt Labs describes a partnership with Snowflake in its 2022 financing announcement. The announcement does not prove current activity.
- Snowflake participated as a strategic investor in the announced dbt Labs Series D. The announcement date does not independently date the transfer of funds or later ownership.
- Datadog and Snowflake filings motivate a possible common customer-workload and spending driver. Two different source records support that hypothesis. Their revenue and stock returns have not been tested for co-movement.

## prior art and local choice

[FinDKG](https://arxiv.org/pdf/2407.10909) uses typed entities and relations extracted from dated financial news. Its release-date graph and link prediction are useful references, but its ontology omits our core competition and partnership meanings. A link-ranking score or attention weight is not evidence confidence. [STOCKnowledge](https://arxiv.org/pdf/2504.20058) separates static, point-event, and interval relations; its public-stock prediction target does not provide private-company identity or relationship validity. Its benchmark preprocessing assigns one-day expiry and a 1970 fallback to missing dates, which Log Pose deliberately leaves unknown.

[Time-Aware Probabilistic Knowledge Graphs](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.TIME.2019.8) separates validity from recording time. Log Pose adopts that distinction without importing its probabilistic reasoner. The [uncertainty-management survey](https://drops.dagstuhl.de/entities/document/10.4230/TGDK.3.1.3) also distinguishes uncertainty introduced during acquisition, alignment, and fusion. That supports retaining the source and review trail instead of collapsing it into one edge weight.
