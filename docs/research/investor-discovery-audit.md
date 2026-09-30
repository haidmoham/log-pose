# investor intent and discovery audit

Checked 2026-09-30 against main `370b0769cf81845c8ff4dddb3a614b6ef685a5dc` and the public app at <https://logpose.mhaider.dev/>. The [durable product intent](../platform-design.md#durable-product-intent) is the decision criterion. Findings below distinguish observed behavior, code/test evidence, and unvalidated product hypotheses.

## conclusion

Log Pose is a careful retained-evidence system with a useful research substrate. It does not yet establish which companies deserve investor attention. The front door optimizes source exploration, and the public-company view sorts a selected subset by reported revenue. Neither order is a tested investment signal. More nodes, centrality, filings, or caveats do not close that gap by themselves.

The next coherent product loop is: state an investor question → find an eligible cohort → compare evidence and alternatives → choose a bounded next research action → test whether those choices improve discovery on untouched companies and dates. This branch repairs the broken evidence handoff and adds the user-authored decision brief portion of that loop. It does not claim to solve eligibility, train a discovery model, validate investor utility, or estimate returns.

## evidence and coverage

- The live atlas opened a labelled Datadog/CNCF 2024 example, with 24 of 145 exact co-listing neighbors. The inspector correctly denied competition/adoption implications. That is source context, not a reason to invest.
- The live desk showed 18,076 inventory rows, 89 page captures, 369 SEC fact candidates, 19,093 Cboe participant rows and 5 relationship claims. Its searchable index had 18,543 records because the market family indexes four annual files rather than 19,093 individual participant rows.
- Company comparison uses a purposive 20-company pilot. Its overview shows ten CIK-bearing companies; the comparison picker can include the other pilot companies. Neither is a historically investable VC opportunity universe.
- The existing [MLOps study](../../experiments/ml/mlops-2024/MEMO.md) is closer to a decision artifact: eight fixed leads, 23 retained passages, conditional hypotheses, counterarguments and evidence that could change the judgment. It retains zero unconditional priorities. Its experimental status and unresolved eligibility must remain visible.
- The [P0 benchmark](../../experiments/ml/benchmark/PROTOCOL.md) already separates research correctness, forecasting, ranking and portfolio evaluation. Its 20 cases are dependent evidence tasks, not 20 investment opportunities. This audit does not replace that protocol or promote experimental judgments into core evidence.

## decision-task audit

