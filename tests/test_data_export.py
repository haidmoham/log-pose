import json
from datetime import date
from decimal import Decimal

import pytest

from log_pose.data_export import encode, reconcile_market, write_data_export


def market_rows():
    common = {"file_id": 7, "trade_date": date(2024, 1, 2)}
    participants = [common | {"market_participant": "Exchange", "total_shares": 10,
        "total_notional": Decimal("123.45"), "total_trade_count": 2},
        common | {"market_participant": "FINRA / NYSE", "total_shares": 20,
        "total_notional": Decimal("678.90"), "total_trade_count": 3}]
    daily = [common | {"participant_rows": 2, "total_shares": 30,
        "total_notional": Decimal("802.35"), "total_trade_count": 5, "trf_shares": 20}]
    return participants, daily


def test_market_reconciliation_detects_double_counts_and_wrong_totals():
    participants, daily = market_rows()
    reconcile_market(participants, daily)
    with pytest.raises(ValueError, match="duplicate"):
        reconcile_market(participants + [participants[0]], daily)
    daily[0]["total_notional"] += Decimal("0.01")
    with pytest.raises(ValueError, match="aggregate differs"):
        reconcile_market(participants, daily)


def test_json_preserves_decimal_source_precision_and_stable_bytes():
    raw = encode({"value": Decimal("999999999999999.01"), "date": date(2024, 1, 2)})
    assert json.loads(raw)["value"] == "999999999999999.01"
    assert raw == encode({"date": date(2024, 1, 2), "value": Decimal("999999999999999.01")})


def test_failed_serialization_preserves_the_existing_export(tmp_path):
    root = tmp_path / "web"
    write_data_export(root, {"build_id": "first"}, {"data/pages/a.json": {"records": []}})
    original = (root / "data/index.json").read_bytes()
    with pytest.raises(TypeError):
        write_data_export(root, {"build_id": "second"}, {"data/pages/a.json": {"bad": object()}})
    assert (root / "data/index.json").read_bytes() == original
    assert json.loads((root / "data/pages/a.json").read_text()) == {"records": []}


def test_catalog_reconciles_retained_database_and_partitions():
    """Opt-in read-only check; this database is never truncated or mutated."""
    import os
    from pathlib import Path
    import psycopg
    from psycopg.rows import dict_row
    from log_pose.data_export import build_data_export

    url = os.getenv("LOG_POSE_CATALOG_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set LOG_POSE_CATALOG_TEST_DATABASE_URL to a prepared evidence clone")
    with psycopg.connect(url, row_factory=dict_row) as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        index, partitions = build_data_export(connection, repository_root=Path(__file__).parents[1],
                                             page_text_limit=100)
        expected_pages = connection.execute("SELECT count(*) AS n FROM snapshots").fetchone()["n"]
        expected_sec = connection.execute("SELECT count(*) AS n FROM sec_financial_facts").fetchone()["n"]
        expected_market = connection.execute("SELECT count(*) AS n FROM market_daily").fetchone()["n"]
        assert index["counts"]["pages"] == expected_pages
        assert index["counts"]["sec"] == expected_sec
        assert index["counts"]["market_rows"] == expected_market
        all_ids = [row["id"] for key in ("pages", "sec", "market") for row in index[key]]
        assert len(all_ids) == len(set(all_ids))
        assert sum(len(payload["records"]) for path, payload in partitions.items()
                   if path.startswith("data/pages/")) == expected_pages
        for row in index["pages"]:
            detail = next(record for record in partitions[row["partition_path"]]["records"]
                          if record["id"] == row["id"])
            assert len(detail["normalized_text"]) <= 100
            assert detail["text_truncated"] == (detail["text_characters"] > 100)
            assert "raw_html" not in detail
        again, _ = build_data_export(connection, repository_root=Path(__file__).parents[1], page_text_limit=100)
        assert index["build_id"] == again["build_id"]
