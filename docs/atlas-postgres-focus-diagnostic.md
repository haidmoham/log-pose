# Postgres S1 focus diagnostic

This local diagnostic explains the S1 focus failures recorded in `postgres-scale-s1.json`. It uses the synthetic S1 build on PostgreSQL 18.6. It does not measure Railway or justify changing the public 750 ms query limit.

Immediately after import, every focus request returned explicit 422. Later, the same coordinator handler returned an exact 100-edge page with 9,999 eligible neighbors in 86.2 ms. `EXPLAIN (ANALYZE, BUFFERS)` separated the current query into these phases:

| Phase | Execution | Main work |
| --- | ---: | --- |
| coverage estimate | 13.75 ms | 100 focus placements |
| exact neighbor count | 246.31 ms | 2,638 shared blocks read; 9,999 groups |
| ranked top-100 page | 24.01 ms | cached repeat of the same incidence set; top-N sort |

The count and ranked-page plans use `atlas_membership_placement_candidate` as an index-only scan. The reverse scan estimated 715 members per placement and observed 579; the grouped result estimated 9,475 candidates and observed 9,999. The plans used no temporary blocks and no unbounded sort. The ranked page used a bounded top-N heapsort.

The material difference is table preparation. Current index-only nodes report zero heap fetches. `atlas_membership` was auto-analyzed at 20:58:54 and `atlas_placement` at 20:58:32, after the initial import and near the immediate benchmark window. A fresh COPY has neither useful statistics nor all-visible heap pages. Before vacuum, an index-only reverse scan must check heap visibility in the 1.17 GB membership relation. After autovacuum, the same scan reads about 24 MB of index blocks and stays inside the limit.

`ANALYZE` can correct estimates inside the import transaction, but it does not establish the visibility map needed for zero-heap-fetch index-only scans. `VACUUM (ANALYZE)` cannot run inside that transaction. A safe publication design can commit a validated build while it remains unselected, vacuum and analyze its immutable rows, revalidate them, and then update `atlas_current` in a short transaction. A crash between stages leaves an immutable unselected build; it does not expose a partial current snapshot.

Raw plan receipt: `docs/research/issue11/postgres-scale-s1-focus-diagnostic.json`.