| task | observed issue or limitation | response in this branch |
| --- | --- | --- |
| first visit / cold start | The default example begins with an arbitrary company and source year. No investor question or decision task is requested. | Add a direct atlas entry to the comparison/decision brief. The atlas remains source exploration. A question is required before brief export. |
| express intent | Search uses literal metadata/name terms. “Enter a question” overstated what the evidence index can answer. Stage, check size, geography, commercial status and horizon are not verified search constraints. | Correct the search description. The brief captures an explicit question and scope, clearly labelled as analyst notes that do not filter or verify eligibility. No natural-language query engine is implied. |
| discover candidates | Product/project keys, providers and companies have different grains. Directory presence can favor visible surviving projects and is not a company census. | Preserve current identity labels and counts. Do not add a merit rank or treat inventory coverage as market coverage. |
| apply source/time filters | Source-search tie-breaking used all observed years, including occurrences outside the active year/source filter. | Score navigation matches using only matched occurrences; show the ordering rule and deny investment-ranking or point-in-time implications. |
| reason about time | SEC period-year filters can show filings issued later. Current review and identity decisions are not historical inputs. | Add visible record-year versus availability warning. The brief records comparison period and `historical_replay: false`; its citations keep filing, capture, retrieval and review information. A strict historical screen remains future work. |
| why this company | Neighbor count measures shared placements. Public-company ordering measures selected revenue. Neither supplies an investor thesis. | Keep those meanings intact. Ask the analyst for the reason, strongest counterargument, unknowns and evidence that could change the decision. No generated recommendation or invented metric. |
| company → evidence | Confirmed on the live site: “inspect dated evidence” threw `ReferenceError: topologyView is not defined` at `app.js:170`, leaving a partial Sources screen while the URL still said overview. | Restore a contextual relationship section from retained claim records. Exact claim buttons open the corresponding evidence record. Add end-to-end route regressions. |
| compare / shortlist | Compare navigation was hidden until a pin. Sources updated pins without the shell render, so adding a private pilot from Sources could leave Compare hidden. At capacity, an extra source-list click silently did nothing. | Keep Compare discoverable, rerender pin state consistently, disable additional pins at four with an explicit explanation. |
| close / back / forward | Company close changed in-memory state without committing its URL. | Use the shared state transition and test close, back and forward. Brief text survives route changes separately from URL state. |
| no results / errors | Direct empty page/SEC searches omitted the empty state until an unrelated inventory index had loaded. An inventory error could obscure a later unrelated family’s empty state. | Make empty/error handling depend on the active family. Preserve middle-of-query caret position on rerender. |
| interrupted source load | Source-browser promises could still construct a detached result after leaving the route. | Ignore responses for disconnected panels, while retaining the shared cache for a later visit. |
| uncertainty / conflicting claims | The evidence layer has strong claim status, attribution and provenance, but these were not connected to a saved next action. | Let the analyst label explicit citations as supports/challenges/context. These roles remain analyst interpretation; they cannot rewrite a claim review. |
| diligence handoff | Pinned companies had no investor question or portable decision artifact. Atlas exports intentionally covered inventory premises only. | Add a local browser draft and a JSON decision brief. It includes only pinned-company notes and explicitly cited records, with exact catalog/build/partition references and available source hashes. |
| stale draft / missing evidence | Reusing a record ID across a new catalog could falsely present old reasoning as newly verified. | Bind each citation to the catalog build. Unavailable, other-company or different-build citations export as unresolved with no substituted record. Invalid saved drafts are not overwritten. Export links carry the expected catalog build and refuse mismatches. |

The matrix uses plausible investor tasks inferred from the user's stated purpose and public research. It is not a report of customer interviews, user acceptance, measured conversion, or investment outcomes.

## smallest complete workflow delivered for review

1. Open Compare directly or use the atlas’s “start a company decision brief” link.
2. State the investor question and scope. Pin one to four retained pilot companies.
3. Compare reported facts and dated coverage. Open an exact retained record when needed.
4. Write why each company deserves attention, the strongest counterargument, unknowns, and what evidence or next action could change the decision. Select the next research disposition yourself.
5. Assign explicit source records to supports/challenges/context. Export a JSON brief after writing a question.

Notes save locally in the same browser, not to an account or shared database. They are not included in URLs. Clearing browser storage can remove the draft, so the UI offers download. If another tab has changed the stored draft, saving pauses and both the stored version and the in-memory version remain recoverable through reload and export. Citation capacity is enforced before saving, and stale references can be removed. If storage is blocked or corrupt, the interface discloses session-only behavior and retains the original stored value. Exported files contain the analyst’s notes and should be reviewed before sharing. The download action requests a file; it does not claim that the browser saved it successfully.

Unpinning a company excludes its notes from the export without deleting its draft. Citation metadata preserves existing source and review meanings. No company, source, edge, outcome label, benchmark score, accepted claim or database record is added by this workflow.

## historical successes as a research direction

Historical successes are useful for generating mechanisms worth testing. They cannot be the only examples in the evaluation set, and “good investment” cannot silently mean “raised another round.” Bonelli's *Data-Driven Investors* finds improved screening of familiar startups alongside reduced investment in rare major-success firms; the paper reports no significant change in fund performance after data-technology adoption. This is a warning about optimizing a convenient proxy, not a conclusion that data cannot help. [Primary paper](https://academic.oup.com/rfs/article/39/7/1909/8285007)

