from pathlib import Path

from log_pose.server import static_asset


def test_local_root_uses_console_and_serves_typed_partitions(tmp_path):
    (tmp_path / "index.html").write_text("console")
    (tmp_path / "live-index.html").write_text("legacy")
    (tmp_path / "data").mkdir()
    (tmp_path / "data/index.json").write_text("{}")
    assert static_asset("/", tmp_path)[0].read_text() == "console"
    assert static_asset("/data/index.json", tmp_path)[1] == "application/json; charset=utf-8"
    assert static_asset("/api/companies", tmp_path) is None


def test_static_server_refuses_traversal_and_symlinks_outside_web(tmp_path):
    root = tmp_path / "web"
    root.mkdir()
    (tmp_path / "private.json").write_text("private")
    (root / "escape.json").symlink_to(tmp_path / "private.json")
    for path in ("/../private.json", "/%2e%2e/private.json", "/escape.json", "/%00.json"):
        assert static_asset(path, root) is None
