import gzip
import urllib.error
import urllib.request
from datetime import datetime

from .core import Capture, archive_url, normalize, parse_capture_url


USER_AGENT = "LogPose/0.1 (research; https://github.com/haidmoham/log-pose)"


def fetch_capture(original_url: str, timestamp: str, cutoff: datetime) -> Capture:
    request = urllib.request.Request(archive_url(timestamp, original_url), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        final_url = response.url
        captured_at, resolved_original = parse_capture_url(final_url)
        if resolved_original.rstrip("/") != original_url.rstrip("/"):
            raise ValueError(f"archive redirected to a different source: {resolved_original}")
        if captured_at > cutoff:
            raise ValueError(f"capture {captured_at.isoformat()} is after cutoff {cutoff.isoformat()}")
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type:
            raise ValueError(f"expected HTML, got {content_type}")
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("capture exceeds 2 MB safety limit")
        if response.headers.get("Content-Encoding") == "gzip" or raw.startswith(b"\x1f\x8b"):
            raw = gzip.decompress(raw)
            if len(raw) > 2_000_000:
                raise ValueError("expanded capture exceeds 2 MB safety limit")
        text = normalize(raw)
        if "Wayback Machine doesn't have that page archived" in text:
            raise ValueError("archive returned a missing-page banner")
        return Capture(original_url, final_url, captured_at, raw, content_type, response.status)
