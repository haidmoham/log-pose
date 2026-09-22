import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urlparse

from bs4 import BeautifulSoup


@dataclass(frozen=True)
class Capture:
    original_url: str
    archive_url: str
    captured_at: datetime
    raw_html: bytes
    content_type: str
    status_code: int


def archive_url(timestamp: str, original_url: str) -> str:
    if not re.fullmatch(r"\d{14}", timestamp):
        raise ValueError("capture timestamp must be YYYYMMDDhhmmss")
    if urlparse(original_url).scheme != "https":
        raise ValueError("curated source must use HTTPS")
    return f"https://web.archive.org/web/{timestamp}id_/{original_url}"


def parse_capture_url(url: str) -> tuple[datetime, str]:
    match = re.fullmatch(r"https://web\.archive\.org/web/(\d{14})id_/(https?://.+)", url)
    if not match:
        raise ValueError("archive did not resolve to a raw Wayback capture")
    timestamp, original = match.groups()
    captured_at = datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return captured_at, original


def normalize(html: bytes) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header"]):
        tag.decompose()
    body = soup.body or soup
    text = unescape(body.get_text(" ", strip=True))
    return re.sub(r"\s+", " ", text).strip()


def sha256(value: bytes | str) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def select_latest(snapshots: list[dict], cutoff: datetime) -> dict | None:
    eligible = [s for s in snapshots if s["captured_at"] <= cutoff]
    return max(eligible, key=lambda s: s["captured_at"], default=None)
