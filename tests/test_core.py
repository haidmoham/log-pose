from datetime import datetime, timezone

from log_pose.core import normalize, select_latest


def date(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def test_cutoff_is_inclusive_and_does_not_use_ingestion_time():
    snapshots = [
        {"captured_at":date("2021-12-31T23:59:59"), "ingested_at":date("2026-09-22T12:00:00")},
        {"captured_at":date("2022-01-01T00:00:00"), "ingested_at":date("2022-01-01T00:00:01")},
    ]
    assert select_latest(snapshots, date("2021-12-31T23:59:59")) == snapshots[0]
    assert select_latest(snapshots, date("2021-12-31T23:59:58")) is None


def test_normalization_omits_scripts_and_keeps_visible_text():
    assert normalize(b"<html><body><h1>Data platform</h1><script>secret()</script><p>For teams</p></body></html>") == "Data platform For teams"
