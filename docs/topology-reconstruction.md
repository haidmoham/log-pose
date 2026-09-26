# scoped topology reconstruction

This recovery path loads only the retained reviewed-topology slice. It does not
restore page, SEC, market, discovery, or inventory evidence. The immutable
four-claim input is `docs/research/issue11/topology-reconstruction-input.json`.
Its canonical topology hash is bound to the approved preflight and decision.

Migration `016_topology_reconstruction.sql` preserves known write clocks in
`original_created_at` and `original_added_at`. A missing historical clock stays
null. `reconstruction_arrived_at` records the new local write separately.
Historical review-cutoff reads require a known original candidate and evidence
arrival. Current reads may retain reconstructed rows with an unknown original
arrival.

The four seed `reviewed_at` values remain the preserved human decision clocks.
They do not prove the original database-row arrival, so their provenance rows
leave `original_arrival_at` null. The newly accepted review keeps its recorded
human decision time and separately records the reconstruction import as its row
arrival.

The importer accepts only a database whose name starts with
`topology_reconstruction_` through the approved private Unix socket. It validates
retained artifact hashes and quotes, reconstructs the four published claims,
checks exact projection parity, and then appends the accepted dbt Labs to
Snowflake integration. Repeating the same input is a no-op. A reused ID with
different content aborts the transaction.

The recovery provenance path is:

- `raw.topology_reconstruction_batches` and `raw.topology_reconstruction_records`
- `bronze.topology_reconstruction_inputs`
- `silver.topology_reconstruction_records`
- `gold.topology_reconstruction_status`

`scripts/export_topology_reconstruction.py` copies the existing public assets
to a new staging directory. It replaces only the topology members of the
dashboard and catalog, adjusts their named topology counts, adds recovery
provenance, and builds a new immutable reviewed SQLite derivative. It rejects
any byte change to other web files and any semantic change to other dashboard,
catalog, dataset, or partition members. Existing reviewed SQLite builds remain
available for explicit old-build reads.

The retained local dump and exact output hashes are recorded in
`docs/research/issue11/topology-reconstruction-receipt.json`. The dump is a
local recovery artifact and is not committed. This workflow does not authorize
production publication.
