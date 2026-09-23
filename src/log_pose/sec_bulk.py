"""Read selected SEC companyfacts members from the official range-readable ZIP."""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Callable


COMPANYFACTS_URL = "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"
DEFAULT_BLOCK_BYTES = 1024 * 1024
DEFAULT_CACHE_BLOCKS = 8
DEFAULT_MAX_MEMBER_BYTES = 20 * 1024 * 1024
DEFAULT_MAX_COMPRESSED_MEMBER_BYTES = 10 * 1024 * 1024
ANNUAL_FORMS = frozenset({"10-K", "20-F", "40-F"})
ANNUAL_DURATION_MIN_DAYS = 330
ANNUAL_DURATION_MAX_DAYS = 400

_CONCEPTS = {
    "revenue": (
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "Revenues"),
        ("us-gaap", "SalesRevenueNet"),
        ("ifrs-full", "Revenue"),
        ("ifrs-full", "RevenueFromContractsWithCustomers"),
    ),
    "net_income": (
        ("us-gaap", "NetIncomeLoss"),
        ("us-gaap", "ProfitLoss"),
        ("ifrs-full", "ProfitLoss"),
    ),
    "assets": (
        ("us-gaap", "Assets"),
        ("ifrs-full", "Assets"),
    ),
}
_CURRENCY_UNIT = re.compile(r"^[A-Z]{3}$")
_CONTENT_RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")


class SecBulkError(RuntimeError):
    """Raised when the SEC artifact or a requested member fails validation."""


class ArtifactChangedError(SecBulkError):
    """Raised when a ranged response no longer matches the pinned ZIP version."""


@dataclass(frozen=True)
class ArtifactMetadata:
    source_url: str
    artifact_version: str
    etag: str
    last_modified: str
    content_length: int
    observed_at: datetime


@dataclass(frozen=True)
class CompanyFactsMember:
    cik: str
    member_name: str
    entity_name: str
    raw_json: bytes
    raw_sha256: str
    facts: tuple[dict, ...]


def normalize_cik(value: str | int) -> str:
    """Return a zero-padded SEC CIK or reject an invalid identifier."""
    digits = str(value).strip()
    if not digits.isdigit() or len(digits) > 10:
        raise ValueError(f"invalid CIK: {value!r}")
    return digits.zfill(10)


