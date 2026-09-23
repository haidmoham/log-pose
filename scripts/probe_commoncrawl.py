"""Bounded Common Crawl index and WARC retrieval probe for curated URLs.

This samples one late-year crawl per year. Missing rows are not evidence that a
company was absent from Common Crawl or from the market.
"""

import argparse
import gzip
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from log_pose.core import normalize


CRAWLS = {
    2021: "CC-MAIN-2021-49",
    2022: "CC-MAIN-2022-49",
    2023: "CC-MAIN-2023-50",
    2024: "CC-MAIN-2024-51",
}
USER_AGENT = "LogPose/0.1 (research; https://github.com/haidmoham/log-pose)"
MAX_INDEX_BYTES = 1_000_000
MAX_RECORD_BYTES = 2_000_000


def request_bytes(url: str, *, byte_range: tuple[int, int] | None = None) -> tuple[int, bytes]:
    headers = {"User-Agent": USER_AGENT}
    if byte_range is not None:
        start, length = byte_range
        headers["Range"] = f"bytes={start}-{start + length - 1}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        limit = MAX_RECORD_BYTES if byte_range else MAX_INDEX_BYTES
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("response exceeds probe size limit")
        if byte_range is not None:
            if response.status != 206 or len(data) != byte_range[1]:
                raise ValueError("WARC server did not return the requested byte range")
        return response.status, data


def same_source(actual: str, expected: str) -> bool:
    first = urllib.parse.urlsplit(actual)
    second = urllib.parse.urlsplit(expected)
    return (first.scheme, first.netloc, first.path.rstrip("/"), first.query) == (
        second.scheme, second.netloc, second.path.rstrip("/"), second.query
    )


def parse_headers(raw: bytes) -> dict[str, str]:
    lines = raw.decode("latin-1").split("\r\n")
    return dict(line.split(":", 1) for line in lines[1:] if ":" in line)


def extract_html(record: bytes, row: dict, source_url: str) -> bytes:
    warc_headers, remainder = gzip.decompress(record).split(b"\r\n\r\n", 1)
    http_headers, body = remainder.split(b"\r\n\r\n", 1)
    warc = {key.lower(): value.strip() for key, value in parse_headers(warc_headers).items()}
    http = {key.lower(): value.strip() for key, value in parse_headers(http_headers).items()}
    if warc.get("warc-type") != "response" or not same_source(warc.get("warc-target-uri", ""), source_url):
        raise ValueError("WARC record does not identify the requested source")
    warc_date = datetime.fromisoformat(warc["warc-date"].replace("Z", "+00:00"))
    index_date = datetime.strptime(row["timestamp"], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    if warc_date != index_date:
        raise ValueError("WARC date differs from index timestamp")
    if not http_headers.startswith(b"HTTP/1.1 200") or "text/html" not in http.get("content-type", ""):
        raise ValueError("WARC response is not HTML with HTTP 200")
    if http.get("content-encoding") or http.get("transfer-encoding"):
        raise ValueError("encoded HTTP body needs a decoder")
    if "content-length" in http:
        body = body[: int(http["content-length"])]
    if not body or len(body) > MAX_RECORD_BYTES:
        raise ValueError("HTML body is empty or too large")
    return body


def probe(source: dict, year: int) -> dict:
    crawl = CRAWLS[year]
    params = urllib.parse.urlencode({"url": source["url"], "output": "json", "filter": "status:200"})
    index_url = f"https://index.commoncrawl.org/{crawl}-index?{params}"
    result = {"company": source["slug"], "year": year, "crawl": crawl, "source_url": source["url"]}
    for attempt in (1, 2):
        result["index_attempts"] = attempt
        try:
            _, data = request_bytes(index_url)
            result.pop("status", None)
            result.pop("detail", None)
            break
        except urllib.error.HTTPError as error:
            result["status"] = "index_missing" if error.code == 404 else "index_error"
            result["detail"] = f"HTTP {error.code}"
            retry = error.code in (429, 500, 502, 503, 504)
        except (OSError, ValueError) as error:
            result.update(status="index_error", detail=f"{type(error).__name__}: {error}")
            retry = isinstance(error, OSError)
        result.setdefault("index_failures", []).append(result["detail"])
        if not retry or attempt == 2:
            return result
        time.sleep(2)

    try:
        rows = [json.loads(line) for line in data.splitlines() if line]
        cutoff = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        eligible = [
            row for row in rows
            if row.get("status") == "200"
            and row.get("mime") == "text/html"
            and same_source(row.get("url", ""), source["url"])
            and datetime.strptime(row["timestamp"], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc) <= cutoff
        ]
        result["index_rows"] = len(rows)
        if not eligible:
            result["status"] = "no_eligible_record"
            return result
        row = max(eligible, key=lambda item: item["timestamp"])
        length = int(row["length"])
        offset = int(row["offset"])
        if length < 1 or length > MAX_RECORD_BYTES or offset < 0:
            raise ValueError("invalid or oversized WARC locator")
        result.update(captured_at=row["timestamp"], warc_filename=row["filename"], offset=offset, length=length)
        warc_url = "https://data.commoncrawl.org/" + row["filename"]
        _, record = request_bytes(warc_url, byte_range=(offset, length))
        body = extract_html(record, row, source["url"])
        visible_text = normalize(body)
        if len(visible_text) < 100:
            raise ValueError("fewer than 100 visible text characters")
        result.update(status="usable", raw_sha256=hashlib.sha256(body).hexdigest(), text_characters=len(visible_text))
    except (KeyError, OSError, ValueError, EOFError, gzip.BadGzipFile, UnicodeDecodeError) as error:
        result.update(status="retrieval_error", detail=f"{type(error).__name__}: {error}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=Path("sources.json"))
    parser.add_argument("--year", type=int, choices=CRAWLS, action="append", help="repeat for multiple years")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between index queries")
    parser.add_argument("--output", type=Path, help="write JSON results here; otherwise print JSON")
    args = parser.parse_args()
    sources = json.loads(args.sources.read_text())
    years = args.year or list(CRAWLS)
    results = []
    for source in sources:
        for year in years:
            result = probe(source, year)
            results.append(result)
            print(f"{source['slug']} {year}: {result['status']}", file=sys.stderr, flush=True)
            time.sleep(max(0, args.delay))
    output = json.dumps(results, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
