import gzip

import pytest

from scripts.probe_commoncrawl import extract_html, same_source


def record(url: str, date: str) -> bytes:
    body = b"<html><body><h1>Historical product page</h1></body></html>"
    raw = (
        f"WARC/1.0\r\nWARC-Type: response\r\nWARC-Date: {date}\r\nWARC-Target-URI: {url}\r\n\r\n"
        f"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {len(body)}\r\n\r\n"
    ).encode() + body + b"\r\n\r\n"
    return gzip.compress(raw)


def test_warc_body_must_match_index_time_and_source():
    url = "https://www.getdbt.com/"
    row = {"timestamp": "20241212141558"}
    compressed = record(url, "2024-12-12T14:15:58Z")
    assert extract_html(compressed, row, url).startswith(b"<html>")
    with pytest.raises(ValueError, match="WARC date differs"):
        extract_html(compressed, {"timestamp": "20251212141558"}, url)
    with pytest.raises(ValueError, match="requested source"):
        extract_html(compressed, row, "https://another.example/")


def test_source_match_allows_trailing_slash_but_not_host_change():
    assert same_source("https://wandb.ai/site/", "https://wandb.ai/site")
    assert not same_source("https://other.example/site", "https://wandb.ai/site")