class RangeZipReader:
    """A small, cached, ETag-pinned seekable view of an HTTP ZIP file.

    Every network response is one aligned byte range. Servers that ignore the
    Range header, change validators, compress the response, or return a range
    inconsistent with the original HEAD metadata are rejected.
    """

    def __init__(
        self,
        url: str = COMPANYFACTS_URL,
        *,
        user_agent: str,
        block_bytes: int = DEFAULT_BLOCK_BYTES,
        cache_blocks: int = DEFAULT_CACHE_BLOCKS,
        minimum_request_interval: float = 0.11,
        timeout: float = 30,
        opener: Callable = urllib.request.urlopen,
    ):
        if not user_agent.strip():
            raise ValueError("a declared SEC User-Agent is required")
        if block_bytes <= 0 or cache_blocks <= 0 or minimum_request_interval < 0:
            raise ValueError("invalid range reader bounds")
        self.url = url
        self.user_agent = user_agent.strip()
        self.block_bytes = block_bytes
        self.cache_blocks = cache_blocks
        self.minimum_request_interval = minimum_request_interval
        self.timeout = timeout
        self._opener = opener
        self._cache: OrderedDict[int, bytes] = OrderedDict()
        self._position = 0
        self._closed = False
        self.request_count = 0
        self.bytes_transferred = 0
        self._last_request_time = 0.0
        self.metadata = self._read_metadata()

    def _headers(self) -> dict[str, str]:
        return {"User-Agent": self.user_agent, "Accept-Encoding": "identity"}

    def _request(self, request: urllib.request.Request):
        elapsed = time.monotonic() - self._last_request_time
        if elapsed < self.minimum_request_interval:
            time.sleep(self.minimum_request_interval - elapsed)
        self._last_request_time = time.monotonic()
        self.request_count += 1
        try:
            return self._opener(request, timeout=self.timeout)
        except urllib.error.HTTPError as error:
            raise SecBulkError(f"SEC request failed with HTTP {error.code}") from error
        except (OSError, TimeoutError) as error:
            raise SecBulkError(f"SEC request failed: {type(error).__name__}") from error

    def _read_metadata(self) -> ArtifactMetadata:
        request = urllib.request.Request(self.url, headers=self._headers(), method="HEAD")
        with self._request(request) as response:
            if response.status != 200:
                raise SecBulkError(f"SEC HEAD returned HTTP {response.status}")
            headers = response.headers
            raw_length = headers.get("Content-Length")
            etag = headers.get("ETag")
            last_modified = headers.get("Last-Modified")
        try:
            content_length = int(raw_length)
        except (TypeError, ValueError) as error:
            raise SecBulkError("SEC HEAD omitted a valid Content-Length") from error
        if content_length <= 0:
            raise SecBulkError("SEC ZIP has an invalid Content-Length")
        if not etag or not last_modified:
            raise SecBulkError("SEC HEAD must provide both ETag and Last-Modified")
        if etag.startswith("W/"):
            raise SecBulkError("SEC ZIP returned a weak ETag; byte identity cannot be pinned")
        identity = "\n".join((self.url, etag, last_modified, str(content_length)))
        version = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        return ArtifactMetadata(
            source_url=self.url,
            artifact_version=version,
            etag=etag,
            last_modified=last_modified,
            content_length=content_length,
            observed_at=datetime.now(timezone.utc),
        )

    def readable(self) -> bool:
        return not self._closed

    def seekable(self) -> bool:
        return not self._closed

    def tell(self) -> int:
        self._check_open()
        return self._position

    def seek(self, offset: int, whence: int = 0) -> int:
        self._check_open()
        if whence == 0:
            position = offset
        elif whence == 1:
            position = self._position + offset
        elif whence == 2:
            position = self.metadata.content_length + offset
        else:
            raise ValueError("invalid seek origin")
        if position < 0:
            raise ValueError("negative seek position")
        self._position = position
        return position

    def read(self, size: int = -1) -> bytes:
        self._check_open()
        if size is None or size < 0:
            size = self.metadata.content_length - self._position
        size = min(size, max(0, self.metadata.content_length - self._position))
        pieces = []
        remaining = size
        while remaining:
            block_number = self._position // self.block_bytes
            block_offset = self._position % self.block_bytes
            block = self._get_block(block_number)
            count = min(remaining, len(block) - block_offset)
            if count <= 0:
                break
            pieces.append(block[block_offset:block_offset + count])
            self._position += count
            remaining -= count
        return b"".join(pieces)

    def _get_block(self, block_number: int) -> bytes:
        cached = self._cache.get(block_number)
        if cached is not None:
            self._cache.move_to_end(block_number)
            return cached

        start = block_number * self.block_bytes
        end = min(start + self.block_bytes, self.metadata.content_length) - 1
        headers = self._headers()
        headers["Range"] = f"bytes={start}-{end}"
        headers["If-Range"] = self.metadata.etag
        request = urllib.request.Request(self.url, headers=headers, method="GET")
        with self._request(request) as response:
            if response.status != 206:
                raise SecBulkError(f"SEC ignored or rejected byte range (HTTP {response.status})")
            response_headers = response.headers
            content_range = response_headers.get("Content-Range", "")
            match = _CONTENT_RANGE.fullmatch(content_range)
            if not match or tuple(map(int, match.groups())) != (start, end, self.metadata.content_length):
                raise SecBulkError("SEC returned an invalid Content-Range")
            if response_headers.get("Content-Encoding", "identity").lower() not in ("", "identity"):
                raise SecBulkError("SEC encoded a ranged ZIP response")
            if response_headers.get("ETag") != self.metadata.etag:
                raise ArtifactChangedError("SEC ZIP ETag changed during ranged retrieval")
            response_modified = response_headers.get("Last-Modified")
            if response_modified != self.metadata.last_modified:
                raise ArtifactChangedError("SEC ZIP Last-Modified changed during ranged retrieval")
            expected = end - start + 1
            raw_length = response_headers.get("Content-Length")
            if raw_length is not None and raw_length != str(expected):
                raise SecBulkError("SEC returned a mismatched range Content-Length")
            block = response.read(expected + 1)
        if len(block) != expected:
            raise SecBulkError("SEC returned a truncated or oversized byte range")
        self.bytes_transferred += len(block)
        self._cache[block_number] = block
        self._cache.move_to_end(block_number)
        while len(self._cache) > self.cache_blocks:
            self._cache.popitem(last=False)
        return block

    def _check_open(self) -> None:
        if self._closed:
            raise ValueError("I/O operation on closed SEC range reader")

    def close(self) -> None:
        self._closed = True
        self._cache.clear()

    def __enter__(self) -> RangeZipReader:
        self._check_open()
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


