"""Bounded SEC bulk-reader and annual-fact selection tests."""

import io
import json
import zipfile

import pytest

from log_pose.sec_bulk import (
    ArtifactChangedError,
    RangeZipReader,
    SecBulkError,
    normalize_cik,
    read_companyfacts_member,
    select_annual_facts,
)


ETAG = '"artifact-v1"'
LAST_MODIFIED = "Tue, 01 Oct 2024 12:00:00 GMT"


def _fact(value, end, *, start=None, filed="2024-02-01", form="10-K",
          accession="0000000001-24-000001", fy=2023, fp="FY", frame=None):
    result = {"val": value, "end": end, "filed": filed, "form": form,
              "accn": accession, "fy": fy, "fp": fp}
    if start:
        result["start"] = start
    if frame:
        result["frame"] = frame
    return result


def _companyfacts(cik="1699838"):
    return {
        "cik": int(cik),
        "entityName": "Example, Inc.",
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {"USD": [
                        _fact(1000, "2023-12-31", start="2023-01-01", frame="CY2023"),
                        _fact(250, "2023-09-30", start="2023-07-01", form="10-Q"),
                    ]}
                },
                "Revenues": {
                    "units": {"USD": [
                        _fact(999, "2023-12-31", start="2023-01-01", frame="CY2023")
                    ]}
                },
                "NetIncomeLoss": {
                    "units": {"USD": [
                        _fact(-10, "2023-12-31", start="2023-01-01", frame="CY2023"),
                        _fact(3, "2024-12-31", start="2024-01-01", form="10-K", filed="2025-02-01")
                    ]}
                },
                "Assets": {
                    "units": {"USD": [
                        _fact(5000, "2023-12-31", start=None, frame="CY2023I"),
                        _fact(500, "2023-09-30", start="2023-01-01", form="10-K")
                    ]}
                },
            }
        },
    }


def _zip_bytes():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("CIK0001699838.json", json.dumps(_companyfacts()))
        archive.writestr("padding.bin", bytes(range(256)) * 32, compress_type=zipfile.ZIP_STORED)
    return buffer.getvalue()


class FakeResponse:
    def __init__(self, status, headers, body=b""):
        self.status = status
        self.headers = headers
        self._body = body

    def read(self, size=-1):
        if size < 0:
            return self._body
        result, self._body = self._body[:size], self._body[size:]
        return result

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class FakeRangeServer:
    def __init__(self, body, *, ignore_range=False, etag=ETAG):
        self.body = body
        self.ignore_range = ignore_range
        self.etag = etag
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        headers = {
            "Content-Length": str(len(self.body)),
            "ETag": ETAG,
            "Last-Modified": LAST_MODIFIED,
            "Accept-Ranges": "bytes",
        }
        if request.get_method() == "HEAD":
            return FakeResponse(200, headers)
        if self.ignore_range:
            return FakeResponse(200, headers, self.body)
        byte_range = request.get_header("Range")
        assert byte_range is not None
        start, end = map(int, byte_range.removeprefix("bytes=").split("-"))
        body = self.body[start:end + 1]
        headers.update({
            "Content-Length": str(len(body)),
            "Content-Range": f"bytes {start}-{end}/{len(self.body)}",
            "ETag": self.etag,
        })
        return FakeResponse(206, headers, body)


def test_normalize_cik_and_retain_annual_candidates():
    assert normalize_cik("1699838") == "0001699838"
    assert normalize_cik(1699838) == "0001699838"
    with pytest.raises(ValueError):
        normalize_cik("not-a-cik")

    facts = select_annual_facts(_companyfacts(), 2021, 2024)
    assert {(fact["concept_group"], fact["tag"]) for fact in facts} == {
        ("revenue", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("revenue", "Revenues"),
        ("net_income", "NetIncomeLoss"),
        ("assets", "Assets"),
    }
    revenue = next(fact for fact in facts if fact["concept_group"] == "revenue")
    assert revenue["value"].as_tuple().exponent == 0
    assert (revenue["start_date"].isoformat(), revenue["end_date"].isoformat()) == (
        "2023-01-01", "2023-12-31"
    )
    assert revenue["filed_date"].isoformat() == "2024-02-01"
    assert revenue["accession_number"] == "0000000001-24-000001"
    assert all(fact["end_date"].year in range(2021, 2025) for fact in facts)
    assert all(not (fact["concept_group"] == "assets" and fact["start_date"])
               for fact in facts)


def test_revenue_candidate_for_including_assessed_tax_is_retained():
    document = _companyfacts()
    document["facts"]["us-gaap"]["RevenueFromContractWithCustomerIncludingAssessedTax"] = {
        "units": {"USD": [_fact(2000, "2022-12-31", start="2022-01-01")]}
    }
    facts = select_annual_facts(document)
    assert any(fact["tag"] == "RevenueFromContractWithCustomerIncludingAssessedTax"
               and fact["end_date"].year == 2022 for fact in facts)


def test_seekable_reader_fetches_ranges_and_extracts_exact_member():
    body = _zip_bytes()
    server = FakeRangeServer(body)
    with RangeZipReader(
        "https://sec.example/companyfacts.zip", user_agent="Log Pose test test@example.com",
        block_bytes=1024, cache_blocks=4, minimum_request_interval=0, opener=server,
    ) as ranged:
        assert ranged.metadata.etag == ETAG
        assert ranged.metadata.last_modified == LAST_MODIFIED
        with zipfile.ZipFile(ranged) as archive:
            member = read_companyfacts_member(archive, "1699838")
        assert member.cik == "0001699838"
        assert member.member_name == "CIK0001699838.json"
        assert member.entity_name == "Example, Inc."
        assert member.facts
        assert ranged.bytes_transferred < len(body)
        assert all(request.get_header("If-range") == ETAG for request in server.requests[1:])
        assert all(request.get_header("Accept-encoding") == "identity" for request in server.requests)


def test_range_reader_rejects_server_that_ignores_range():
    server = FakeRangeServer(_zip_bytes(), ignore_range=True)
    ranged = RangeZipReader("https://sec.example/companyfacts.zip",
                            user_agent="Log Pose test test@example.com",
                            minimum_request_interval=0, opener=server)
    with pytest.raises(SecBulkError, match="ignored or rejected byte range"):
        ranged.read(10)
    ranged.close()


def test_range_reader_rejects_changed_artifact_validator():
    server = FakeRangeServer(_zip_bytes(), etag='"artifact-v2"')
    ranged = RangeZipReader("https://sec.example/companyfacts.zip",
                            user_agent="Log Pose test test@example.com",
                            minimum_request_interval=0, opener=server)
    with pytest.raises(ArtifactChangedError, match="ETag changed"):
        ranged.read(10)
    ranged.close()


def test_member_validation_rejects_wrong_cik_and_oversized_payload():
    body = io.BytesIO()
    with zipfile.ZipFile(body, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("CIK0001699838.json", json.dumps(_companyfacts("1321655")))
    with zipfile.ZipFile(io.BytesIO(body.getvalue())) as archive:
        with pytest.raises(SecBulkError, match="payload CIK"):
            read_companyfacts_member(archive, "1699838")
        with pytest.raises(SecBulkError, match="uncompressed size"):
            read_companyfacts_member(archive, "1699838", max_member_bytes=10)
