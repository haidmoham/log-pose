# Reviewed atlas snapshots

The reviewed atlas is an immutable read derivative of accepted topology claims. It is not an evidence write store and does not accept, reject, or widen claims. The builder independently hashes the public topology export and discovery identity projection. It also verifies every retained topology source body against `topology-source-manifest.json` before publication.

The SQLite row grains are one reviewed entity, one explicit reviewed candidate-to-entity identity link, one scoped accepted claim, one retained source premise in claim order, and one review-history row. Candidate links come only from `identity_review`; an unreviewed navigation match is never an identity link. A reviewed entity without an inventory mapping remains a `reviewed_external_entity` and receives no invented candidate ID.

The manifest has its own build, snapshot, query, and layout versions. It binds both input hashes and the discovery identity build. The review lens is `current_accepted_at_build`: the source export contains claims accepted at build time and cannot reconstruct an earlier review state after a later decision. Old immutable builds remain readable only while their manifest and database are hosted. The builder validates SQLite integrity, foreign keys, counts, source-date reconciliation, byte length, and checksum before atomically replacing `current.json`.

Build and verify:

```bash
PYTHONPATH=src python scripts/build_atlas_reviewed.py
PYTHONPATH=src python scripts/build_atlas_reviewed.py --check
```

The provider exports `createReviewedAtlasHandler(root)`. It accepts `discover`, `search`, `focus`, `explain`, `compare`, and `export`. Parent runtime routing supplies `layer=reviewed` and owns HTTP composition.

- `clock=source_publication` and `temporal_mode=published_through` are fixed.
- `cutoff` is empty or an exact `YYYY-MM-DD`. Every supporting or contradicting premise must have a publication date no later than the cutoff.
- `basis=documented` includes documented and reviewed-inference claims. `hypothesis` selects accepted hypotheses, and `all` includes both groups.
- `predicate` is empty, `all`, or an ontology predicate. `direction` is `both`, `in`, or `out` relative to the resolved entity; symmetric claims participate in both directions.
- `entity` is a reviewed entity slug. `candidate` resolves only through an explicit reviewed link. Supplying both requires them to agree.

Focus pages have neighbor grain and select the first bounded neighbor IDs in ASCII order. This order is a stable selection policy, not relevance or relationship strength. `eligible_claim_count` remains separate. Explain pages retain individual full claims, directions, sources, hashes, clocks, review details, and review history, including multiple predicates on one pair. Compare reports claim-ID availability differences between publication cutoffs; it never reports relationship activity.

The provider caps pages at 100, explain pages at 25, selected neighbors at 100, response JSON at 1 MiB, claim work at 200,000 rows, execution at 750 ms, SQLite cache at 8 MiB, and open handles at two. Source publication, described event, reporting period, retrieval, candidate creation, and review time remain distinct. No response asserts validity on a date, current activity, replay, strength, or probability.