def read_companyfacts_member(
    archive: zipfile.ZipFile,
    cik: str | int,
    *,
    max_member_bytes: int = DEFAULT_MAX_MEMBER_BYTES,
    max_compressed_bytes: int = DEFAULT_MAX_COMPRESSED_MEMBER_BYTES,
    years: tuple[int, int] = (2021, 2024),
) -> CompanyFactsMember:
    """Read and validate one exact CIK member from an open ZIP archive."""
    cik_digits = normalize_cik(cik)
    member_name = f"CIK{cik_digits}.json"
    matches = [info for info in archive.infolist() if info.filename == member_name]
    if len(matches) != 1:
        raise SecBulkError(f"expected one {member_name} ZIP member, found {len(matches)}")
    info = matches[0]
    if info.file_size <= 0 or info.file_size > max_member_bytes:
        raise SecBulkError(f"{member_name} uncompressed size is outside the configured limit")
    if info.compress_size <= 0 or info.compress_size > max_compressed_bytes:
        raise SecBulkError(f"{member_name} compressed size is outside the configured limit")
    with archive.open(info, "r") as member:
        raw_json = member.read(max_member_bytes + 1)
    if len(raw_json) != info.file_size:
        raise SecBulkError(f"{member_name} did not match its ZIP directory size")
    try:
        document = json.loads(raw_json)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise SecBulkError(f"{member_name} is not valid JSON") from error
    try:
        payload_cik = normalize_cik(document.get("cik", ""))
    except (TypeError, ValueError) as error:
        raise SecBulkError(f"{member_name} payload omitted a valid CIK") from error
    if payload_cik != cik_digits:
        raise SecBulkError(f"{member_name} payload CIK does not match its filename")
    entity_name = document.get("entityName")
    if not isinstance(entity_name, str) or not entity_name.strip():
        raise SecBulkError(f"{member_name} omitted entityName")
    return CompanyFactsMember(
        cik=cik_digits,
        member_name=member_name,
        entity_name=entity_name,
        raw_json=raw_json,
        raw_sha256=hashlib.sha256(raw_json).hexdigest(),
        facts=tuple(select_annual_facts(document, years[0], years[1])),
    )


def select_annual_facts(document: dict, year_from: int = 2021, year_to: int = 2024) -> list[dict]:
    """Select preferred standard revenue, net income, and assets facts.

    Flow facts need a 330–400 day duration; assets facts are instantaneous.
    Only annual SEC forms and three-letter monetary units are retained. The
    filing attributes remain attached so callers can impose a filing-date
    cutoff and distinguish restatements or fiscal calendars later.
    """
    if year_from > year_to:
        raise ValueError("year_from must not exceed year_to")
    fact_roots = document.get("facts", {})
    selected = []
    for concept_group, candidates in _CONCEPTS.items():
        for taxonomy, tag in candidates:
            concept = fact_roots.get(taxonomy, {}).get(tag)
            if not isinstance(concept, dict):
                continue
            observations = []
            for unit, values in concept.get("units", {}).items():
                if not _CURRENCY_UNIT.fullmatch(unit):
                    continue
                for fact_index, observation in enumerate(values):
                    record = _parse_fact(concept_group, taxonomy, tag, unit, fact_index, observation)
                    if record is None or not _is_annual(record, concept_group, year_from, year_to):
                        continue
                    observations.append(record)
            if observations:
                selected.extend(observations)
                break
    return selected


def _parse_fact(concept_group: str, taxonomy: str, tag: str, unit: str,
                fact_index: int, observation: dict) -> dict | None:
    if "val" not in observation or "end" not in observation:
        return None
    try:
        value = Decimal(str(observation["val"]))
        end_date = date.fromisoformat(observation["end"])
        start_date = date.fromisoformat(observation["start"]) if observation.get("start") else None
        filed_date = date.fromisoformat(observation["filed"]) if observation.get("filed") else None
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not value.is_finite() or filed_date is None:
        return None
    try:
        fy = int(observation["fy"]) if observation.get("fy") is not None else None
    except (TypeError, ValueError):
        fy = None
    return {
        "concept_group": concept_group,
        "taxonomy": taxonomy,
        "tag": tag,
        "unit": unit,
        "fact_index": fact_index,
        "value": value,
        "start_date": start_date,
        "end_date": end_date,
        "filed_date": filed_date,
        "accession_number": observation.get("accn"),
        "form": observation.get("form"),
        "fy": fy,
        "fp": observation.get("fp"),
        "frame": observation.get("frame"),
    }


def _is_annual(record: dict, concept_group: str, year_from: int, year_to: int) -> bool:
    if record["form"] not in ANNUAL_FORMS or not year_from <= record["end_date"].year <= year_to:
        return False
    if concept_group == "assets":
        return record["start_date"] is None
    if record["start_date"] is None:
        return False
    days = (record["end_date"] - record["start_date"]).days
    return ANNUAL_DURATION_MIN_DAYS <= days <= ANNUAL_DURATION_MAX_DAYS
