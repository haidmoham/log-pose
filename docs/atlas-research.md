# bounded atlas research reads

`log_pose.atlas_read.read_atlas` uses the existing Node runtime, with a ten-second
process limit and a 1 MiB response limit by default. inventory reads use the
`inventory_year` clock and `snapshot` or `accumulated` mode. reviewed reads use
`source_publication`, `published_through`, and `current_accepted_at_build`.
unsupported review-time replay and relationship-validity requests fail.

`read_atlas_record` retains the request and response together, including the
resolved build. `export_layered_investigation` saves up to 32 bounded reads and
4 MiB of JSON. it keeps each layer's build, query versions, frame, receipt and
selectors. each layer must use one immutable build within an investigation;
cutoffs can differ for comparison. a cross-layer identity link is explicit
present-day navigation. a joined path does not create an accepted claim.

reviewed `traverse` reads can save one cycle-safe path of at most three hops.
each hop retains its typed accepted claims and source premises under one
publication cutoff, basis, predicate and direction. path order is deterministic
and bounded to 100 visited entities. a missing or budget-exhausted path remains
a query result, not evidence that a relationship is absent.

legacy `export_investigation` keeps its inventory-only contract. the new format
is `atlas-layered-investigation-v1`; it has `layer_builds` and `reads` instead of
one global build and clock. notes, uncertainty and counterevidence remain
research records, not canonical reviews. geometry remains display-only.

## repeat the retained walkthroughs

from the repository root, use the project's Python environment and Node 24:

```sh
PYTHONPATH=src python scripts/record_reviewed_atlas_investigations.py \
  --inventory-build 990c81ef7202ecab9a0c9bf8185c459537dd1d48d7981d2839a297ed242396b5 \
  --reviewed-build bb773ae69b9991bed00afcf39948e66660eb4d5d51b8037be174ef273d30e7e7 \
  --output /tmp/log-pose-reviewed-investigations
```

choose a fresh output directory: the script refuses to replace prior receipts.
it performs six local retained-data reads and three rejected-clock checks, with
no acquisition or canonical writes. the source fixtures and exact build IDs
remain in the repository. [recorded outputs](research/issue11/investigations/reviewed-20260926/)
contain complete requests, responses, evidence references and limitations.

- **cross-layer:** the Snowflake CNCF candidate maps through the same explicit
  identity review into the reviewed company frame, then exposes the separate
  dbt Labs partnership and financing claims. the receipt retains both builds
  and clocks. the pending integration import is not silently included.
- **publication cutoff:** the combined Datadog/Snowflake hypothesis is excluded
  at 2024-12-31 because one supporting filing was published on 2025-02-20. the
  later frame retains both premises and review history. the comparison reports
  publication eligibility, not a relationship forming on that day.

publication metadata does not establish that mutable page wording existed on
that historical date. current reviews, later retrievals and present-day identity
remain visible. this does not implement operational replay, prove the hypothesis,
execute a notebook or model, or promote new semantic claims.
