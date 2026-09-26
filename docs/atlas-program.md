# temporal atlas implementation program

implementation of issue #11 starts from `13fa0c1738803091f765b20bd9b833a63cc8efdc`.
the existing console and its deep links remain the compatibility surface.
each milestone needs its own evidence; a passing membership test does not
complete the epic or establish real-world relationship truth.

## frozen baseline and dependency map

| milestone | dependency | exit evidence |
| --- | --- | --- |
| M0: contracts and baseline | pinned main | retained hashes, query catalog, budgets, baseline checks |
| M1: membership index | M0 | all 47,288 pairs and supporting placements match; dense buckets avoid cliques |
| M2: immutable read snapshots | M1 | bounded reads, versioned cursors, atomic publication, rollback, incremental equivalence |
| M3: region / focus / evidence interface | M2 | coherent frames, keyboard/list fallback, real browser receipts |
| M4: real evidence layers | shared identity/time contract | retained premises and human review; unresolved layers stay incomplete |
| M5: investigations | M2, M4 | three reproducible task receipts and isolated model attachments |
| M6: measured frontier | previous milestones | S1, attempted S2, capacity limits, required CI and deployment checks |

S0 contains 1,240 inventory candidates, 5,964 candidate placements, 47,288
distinct exact co-listing pairs, fourteen artifacts and a separate 100-pair
review worklist. these are fixture assertions, not production constants.
the projection is `ef16d184391fd66ba151b77b745163770e296afd0486a5236a8d7c1c7a5297d8`;
the legacy graph is `0c15e1ce1a92738173af8d94f7f89a2175d5c267f93e87f35a2b3ec01756d338`.

the baseline dashboard suite passes 84 tests on Node 22.23.1 in Ubuntu/WSL.
the baseline lint command reports 20 existing errors and eight warnings,
primarily the anti-slop rule on runtime `typeof` checks. this is not a clean
lint baseline. required CI does not currently include lint. new files receive
their own lint check; no validator is weakened.

## query and task catalog

1. discover available source revisions and explain coverage without sending all candidates.
2. search and page candidates with source, year and category filters.
3. open a source-taxonomy region, then focus one candidate and page exact neighbors.
4. inspect both retained rows supporting a pair, including artifact version and hash.
5. compare two compatible inventory frames and distinguish absence from an exit.
6. export a selected investigation with the exact build, selectors, premises and limitations.

snapshot and accumulation use the inventory-year clock at year precision.
artifact revision identity disambiguates two revisions in the same year.
source publication, capture, arrival, validity, review and model issuance remain
different clocks. an unsupported clock fails explicitly. accepted company claims
remain separate from unreviewed inventory membership. current identity mappings
and display geometry are present-day lenses, not point-in-time model inputs.

## initial budgets

interactive decoded responses and discovery plus first-view data: 1 MiB.
focus defaults to 60 neighbors, with a maximum of 100. each read declares its
scan and result budgets. exceeding a work budget returns an explicit limit;
it never reports a partial scan as an exact total. graph rendering stays bounded
by the displayed region/page, not the corpus. caches have byte limits.

local scale jobs may use up to 8 GiB RAM, 20 GiB disk and 30 minutes per tier.
first run S0 and dense 1,000/10,000-member buckets. S1 uses 10,000 IDs and
1,000,000 memberships across at least 32 revisions. attempt S2 with 50,000 IDs
and 5,000,000 memberships across at least 64 revisions. fixtures are synthetic,
not measured economic coverage. local read concurrency uses 1, 5 and 20 clients,
at most 200 requests per workload. never stress production.

the expansion cohort may include at most 25 entities and 100 additional primary
documents. reuse retained sources first. failed retrievals, rights restrictions
and missing historical proof remain visible. no paid resources, DNS changes,
new semantic acceptance decisions, or changes to issue #2's frozen cohort are
authorized by this program.

## storage decision

keep the Postgres evidence core and raw → bronze → silver → gold contract.
an immutable SQLite export is a gold read artifact. it is rebuilt from retained
projections, never written by a public request. candidate and placement indexes
avoid compulsory global pair expansion. the legacy materialized graph remains
the small-data parity oracle and compatibility path.

S0 reuses the file-export deployment. measured S1/S2 SQLite files exceed the
Vercel bundle limit, so an indexed Postgres provider now serves the same bounded
contract without loading the corpus into Node. the user authorized Railway as
the Postgres hosting choice. its deployment is prepared separately from the
Vercel frontend, with running cost and release approval still explicit.
Node's built-in SQLite remains the local/offline parity path; its API is still
experimental in Node 22/24. [Node SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
and [Vercel function limits](https://vercel.com/docs/functions/limitations)
were checked during implementation. see [Railway setup](atlas-railway.md).

semantic zoom will use source taxonomy regions → a bounded candidate page → a
focused neighborhood → exact evidence. a region is a source placement, not an
inferred economic market. this keeps aggregation explainable and avoids forcing
an overlapping taxonomy into a disjoint tree. camera changes affect display
only; the research universe stays in the query manifest.

## milestone delivery and remaining work

this branch delivers the incidence model, exact S0 parity, immutable SQLite and
Postgres publication, bounded reads, top-k, source-region navigation, focused
inspection, saved investigations and isolated attachment validation. local S1
and S2 receipts distinguish synthetic capacity from real evidence coverage.
the [browser receipts](atlas-browser-performance.md) measure the current route.

the epic stays open. the following are still incomplete:

- M4: the [retained-evidence audit](research/issue11/layer-evidence-review.md)
  identifies reviewed competition, partnership and financing participation.
  integration acceptance and missing customer/ownership/history evidence need
  explicit review or acquisition. no new claim was accepted automatically;
  zero external documents were acquired in this milestone.
- M5: three reproducible investigations cover overlap, retained cross-layer
  evidence, and historical reconstruction. they expose unresolved identity and
  system-known eligibility instead of manufacturing a complete cross-layer UI.
- M6: deployed Railway measurements, the constrained-device profile, a
  twenty-minute memory soak, and hosted backup/restore verification remain.
- a second real typed relation/visual layer is not yet integrated through the
  atlas renderer. the inventory mode explicitly rejects unsupported layers.

the reviewable milestone must not close issue #11 or imply that all its
acceptance criteria passed. required PR checks and exact deployment checks
remain release gates, separate from local performance and evidence integrity.
