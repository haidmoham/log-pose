"""Check the additive medallion read path against a disposable database."""

import os

import psycopg
import pytest
from psycopg.rows import dict_row

from log_pose.storage import migrate


LAYER_TABLES = {
    "raw": {
        "snapshots", "ingestion_attempts", "market_files", "sec_artifacts",
        "sec_companyfacts", "topology_sources", "topology_acquisition_jobs",
        "discovery_artifacts", "topology_reconstruction_batches",
        "topology_reconstruction_records",
    },
    "bronze": {
        "market_daily", "sec_financial_facts", "discovery_occurrences",
        "discovery_inventory_rows",
    },
    "silver": {
        "companies", "sources", "topology_entities", "topology_entity_aliases",
        "topology_eligibility_reviews", "topology_candidates",
        "topology_candidate_evidence", "topology_reviews",
    },
    "gold": {"topology_graph_builds", "atlas_snapshot", "atlas_current",
             "atlas_candidate", "atlas_artifact", "atlas_placement", "atlas_membership"},
}


def test_every_domain_table_has_one_lossless_layer_view():
    database_url = os.getenv("LOG_POSE_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set LOG_POSE_TEST_DATABASE_URL to a disposable Postgres database")

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        migrate(connection)
        with connection.cursor() as cursor:
            cursor.execute("""SELECT tablename FROM pg_tables
                WHERE schemaname = 'public' AND tablename <> 'schema_migrations'""")
            actual_tables = {row["tablename"] for row in cursor.fetchall()}
            mapped_tables = set().union(*LAYER_TABLES.values())
            assert actual_tables == mapped_tables

            for layer, table_names in LAYER_TABLES.items():
                for table_name in table_names:
                    cursor.execute("""SELECT 1 FROM pg_views
                        WHERE schemaname = %s AND viewname = %s""", (layer, table_name))
                    assert cursor.fetchone() is not None
                    cursor.execute(f"SELECT count(*) AS count FROM public.{table_name}")
                    public_count = cursor.fetchone()["count"]
                    cursor.execute(f"SELECT count(*) AS count FROM {layer}.{table_name}")
                    assert cursor.fetchone()["count"] == public_count
                    cursor.execute("""SELECT column_name FROM information_schema.columns
                        WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position""",
                        ("public", table_name))
                    public_columns = [row["column_name"] for row in cursor.fetchall()]
                    cursor.execute("""SELECT column_name FROM information_schema.columns
                        WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position""",
                        (layer, table_name))
                    assert [row["column_name"] for row in cursor.fetchall()] == public_columns

            cursor.execute("SELECT count(*) AS count FROM gold.topology_current_review")
            projection_count = cursor.fetchone()["count"]
            cursor.execute("SELECT count(*) AS count FROM silver.topology_candidates")
            assert projection_count == cursor.fetchone()["count"]

            cursor.execute("""INSERT INTO public.topology_entities
                (id,name,entity_kind,identity_status,created_at,original_created_at,
                 reconstruction_arrived_at)
                VALUES ('layer-clock-check','Layer clock check','company','reviewed',
                    '2020-01-01T00:00:00Z',NULL,'2026-09-26T00:00:00Z')""")
            cursor.execute("""SELECT original_created_at,reconstruction_arrived_at
                FROM silver.topology_entities WHERE id='layer-clock-check'""")
            row = cursor.fetchone()
            assert row["original_created_at"] is None
            assert row["reconstruction_arrived_at"] is not None
            connection.rollback()
