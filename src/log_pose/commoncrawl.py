"""Dated Common Crawl index lookup and bounded WARC record retrieval."""

import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

from warcio.archiveiterator import ArchiveIterator

from .core import Capture, normalize


CRAWLS = {
    2021: "CC-MAIN-2021-49",
    2022: "CC-MAIN-2022-49",
    2023: "CC-MAIN-2023-50",
    2024: "CC-MAIN-2024-51",
}
USER_AGENT = "LogPose/0.1 (research; https://github.com/haidmoham/log-pose)"
MAX_INDEX_BYTES = 1_000_000
MAX_RECORD_BYTES = 2_000_000
MAX_HTML_BYTES = 2_000_000


@dataclass(frozen=True)
class SearchResult:
    status: str
    row: dict | None
    index_rows: int
    attempts: int
    errors: tuple[str, ...]


def request_bytes(url: str, *, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {"User-Agent": USER_AGENT}
    if byte_range is not None:
        start, length = byte_range
        headers["Range"] = f"bytes={start}-{start + length - 1}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        maximum = MAX_RECORD_BYTES if byte_range else MAX_INDEX_BYTES
        data = response.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("response exceeds size limit")
        if byte_range is not None:
            if response.status != 206 or len(data) != byte_range[1]:
                raise ValueError("WARC server did not return the requested byte range")
            expected_range = f"bytes {start}-{start + length - 1}/"
            if not response.headers.get("Content-Range", "").startswith(expected_range):
                raise ValueError("WARC response has the wrong Content-Range")
        return data


def same_source(actual: str, expected: str) -> bool:
    first = urllib.parse.urlsplit(actual)
    second = urllib.parse.urlsplit(expected)
    return (first.scheme, first.netloc, first.path.rstrip("/"), first.query) == (
        second.scheme, second.netloc, second.path.rstrip("/"), second.query
    )


def capture_time(timestamp: str) -> datetime:
    return datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def search(source_url: str, crawl: str, cutoff: datetime) -> SearchResult:
    if cutoff.tzinfo is None:
        raise ValueError("cutoff must include a timezone")
    params = urllib.parse.urlencode({"url": source_url, "output": "json", "filter": "status:200"})
    index_url = f"https://index.commoncrawl.org/{crawl}-index?{params}"
    errors = []
    for attempt in (1, 2):
        try:
            data = request_bytes(index_url)
            break
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return SearchResult("missing", None, 0, attempt, tuple(errors))
            errors.append(f"HTTP {error.code}")
            retry = error.code in (429, 500, 502, 503, 504)
        except OSError as error:
            errors.append(f"{type(error).__name__}: {error}")
            retry = True
        if not retry or attempt == 2:
            return SearchResult("error", None, 0, attempt, tuple(errors))
        time.sleep(2)

    rows = [json.loads(line) for line in data.splitlines() if line]
    eligible = [
        row for row in rows
        if row.get("status") == "200"
        and row.get("mime") == "text/html"
        and same_source(row.get("url", ""), source_url)
        and capture_time(row["timestamp"]) <= cutoff
    ]
    if not eligible:
        return SearchResult("missing", None, len(rows), attempt, tuple(errors))
    return SearchResult("found", max(eligible, key=lambda row: row["timestamp"]), len(rows), attempt, tuple(errors))


def extract_html(record_bytes: bytes, row: dict, source_url: str) -> tuple[bytes, dict]:
    records = ArchiveIterator(io.BytesIO(record_bytes))
    record = next(records, None)
    if record is None or record.rec_type != "response" or record.http_headers is None:
        raise ValueError("WARC range is not an HTTP response record")
    warc_headers = record.rec_headers
    target_uri = warc_headers.get_header("WARC-Target-URI")
    if not same_source(target_uri or "", source_url):
        raise ValueError("WARC record does not identify the requested source")
    warc_date = datetime.fromisoformat(warc_headers.get_header("WARC-Date").replace("Z", "+00:00"))
    if warc_date != capture_time(row["timestamp"]):
        raise ValueError("WARC date differs from index timestamp")
    http = record.http_headers
    if http.get_statuscode() != "200" or "text/html" not in (http.get_header("Content-Type") or ""):
        raise ValueError("WARC response is not HTML with HTTP 200")
    body = record.content_stream().read(MAX_HTML_BYTES + 1)
    if not body or len(body) > MAX_HTML_BYTES:
        raise ValueError("HTML body is empty or too large")
    declared_length = http.get_header("Content-Length")
    if declared_length is not None and not http.get_header("Transfer-Encoding") and not http.get_header("Content-Encoding"):
        if len(body) != int(declared_length):
            raise ValueError("HTML body differs from declared Content-Length")
    if next(records, None) is not None:
        raise ValueError("WARC range contains multiple records")
    provenance = {
        "warc_record_id": warc_headers.get_header("WARC-Record-ID"),
        "warc_target_uri": target_uri,
        "warc_date": warc_headers.get_header("WARC-Date"),
        "index_digest": row.get("digest"),
    }
    return body, provenance


def fetch(source_url: str, crawl: str, row: dict, cutoff: datetime) -> Capture:
    timestamp = capture_time(row["timestamp"])
    if timestamp > cutoff:
        raise ValueError("Common Crawl capture is after cutoff")
    if not same_source(row.get("url", ""), source_url):
        raise ValueError("index row does not identify the requested source")
    length = int(row["length"])
    offset = int(row["offset"])
    filename = row["filename"]
    if length < 1 or length > MAX_RECORD_BYTES or offset < 0:
        raise ValueError("invalid or oversized WARC locator")
    if filename.startswith("/") or ".." in filename.split("/"):
        raise ValueError("unsafe WARC filename")
    archive_url = "https://data.commoncrawl.org/" + filename
    record_bytes = request_bytes(archive_url, byte_range=(offset, length))
    body, warc_metadata = extract_html(record_bytes, row, source_url)
    if len(normalize(body)) < 100:
        raise ValueError("fewer than 100 visible text characters")
    record_id = f"{filename}:{offset}:{length}"
    provenance = {
        "crawl": crawl,
        "filename": filename,
        "offset": offset,
        "length": length,
        **warc_metadata,
    }
    return Capture(source_url, archive_url, timestamp, body, "text/html", 200,
                   "commoncrawl", record_id, provenance)
