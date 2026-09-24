"""Verify or acquire a bounded batch of primary topology evidence sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


USER_AGENT = "LogPose/0.1 research (https://github.com/haidmoham/log-pose)"


def validate_manifest(manifest: list[dict[str, Any]]) -> None:
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    for item in manifest:
        source_id = item.get("id")
        if not isinstance(source_id, str) or not source_id or source_id in seen_ids:
            raise ValueError(f"invalid or duplicate source ID: {source_id}")
        seen_ids.add(source_id)
        url = item.get("source_url", "")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise ValueError(f"topology source must use an HTTPS URL: {source_id}")
        if url in seen_urls:
            raise ValueError(f"duplicate source URL: {url}")
        seen_urls.add(url)
        for field in ("published_on", "event_on"):
            value = item.get(field)
            if value is not None:
                try:
                    if date.fromisoformat(value).isoformat() != value:
                        raise ValueError
                except (TypeError, ValueError) as error:
                    raise ValueError(f"{source_id}.{field} must use YYYY-MM-DD") from error
        original_retrieval = item.get("retrieved_at")
        if original_retrieval is not None:
            try:
                parsed_retrieval = datetime.fromisoformat(original_retrieval)
            except (TypeError, ValueError) as error:
                raise ValueError(f"{source_id}.retrieved_at must be an ISO timestamp") from error
            if parsed_retrieval.tzinfo is None:
                raise ValueError(f"{source_id}.retrieved_at needs an explicit timezone")
        if not item.get("publisher") or not item.get("title") or not item.get("source_type"):
            raise ValueError(f"topology source metadata is incomplete: {source_id}")


def capture_one(item: dict[str, Any], *, repository_root: Path,
                max_bytes: int, retries: int, timeout_seconds: float,
                refresh: bool = False) -> dict[str, Any]:
    """Capture exact HTTPS response bytes without overwriting prior evidence."""
    artifact_path = repository_root / item["artifact_path"]
    if artifact_path.is_file() and not refresh:
        raw = artifact_path.read_bytes()
        outcome = "verified_existing"
        status_code = None
        final_url = item["source_url"]
        retrieved_at = (
            datetime.fromisoformat(item["retrieved_at"])
            if item.get("retrieved_at")
            else datetime.fromtimestamp(artifact_path.stat().st_mtime, timezone.utc)
        )
    else:
        retrieved_at = datetime.now(timezone.utc)
        request = urllib.request.Request(item["source_url"], headers={"User-Agent": USER_AGENT})
        last_error: Exception | None = None
        raw = b""
        status_code = None
        final_url = item["source_url"]
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                    status_code = response.status
                    final_url = response.geturl()
                    if not final_url.startswith("https://"):
                        raise ValueError("source redirected away from HTTPS")
                    raw = response.read(max_bytes + 1)
                    if len(raw) > max_bytes:
                        raise ValueError(f"source exceeds the {max_bytes}-byte capture limit")
                    break
            except (OSError, urllib.error.URLError, ValueError) as error:
                last_error = error
                if attempt == retries:
                    raise RuntimeError(f"capture failed for {item['id']}: {error}") from error
                time.sleep(min(2 ** attempt, 4))
        if last_error is not None and not raw:
            raise RuntimeError(f"capture failed for {item['id']}: {last_error}") from last_error
        outcome = "captured"

    digest = hashlib.sha256(raw).hexdigest()
    expected_digest = item.get("expected_sha256")
    if expected_digest and not refresh and digest != expected_digest:
        raise ValueError(f"saved source hash differs from manifest: {item['id']}")
    captured_artifact = artifact_path
    if outcome == "captured":
        if expected_digest and digest != expected_digest:
            suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            destination = artifact_path.with_name(f"{artifact_path.stem}-{suffix}-{digest[:8]}{artifact_path.suffix}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            captured_artifact = destination
            outcome = "captured_changed_content_review_required"
        else:
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            if artifact_path.exists():
                existing_digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
                if existing_digest != digest:
                    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                    destination = artifact_path.with_name(f"{artifact_path.stem}-{suffix}-{digest[:8]}{artifact_path.suffix}")
                    destination.write_bytes(raw)
                    captured_artifact = destination
                    outcome = "captured_changed_content_review_required"
                else:
                    outcome = "verified_existing"
            else:
                artifact_path.write_bytes(raw)

    return {
        "id": item["id"],
        "outcome": outcome,
        "source_url": item["source_url"],
        "final_url": final_url,
        "http_status": status_code,
        "retrieved_at": retrieved_at.isoformat(),
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "artifact_path": str(captured_artifact.relative_to(repository_root)),
        "bytes": len(raw),
        "sha256": digest,
        "expected_sha256": expected_digest,
    }


def capture_manifest(manifest: list[dict[str, Any]], *, repository_root: Path,
                     limit: int, max_bytes: int, retries: int,
                     timeout_seconds: float, refresh: bool = False) -> dict[str, Any]:
    validate_manifest(manifest)
    if limit < 1 or limit > 100 or max_bytes < 1024:
        raise ValueError("capture limit must be 1..100 and byte limit at least 1024")
    selected = manifest[:limit]
    results = []
    failures = []
    for item in selected:
        try:
            results.append(capture_one(
                item,
                repository_root=repository_root,
                max_bytes=max_bytes,
                retries=retries,
                timeout_seconds=timeout_seconds,
                refresh=refresh,
            ))
        except Exception as error:
            failures.append({
                "id": item["id"],
                "source_url": item["source_url"],
                "outcome": "failed",
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "error": str(error),
            })
    return {
        "schema_version": "1.0",
        "manifest_count": len(manifest),
        "planned_count": len(selected),
        "captured_or_verified_count": len(results),
        "failed_count": len(failures),
        "refresh_mode": refresh,
        "results": results,
        "failures": failures,
    }


def store_report(report: dict[str, Any], manifest: list[dict[str, Any]]) -> None:
    """Store acquired raw artifacts as immutable source observations in Postgres."""
    from log_pose.storage import connect
    from log_pose.topology_store import store_source

    items_by_id = {item["id"]: item for item in manifest}
    with connect() as connection:
        for result in report["results"]:
            item = items_by_id[result["id"]]
            artifact = Path(result["artifact_path"])
            raw = artifact.read_bytes()
            retrieved_at = datetime.fromisoformat(result["retrieved_at"])
            source_id = f"{item['id']}:{retrieved_at.strftime('%Y%m%dT%H%M%S')}:sha256:{result['sha256']}"
            store_source(
                connection,
                source_id=source_id,
                source_url=item["source_url"],
                publisher=item["publisher"],
                title=item["title"],
                source_type=item["source_type"],
                retrieved_at=retrieved_at,
                raw_body=raw,
                raw_sha256=result["sha256"],
                published_on=date.fromisoformat(item["published_on"]) if item.get("published_on") else None,
            )
        for failure in report["failures"]:
            item = items_by_id[failure["id"]]
            retrieved_at = datetime.fromisoformat(failure["retrieved_at"])
            source_id = f"{item['id']}:{retrieved_at.strftime('%Y%m%dT%H%M%S')}:failed"
            store_source(
                connection,
                source_id=source_id,
                source_url=item["source_url"],
                publisher=item["publisher"],
                title=item["title"],
                source_type=item["source_type"],
                retrieved_at=retrieved_at,
                published_on=date.fromisoformat(item["published_on"]) if item.get("published_on") else None,
                error=failure["error"],
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("docs/research/topology-source-manifest.json"))
    parser.add_argument("--report", type=Path, default=Path("docs/research/topology-acquisition-report.json"))
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--max-bytes", type=int, default=5_000_000)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--store", action="store_true", help="store captured source bodies through topology_store")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    report = capture_manifest(
        manifest,
        repository_root=Path("."),
        limit=args.limit,
        max_bytes=args.max_bytes,
        retries=args.retries,
        timeout_seconds=args.timeout,
        refresh=args.refresh,
    )
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    if args.store:
        store_report(report, manifest)
    print(f"verified or captured {report['captured_or_verified_count']} of {report['planned_count']} sources; "
          f"{report['failed_count']} failed; report: {args.report}")
    if report["failed_count"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