Network context is also a testable hypothesis. Bonaventura and coauthors evaluate professional-network information and startup outcomes, but their success definition is not an ownership-level investment return. A useful Log Pose experiment would compare flat and graph representations of the same point-in-time evidence under the same research budget. [Primary paper](https://arxiv.org/html/1904.08171v1)

Telescope's public approach describes market context, pace, competition, business model and operating questions. It supplies a public research lens, not evidence of an internal investment rubric or product validation. [Public approach](https://www.telescopepartners.com/approach)

### next experiment, before any metric tuning

- Agree on investor intent: market/stage/geography, decision date, accessible opportunity set, research budget and intended next action. Treat these as experiment inputs, not defaults inferred from this audit.
- Define separate targets and resolution horizons: follow-on financing, operating growth, acquisition/IPO, or realized ownership returns. Keep unresolved, censored and failed outcomes distinct. Actual returns remain not estimable without entry terms, access, dilution and proceeds.
- Freeze an eligible company-at-date cohort before reviewing outcomes. Include relevant failures and unresolved companies; record missingness and the sampling frame. The current pilot and directory cannot stand in for that cohort.
- Generate a small set of candidate mechanisms from development examples. Examples such as sustained commercial expansion, buyer urgency or distribution improvement are hypotheses until their dated evidence and discriminating value are checked.
- Admit only evidence demonstrably available by the decision date. Separate publication, event, immutable capture, system arrival and review clocks. Prevent current descriptions, selected facts, later identities, labels and LLM knowledge of famous winners from becoming features.
- Compare simple baselines and the proposed signal on untouched temporal and company groups. Evaluate top-K discovery, missed rare outcomes, false-positive research cost, evidence coverage and analyst-time utility. Freeze K, label rules, tie rules and evaluation budget before the final holdout. Do not choose an outcome threshold merely because it flatters a model.
- Only promote a metric after a reproducible result, held-out review, and a concrete investor task show what it improves. Reusing the same winners while changing the rubric is model development, not independent validation.

No cohort, success threshold, acquisition budget, paid data service, ranking algorithm or portfolio simulation has been adopted by this branch.

## verification and limits

Baseline: 111 dashboard checks passed even though the live company-to-evidence path crashed. The new route tests cover that previously missing journey. The current feature tree has the following local results; see the [machine-readable receipt](investor-discovery-verification.json).

- The audit used the live public UI and repository sources. It did not modify production state.
- Local JSDOM/model tests cover source-linked navigation, history, draft restoration, blocked/corrupt storage, citation roles, exact provenance, stale-build refusal and locked links, cross-tab conflicts, citation-cap restoration, scoped sorting and empty/error states.
- Local browser loopback access was blocked by the cloud browser (`ERR_BLOCKED_BY_CLIENT`). Visual review is pending on the feature-branch Vercel preview. No alternate browser path was used to bypass the restriction.
- Database-dependent checks require a disposable PostgreSQL environment; absence is reported as skipped. Prepared-clone reconciliation remains unmeasured. A green software/data check does not verify publisher claims or investor usefulness.
- Canonical evidence exports, source artifacts, SQL migrations and graph snapshots remain unchanged.


| check | local result | boundary |
| --- | --- | --- |
| `npm run test:dashboard` | 127 passed, 0 skipped | model, DOM routes and interrupted flows |
| `npm run test:atlas` | 60 passed, 3 skipped | PostgreSQL-only checks skipped without a disposable DB |
| `node --test tests/deployment-health.test.mjs` | 7 passed | committed-asset and deployment-check unit tests, not a deployment receipt |
| `.venv/bin/python -m pytest -q tests` | 125 passed, 26 skipped | DB/prepared-clone checks unavailable locally |
| `npm run test:experimental` | 4 passed | isolated study view still works |
| `.venv/bin/python -m pytest -q experiments/ml` | 22 passed | experimental evidence/benchmark guards |
| `scripts/check_data_health.py` | 6 checked, 0 failed, 2 not evaluated | semantic truth and DB reconciliation not evaluated |
| both immutable atlas snapshot `--check` commands | passed | retained builds unchanged |
| `npm run lint` | 18 errors, 7 warnings | same baseline count; no rules/configuration changed; explicit storage-schema parser has a narrow documented `typeof` exception |
| browser decision journey, JSON download, 390px width smoke | added, not run locally | awaits permitted preview/CI browser access |
| canonical evidence/SQL diff against baseline | empty | no source, claim, snapshot or migration changes |

Runtime: Node 24.19.0, Python 3.12.14. This is feature-branch validation, not production release verification.
