import io
from datetime import datetime, timezone

from log_pose.acquire import fetch_capture


def test_wayback_keeps_valid_short_html_for_later_extraction(monkeypatch):
    original_url = "https://example.com/"
    timestamp = "20211201123456"
    body = b"<html><head><title>Example</title></head><body><script>render()</script></body></html>"

    class Response(io.BytesIO):
        url = f"https://web.archive.org/web/{timestamp}id_/{original_url}"
        headers = {"Content-Type": "text/html"}
        status = 200

    monkeypatch.setattr("log_pose.acquire.urllib.request.urlopen", lambda request, timeout: Response(body))
    capture = fetch_capture(original_url, timestamp, datetime(2021, 12, 31, tzinfo=timezone.utc))
    assert capture.raw_html == body
    assert capture.provider == "wayback"
