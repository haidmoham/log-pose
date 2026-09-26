# Atlas membership index

The atlas membership index retains source placements instead of requiring a
materialized clique for every placement. It is a read derivative of
`web/data/topology-discovery.json`; it does not replace retained evidence or
promote an inventory candidate into a company or relationship claim.

## Record grains

- An `artifact` is one immutable source revision. Its deterministic identifier
  includes source, repository, immutable revision locator, raw SHA-256, and
  inventory year. The raw hash remains a separate integrity field because two
  source revisions can contain identical bytes.
- A `placement` is one artifact revision plus its exact source category path.
  Inventory year is metadata and is not the placement identity.
- A `membership` is one candidate in one placement. Repeated projected
  observations collapse into one membership, while `occurrence_ids` and `rows`
  retain every distinct supporting source row.
- A `candidate` is the original product or project candidate summary. Its
  evidence identifiers, identity review, source clocks, and precision remain
  unchanged.

`candidate_placement_indices` and `placement_members` provide both index
directions. The 100-pair review worklist stays outside this artifact; only its
input count is recorded for a parity check.

## Build and validation

Run:

```sh
PYTHONPATH=src python scripts/build_atlas_membership.py \
  --projection web/data/topology-discovery.json \
  --output api/data/atlas-membership.json
```

The builder sorts every identity-bearing collection, validates artifact
lookups and both index directions, and hashes canonical JSON content into
`build_id`. An observation currently identifies an artifact by source,
inventory year, and raw SHA-256. The build rejects that reference when it is
ambiguous across revisions. an observation can supply `artifact_id` or
`artifact_commit` to select an exact revision; mismatching references fail.

`select_candidate_neighborhood` scans only the selected candidate's placements
and their members. It reports distinct neighbors and every supporting
placement without expanding unrelated placement cliques. Source, inventory
year, category, and raw artifact hash filters select exact placements before
the scan.

`iter_exact_pairs` and `materialize_pair_oracle` are offline parity tools. The
materializer requires caller-supplied candidate and pair bounds. Neither the
index build nor the neighborhood path uses the legacy 5,000-candidate or
250,000-pair guards.

## Verified boundary

The pinned S0 regression compares the streaming oracle with every one of the
47,288 legacy unordered pairs and its exact supporting-placement set. It also
compares category-filtered pair counts and selected neighborhoods, while
asserting that the 100 worklist pairs remain separate. Synthetic 1,000- and
10,000-member placements verify linear membership storage and bounded selected
neighborhood output. These checks establish representation parity; they do not
make inventory overlap a reviewed business relationship.
