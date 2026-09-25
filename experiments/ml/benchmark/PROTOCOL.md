# evidence and claim benchmark protocol · version 1

This protocol defines the first local regression suite for [issue #3](https://github.com/haidmoham/log-pose/issues/3). Its target is **research correctness on retained evidence**. Twenty cases test source selection, time eligibility, identity, extraction, attribution, interpretation, contradiction handling, and abstention. They are a curated smoke suite. Shared companies and sources make them dependent examples, not twenty independent investment opportunities or a representative market sample.

The case manifest is frozen before a candidate run. Keep every selected case in the denominator, including an unresolved or excluded case. A case can be reported as blocked, provisional, or unscored; it must not be silently replaced. Record the manifest hash, code revision, control version, rubric version, and exact input artifact IDs for each run. Preserve the verbose answer and evidence trail beside the score.

## targets and allowed inference

| layer | target | what a result may establish | what it cannot establish |
| --- | --- | --- | --- |
| P0 evidence and claims | correct, supported answers under a declared information cutoff | performance of a named control on these frozen cases and rules | market-wide research quality, calibrated probabilities, or investment returns |
| later forecasting | independently resolved future events for an eligible cohort | proper forecast scores and ranking against named baselines | that high calibration alone selects useful investments |
| later diligence ranking | useful ordering under a fixed budget and resolution rule | top-K capture or decision efficiency on the evaluated cohort | that every selected company was investable |
| later research policy | actions and evidence acquisition under a fixed budget | relative task performance under the tested environment | real-world policy value from a simulator alone |
| later portfolio study | accessible investments with dated cash flows and terms | conditional scenario comparisons under declared assumptions | causal alpha from historical replay |

Report these layers as separate score vectors. There is no universal `analytic_quality` scalar. No forecast, policy, or return result is part of P0.

## p0 case labels

The manifest has exactly twenty versioned cases from retained local artifacts. Selection includes ordinary source and arithmetic tasks plus post-cutoff filings, mutable pages with old printed dates, duplicate or unresolved identities, a company's marketing claim, unsupported graph interpretation, contradictory sources, missing evidence, and valid abstention. A case can use more than one artifact. Its grouping keys identify shared company and source families so a later split does not put near duplicates on opposite sides.

Each case names an entity, question, cutoff, replay mode, universe manifest, allowed artifact IDs, rubric, and evaluator-only answer or resolution reference. The candidate sees the question and sanitized eligible evidence. It never sees the hidden answer, outcome, reviewed quote, later selection flag, or post-cutoff topology review. Existing export annotations are useful for auditing, but they are not historical inputs merely because they appear beside a retained source. The evaluator keeps the answer key in a separate path and records its label provenance.

Mechanical labels can assert exact dates, hashes, IDs, arithmetic, and field presence. Semantic labels such as claim entailment, contradiction, and whether a passage supports an economic conclusion need independent human review with reviewer identity, date, rubric, and disagreement record. Until that review exists, report those judgments as **provisional and unscored**. An LLM or the same author who wrote the case cannot silently become independent ground truth. Preserve `unknown`, `unresolved`, and `censored` as distinct from `false`.

Score a source-stated claim as attribution to its speaker. A company's claim to market leadership is evidence that it made the claim, not evidence that it leads the market. Syndicated copies of one release are one origin. An absent graph edge means no supported edge in this slice, not a negative economic relationship. An accepted topology hypothesis remains a hypothesis and has no calibrated probability or strength.

## clocks and replay

Use UTC cutoffs and retain four different clocks: the event or reporting period, the source's publication or filing time, the immutable capture time, and Log Pose's retrieval/ingestion time. None substitutes for another. A fiscal-year label does not make a later Form 10-K available at year end. A mutable page fetched in 2026 does not prove its present bytes existed on its printed 2022 publication date. A companyfacts member fetched in 2026 can contain later revisions; its `filed_date` alone does not prove historical content.

The case declares one of two replay modes:

- **public availability:** an immutable, verified pre-cutoff capture or filing accession may be used even when Log Pose ingested it later. The result is retrospective. It does not imply Log Pose had the source at the time.
- **system known:** require both public availability and Log Pose arrival by the cutoff. A later archive import is ineligible.

Strict mode fails closed when the proof required by its mode is missing or ambiguous. It checks every observed and derived artifact, not just the top-level citation. It rejects a post-cutoff source, a current export selection that embeds a later decision, and an outcome hidden in the candidate payload. Record the rejected ID and reason. A permissive diagnostic may show what changes when proof is relaxed, but its score must carry that designation and never be presented as strict replay.

## controls and scorecard

Run at least two useful credential-free controls on the same frozen manifest. One should enforce eligibility and abstain when a fact is unavailable. Another should offer a simple extraction or selection alternative with its rule, input, and budget stated. An always-abstain control can diagnose coverage but does not count as both substantive controls. Supplied candidate predictions can be scored offline. Real model calls are optional, metered, and reported only if executed; they use the same cases and declared evidence and token budgets.

The JSON and Markdown scorecards state the target, cohort, replay mode, manifest hash, control versions, numerator and denominator for each metric, coverage, abstentions, violations, cost and latency when measured, and a receipt for every case. Include errors and blocked/unmeasured sections. Supported-claim precision needs a substantive-claim denominator; required-fact coverage needs a frozen required-fact denominator. Show both with abstention and error rates so silence or trivial claims cannot win. Temporal and outcome-access violations are hard failures and cannot be offset by prose quality.

Forecasting is deferred, but any later probability metric must define the event, resolution horizon, unresolved/censored treatment, and applicable cohort before use. Test proper scores on known values and edge cases. State tie handling for ranking and mark an empty denominator or unresolvable event as undefined, not zero. Deterministic selection and scoring must reproduce from the same manifest and configuration. A stochastic run retains seed and outputs; a seed does not guarantee bitwise repeatability across models or providers.

## inferential jump register

These confidence labels describe the **proposed positive Log Pose jump**, not calibrated probabilities. Each test controls the named alternative.

| ID | proposed jump and confidence | alternative explanation | distinguishing test |
| --- | --- | --- | --- |
| J1 | retrieval improves analysis · medium | extra text distracts or is redundant | same cases, model, and budget; vary retrieval only |
| J2 | topology improves forecasts · medium | extra facts, tokens, or curation cause the gain | equal evidence and policy; compare flat and graph forms, including curation cost |
| J3 | calibration improves selection · low as a sufficient claim | constant base rate calibrates but ranks nothing | proper score, calibration, and ranking lift separately |
| J4 | follow-on or acquisition implies profit · low | terms, dilution, price, and liquidity reverse returns | require ownership-level cash flows before any return comparison |
| J5 | benchmark gains improve analyst decisions · medium for matched tasks, low for investing | benchmark favors its own rubric | randomized matched analyst tasks with blinded grading and fixed budgets |
| J6 | historical selection was investable · low | access, allocation, and price were unavailable | verify dated deal access and terms; sensitivity-test absent fields |
| J7 | replay estimates effect of investing · low | capital and investor help changed outcomes | prospective or identified causal design; replay alone cannot answer |
| J8 | RL simulator wins transfer to reality · low | policy exploits simulator or reward | held-out environments, seeds, simple controls, and prospective evidence |
| J9 | predicted graph edges are economic ties · low–medium | collection and publication make edges appear | freeze predicates, observation rules, and independent relationship resolution |
| J10 | belief movement is information gain · low as a sufficient claim | a wrong belief can move sharply | score against independent outcomes, not movement alone |
| J11 | pilot generalizes to the market · low | selected, surviving, observable firms dominate | predeclare an eligible population and untouched cohorts |
| J12 | date-filtered LLM replay is leakage-free · low | weights, hints, derived fields, and feedback contain future facts | audit every channel and label retrospective runs honestly |

A controlled software ablation can identify a component effect on this benchmark under its conditions. A randomized analyst study can identify an effect on its measured tasks. Neither establishes investment alpha or an economic mechanism.

## decision after P0

Prospective forecasting is a **go** only after an eligible cohort, append-only pre-event forecast registry, independent resolution rule, enough resolved outcomes, honest censoring, and named simple baselines are in place. Otherwise record a no-go with the missing item. Historical portfolio evaluation additionally needs accessible allocation, entry security and price, contributions and distributions, dilution, preferences, fees/carry, residual-value policy, and an appropriate comparison basis. Without those, return and PME fields are `not estimable`; they are never zero or a mock leaderboard. Sequential RL remains deferred until valid episodes and action-dependent decisions justify it.
