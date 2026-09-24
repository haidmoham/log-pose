"""Pull pinned landscape inventories into source-backed product candidates.

An inventory item is a dated directory observation. It does not establish a
company, U.S. location, launch date, operating status, or investment fit.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import yaml


STUDY_YEARS = (2021, 2022, 2023, 2024)
EXTENDED_INVENTORY_YEARS = (2020, 2025, 2026)

PINS = {
    "cncf": {
        "repository": "cncf/landscape",
        "commits": {
            2020: ("28a8fde7a335237d1a2ee1c9c327fbd37763aff4", "2020-12-31T00:34:10Z"),
            2021: ("f3ff2dc3fd73c9239eb454e189934fb150afb383", "2021-12-24T05:52:34Z"),
            2022: ("8b765491cc9a6e94e52039c2c515c68638e2c743", "2022-12-30T20:05:50Z"),
            2023: ("bd539b9fef36c09fbdc99a6063ad53e8515baf53", "2023-12-23T01:01:22Z"),
            2024: ("e4f13c918275affaefb3dbe1a21a4a8e38ee3842", "2024-12-31T14:58:22Z"),
            2025: ("1f32900465c936f9acb4ff77485f58ac28943ffb", "2025-12-17T01:27:26Z"),
            2026: ("97b2e16fdf4147166df9427299998a83991b0958", "2026-09-24T17:42:07Z"),
        },
    },
    "lfai": {
        "repository": "lfai/lfai-landscape",
        "commits": {
            2020: ("625e263540f5981f8f5ac87c9fa247f9cf6c12c5", "2020-12-24T01:45:12Z"),
            2021: ("b7bad8d8d544f2a7dca4c933ac76652e0ae5cee0", "2021-12-18T04:32:45Z"),
            2022: ("1c995e69a864aedd7f0df72211dab36c5592dadb", "2022-12-31T04:20:38Z"),
            2023: ("a634762cbac70264b3033b985a6743f8c0363d6b", "2023-12-27T09:26:18Z"),
            2024: ("9999a5ca4ddae6d202e83606ed6f84b368bc0099", "2024-12-19T04:29:51Z"),
            2025: ("0d5994f96e08f09b422c66ab18d58726a0f81198", "2025-11-12T23:34:02Z"),
            2026: ("89922e943636db043e9a1c6cf47ce5cebfa5a9a7", "2026-09-02T15:52:50Z"),
        },
    },
}

EXPECTED_SHA256 = {
    ("cncf", 2020): "9b14a66831a391b1d15ee0068e9acbea06a119c26c9aaf2903e02246aaf38577",
    ("cncf", 2021): "da810037b82d7d4f8b73b7fd92d93421e082225b0ea4ba72e63221ace8277ed6",
    ("cncf", 2022): "fd5c99efd9bb8981f86cec6855f59978e956452d7e0638dd41bd79b34e71a3d2",
    ("cncf", 2023): "2bc00cfcfef6f5b908a2da0f6993bc7aa01879faf72a8461f7bbc0060dd75432",
    ("cncf", 2024): "f1036cb6b8e9b9ef7647a0203ac349ba308173bf407f79cc8ccd4d4a2e7d46fd",
    ("cncf", 2025): "bec9090cd40a09a8f1bd913cc4d47a5710ce7d3a92ee7091369d54a31d1f677f",
    ("cncf", 2026): "23b2b56cf6cb60d48b7f0923a527ebd9aac1e3418d30ce593ff7739cc8483e9b",
    ("lfai", 2020): "7bff0e731a826d45fe71f1793e19c850ac3f1640ebcb62c83c82a84876e1dd09",
    ("lfai", 2021): "67a01cf1866de1c62ef79d43e3e2bb2da17e8622b94255c1e81120d827144f2d",
    ("lfai", 2022): "e2583bce1f7ac000ff894032116d44946686dfa05c8adff6d5483ca1aa8e3fe3",
    ("lfai", 2023): "0765d26680e0f526665600790b291ccb42e8716807366b2f1d5c5c5e3d50106a",
    ("lfai", 2024): "22915df88f4e3b18f28563445baeb22bceb446763774015edcf74b788480adb8",
    ("lfai", 2025): "2649f7727e419fd38892e58dabf75316c12f869f0fa859c2bb44d9a5055602f3",
    ("lfai", 2026): "8a929756135009f7373b9c4b0a8a1a965f681f70972eefdaa39336774619a378",
}

# Exact source paths only. These tags nominate records for review; they do not
# classify companies. Top-level categories alone are too broad and can repeat.
CNCF_RULES = {
    ("App Definition and Development", "Database"): ("data_infrastructure",),
    ("App Definition and Development", "Streaming & Messaging"): ("data_infrastructure",),
    ("Runtime", "Cloud Native Storage"): ("data_infrastructure",),
    ("App Definition and Development", "Application Definition & Image Build"): ("developer_tools",),
    ("App Definition and Development", "Continuous Integration & Delivery"): ("developer_tools",),
    ("Provisioning", "Container Registry"): ("developer_tools",),
    ("Orchestration & Management", "API Gateway"): ("developer_tools",),
    ("Observability and Analysis", "Feature Flagging"): ("developer_tools",),
    ("Provisioning", "Security & Compliance"): ("security_observability",),
    ("Provisioning", "Key Management"): ("security_observability",),
    ("Serverless", "Security"): ("security_observability",),
    ("Observability and Analysis", "Monitoring"): ("security_observability",),
    ("Observability and Analysis", "Logging"): ("security_observability",),
    ("Observability and Analysis", "Tracing"): ("security_observability",),
    ("Observability and Analysis", "Observability"): ("security_observability",),
    ("Wasm", "Debugging and Observability"): ("security_observability",),
    ("Wasm", "Debugging & Observability"): ("security_observability",),
    ("CNAI", "Vector Databases"): ("data_infrastructure", "ai_automation"),
    ("CNAI", "Data Architecture"): ("data_infrastructure", "ai_automation"),
    ("CNAI", "Workload Observability"): ("security_observability", "ai_automation"),
    ("CNAI", "Model/LLM Observability"): ("security_observability", "ai_automation"),
    ("CNAI", "Governance, Policy & Security"): ("security_observability", "ai_automation"),
    ("CNAI", "General Orchestration"): ("ai_automation",),
    ("CNAI", "ML Serving"): ("ai_automation",),
    ("CNAI", "CI/CD - Delivery"): ("ai_automation",),
    ("CNAI", "Data Science"): ("ai_automation",),
    ("CNAI", "Distributed Training"): ("ai_automation",),
    ("CNAI", "AutoML"): ("ai_automation",),
    ("Wasm", "AI/Machine Learning"): ("ai_automation",),
}

LFAI_DATA_SUBCATEGORIES = {
    "Lineage", "Relational DB", "Store & Format", "Versioning", "Operations",
    "Feature Engineering", "Stream Processing", "SQL Engine", "Pipeline Management",
}
LFAI_AI_CATEGORIES = {
    "Machine Learning", "Deep Learning", "Reinforcement Learning", "Generative AI",
    "Natural Language Processing", "Model", "Trusted & Responsible AI",
}


def candidate_tags(source: str, category: str, subcategory: str) -> tuple[str, ...]:
    if source == "cncf":
        return CNCF_RULES.get((category, subcategory), ())
    if category == "Data" and subcategory in LFAI_DATA_SUBCATEGORIES:
        return ("data_infrastructure",)
    if category == "Notebook Environment":
        return ("developer_tools", "ai_automation")
    if category == "Security & Privacy":
        return ("security_observability", "ai_automation")
    if category in LFAI_AI_CATEGORIES:
        return ("ai_automation",)
    return ()


def source_url(repository: str, commit: str, *, raw: bool) -> str:
    if raw:
        return f"https://raw.githubusercontent.com/{repository}/{commit}/landscape.yml"
    return f"https://github.com/{repository}/blob/{commit}/landscape.yml"


def fetch_pinned(source: str, year: int, cache_dir: Path, *, offline: bool = False) -> tuple[bytes, dict]:
    pin = PINS[source]
    commit, commit_at = pin["commits"][year]
    cache_path = cache_dir / f"{source}-{year}-{commit}.yml"
    downloaded = False
    retained_path = Path("docs/research/source-artifacts/discovery") / f"{source}-{year}-{commit[:12]}.yml"
    if cache_path.exists():
        raw = cache_path.read_bytes()
    elif retained_path.exists():
        raw = retained_path.read_bytes()
    elif offline:
        raise FileNotFoundError(cache_path)
    else:
        request = urllib.request.Request(
            source_url(pin["repository"], commit, raw=True),
            headers={"User-Agent": "LogPose/0.1 research (https://github.com/haidmoham/log-pose)"},
        )
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError(f"{source} {year} landscape exceeds 5 MB")
        downloaded = True
    if len(raw) > 5_000_000:
        raise ValueError(f"{source} {year} cached landscape exceeds 5 MB")
    if datetime.fromisoformat(commit_at.replace("Z", "+00:00")) > datetime(
            year, 12, 31, 23, 59, 59, tzinfo=timezone.utc):
        raise ValueError("source commit is after its study year")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_SHA256[source, year]:
        raise ValueError(f"{source} {year} landscape differs from reviewed source hash")
    if downloaded:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(raw)
    return raw, {
        "source": source,
        "repository": pin["repository"],
        "year": year,
        "commit": commit,
        "commit_at": commit_at,
        "observation_basis": "point_in_time_repository_state",
        "coverage_status": "partial_year_snapshot" if year == 2026 else "dated_inventory_snapshot",
        "url": source_url(pin["repository"], commit, raw=False),
        "raw_sha256": digest,
        "bytes": len(raw),
        "artifact_path": f"docs/research/source-artifacts/discovery/{source}-{year}-{commit[:12]}.yml",
    }


def parse_occurrences(raw: bytes, artifact: dict) -> tuple[list[dict], int]:
    document = yaml.safe_load(raw)
    categories = document.get("landscape") if isinstance(document, dict) else None
    if not isinstance(categories, list):
        raise ValueError("landscape.yml has no category list")
    observations = []
    raw_item_count = 0
    for category_index, category in enumerate(categories):
        category_name = category["name"]
        for subcategory_index, subcategory in enumerate(category["subcategories"]):
            subcategory_name = subcategory["name"]
            tags = candidate_tags(artifact["source"], category_name, subcategory_name)
            for item_index, item in enumerate(subcategory.get("items") or []):
                raw_item_count += 1
                if not tags or not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not isinstance(name, str) or not name.strip():
                    continue
                location = [category_index, subcategory_index, item_index]
                identity = json.dumps([artifact["source"], artifact["year"], location])
                observations.append({
                    "id": hashlib.sha256(identity.encode()).hexdigest()[:20],
                    "source": artifact["source"],
                    "year": artifact["year"],
                    "artifact_sha256": artifact["raw_sha256"],
                    "source_url": artifact["url"],
                    "source_path": location,
                    "name": name.strip(),
                    "description": (item.get("description") or "").strip(),
                    "homepage_url": item.get("homepage_url") or "",
                    "repo_url": item.get("repo_url") or "",
                    "source_category": category_name,
                    "source_subcategory": subcategory_name,
                    "candidate_tags": list(tags),
                })
    return observations, raw_item_count


def parse_inventory_rows(raw: bytes, artifact: dict) -> list[dict]:
    """Return every dictionary item at its source path, including unmapped rows."""
    document = yaml.safe_load(raw)
    categories = document.get("landscape") if isinstance(document, dict) else None
    if not isinstance(categories, list):
        raise ValueError("landscape.yml has no category list")
    rows = []
    for category_index, category in enumerate(categories):
        for subcategory_index, subcategory in enumerate(category["subcategories"]):
            for item_index, item in enumerate(subcategory.get("items") or []):
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                tags = candidate_tags(artifact["source"], category["name"], subcategory["name"])
                location = [category_index, subcategory_index, item_index]
                identity = json.dumps([artifact["source"], artifact["year"], location])
                rows.append({
                    "id": hashlib.sha256(identity.encode()).hexdigest()[:20],
                    "source": artifact["source"],
                    "year": artifact["year"],
                    "artifact_sha256": artifact["raw_sha256"],
                    "source_url": artifact["url"],
                    "source_path": location,
                    "name": name.strip() if isinstance(name, str) else "",
                    "description": item.get("description", "") if isinstance(item.get("description"), str) else "",
                    "homepage_url": item.get("homepage_url", "") if isinstance(item.get("homepage_url"), str) else "",
                    "repo_url": item.get("repo_url", "") if isinstance(item.get("repo_url"), str) else "",
                    "source_category": category["name"],
                    "source_subcategory": subcategory["name"],
                    "candidate_tags": list(tags),
                    "mapping_status": "mapped_category" if tags else "unmapped_category",
                    "record_type": "product_or_project_candidate" if tags else "unmapped_directory_row",
                })
    return rows


def normalized_url(value: str) -> str:
    if not isinstance(value, str) or not value.startswith(("http://", "https://")):
        return ""
    parsed = urlsplit(value)
    host = parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""
    path = parsed.path.rstrip("/").lower()
    return urlunsplit(("https", host, path, "", "")) if host else ""


def candidate_key(observation: dict) -> str:
    name = re.sub(r"\s+", " ", observation["name"].casefold()).strip()
    homepage = normalized_url(observation["homepage_url"])
    repository = normalized_url(observation["repo_url"])
    return json.dumps([name, homepage or repository], ensure_ascii=False)


def build_candidates(observations: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for observation in observations:
        key = candidate_key(observation)
        candidate = grouped.get(key)
        if candidate is None:
            candidate = {
                "id": hashlib.sha256(key.encode()).hexdigest()[:20],
                "name": observation["name"],
                "description": observation["description"],
                "homepage_url": observation["homepage_url"],
                "repo_url": observation["repo_url"],
                "source_categories": [],
                "candidate_tags": [],
                "observed_years": [],
                "sources": [],
                "occurrence_ids": [],
                "record_type": "product_or_project_candidate",
                "us_status": "unreviewed",
                "company_status": "unreviewed",
            }
            grouped[key] = candidate
        if not candidate["description"] and observation["description"]:
            candidate["description"] = observation["description"]
        path = observation["source_category"] + " / " + observation["source_subcategory"]
        if path not in candidate["source_categories"]:
            candidate["source_categories"].append(path)
        for field, value in (("observed_years", observation["year"]),
                             ("sources", observation["source"])):
            if value not in candidate[field]:
                candidate[field].append(value)
        for tag in observation["candidate_tags"]:
            if tag not in candidate["candidate_tags"]:
                candidate["candidate_tags"].append(tag)
        candidate["occurrence_ids"].append(observation["id"])
    for candidate in grouped.values():
        candidate["observed_years"].sort()
        candidate["sources"].sort()
        candidate["candidate_tags"].sort()
        candidate["source_categories"].sort()
    return sorted(grouped.values(), key=lambda item: (item["name"].casefold(), item["id"]))


def link_pilot_candidates(candidates: list[dict], cohort: list[dict]) -> int:
    """Attach a possible pilot match when name and full homepage both agree.

    This links two source records for navigation. It does not establish legal
    ownership, U.S. location, or a historical alias.
    """
    pilot_keys = {}
    for company in cohort:
        key = (company["name"].casefold(), normalized_url(company["url"]))
        if key[1]:
            pilot_keys.setdefault(key, []).append(company["slug"])
    matches = 0
    for candidate in candidates:
        key = (candidate["name"].casefold(), normalized_url(candidate["homepage_url"]))
        slugs = pilot_keys.get(key, [])
        if len(slugs) == 1:
            candidate["pilot_match"] = {
                "slug": slugs[0],
                "basis": "exact_name_and_homepage_v1",
                "status": "navigation_match_unreviewed",
            }
            matches += 1
    return matches


def attach_identity_reviews(index: dict, reviews: list[dict], cohort: list[dict]) -> int:
    """Attach manually reviewed provider relationships without merging raw rows.

    A provider link is a research lead, not a U.S. eligibility or ownership
    finding. Multiple candidate keys can share one reviewed identity.
    """
    candidates = {candidate["id"]: candidate for candidate in index["candidates"]}
    pilot_slugs = {company["slug"] for company in cohort}
    if len(reviews) != 20:
        raise ValueError("expected the fixed 20-record identity challenge")
    seen = set()
    for number, review in enumerate(reviews, start=1):
        ids = review["candidate_ids"]
        if not ids or len(set(ids)) != len(ids):
            raise ValueError(f"invalid candidate IDs in identity review {number}")
        for candidate_id in ids:
            if candidate_id not in candidates or candidate_id in seen:
                raise ValueError(f"unknown or duplicate reviewed candidate {candidate_id}")
            seen.add(candidate_id)
        if review["item_kind"] not in {"company_brand", "product", "project"}:
            raise ValueError(f"invalid item kind in identity review {number}")
        if review["provider_relation"] not in {
                "company_offering", "developer", "product_line",
                "commercial_distribution", "managed_service", "none"}:
            raise ValueError(f"invalid provider relation in identity review {number}")
        if (review["provider_relation"] == "none") != (review["provider_name"] is None):
            raise ValueError(f"provider name and relation disagree in identity review {number}")
        if review["pilot_slug"] is not None:
            if review["pilot_slug"] not in pilot_slugs:
                raise ValueError(f"unknown pilot company in identity review {number}")
            if any(candidates[candidate_id].get("pilot_match", {}).get("slug") != review["pilot_slug"]
                   for candidate_id in ids):
                raise ValueError(f"pilot link lacks exact source navigation match in review {number}")
        if review["source_year"] not in STUDY_YEARS or not review["source_url"].startswith("https://"):
            raise ValueError(f"identity review lacks dated source {number}")
        if not review["review_note"].strip():
            raise ValueError(f"identity review lacks reasoning {number}")
        us_evidence = review.get("us_evidence")
        if us_evidence:
            if (us_evidence["source_year"] not in STUDY_YEARS
                    or us_evidence["location_kind"] not in {"headquarters", "stated_base", "office_hub"}
                    or not us_evidence["place"].strip()
                    or not us_evidence["source_url"].startswith("https://")
                    or not us_evidence["source_note"].strip()):
                raise ValueError(f"invalid U.S. evidence in identity review {number}")
        review["id"] = f"identity-review-{number:02d}"
        for candidate_id in ids:
            candidates[candidate_id]["identity_review_id"] = review["id"]
    index["identity_reviews"] = reviews
    return len(seen)


def build_provider_candidates(index: dict, location_reviews: list[dict]) -> list[dict]:
    """Group reviewed provider relationships into a U.S.-screening queue.

    A dated U.S. base observation is kept separate from company eligibility.
    Nonexclusive distributions remain leads, not ownership findings.
    """
    candidates_by_id = {item["id"]: item for item in index["candidates"]}
    locations_by_slug = {item["slug"]: item for item in location_reviews}
    grouped: dict[str, dict] = {}
    for review in index["identity_reviews"]:
        provider = review["provider_name"]
        if provider is None:
            continue
        normalized_name = re.sub(r"\s+", " ", provider.casefold()).strip()
        group = grouped.get(normalized_name)
        if group is None:
            group = {
                "id": hashlib.sha256(normalized_name.encode()).hexdigest()[:20],
                "name": provider,
                "record_type": "reviewed_provider_lead",
                "company_eligibility": "unreviewed",
                "identity_review_ids": [],
                "directory_candidate_ids": [],
                "directory_item_names": [],
                "candidate_tags": [],
                "observed_inventory_years": [],
                "sources": [],
                "provider_relations": [],
                "pilot_slug": None,
                "us_evidence": [],
            }
            grouped[normalized_name] = group
        group["identity_review_ids"].append(review["id"])
        if review["provider_relation"] not in group["provider_relations"]:
            group["provider_relations"].append(review["provider_relation"])
        if review["pilot_slug"]:
            group["pilot_slug"] = review["pilot_slug"]
            location = locations_by_slug.get(review["pilot_slug"])
            if location:
                group["us_evidence"].append({
                    "decision": location["decision"],
                    "source_year": location["source_year"],
                    "location_kind": location["location_kind"],
                    "place": location["place"],
                    "source_url": location["source_url"],
                    "source_note": location["source_note"],
                })
        elif review.get("us_evidence"):
            group["us_evidence"].append({
                **review["us_evidence"], "decision": "documented_us_base"
            })
        for candidate_id in review["candidate_ids"]:
            candidate = candidates_by_id[candidate_id]
            group["directory_candidate_ids"].append(candidate_id)
            for field, values in (
                    ("directory_item_names", [candidate["name"]]),
                    ("candidate_tags", candidate["candidate_tags"]),
                    ("observed_inventory_years", candidate["observed_years"]),
                    ("sources", candidate["sources"])):
                for value in values:
                    if value not in group[field]:
                        group[field].append(value)
    for group in grouped.values():
        for field in ("candidate_tags", "observed_inventory_years", "sources"):
            group[field].sort()
        group["us_status"] = ("dated_us_base" if any(item["decision"] == "documented_us_base"
                             for item in group["us_evidence"])
                             else "reviewed_unresolved" if group["us_evidence"]
                             else "unreviewed")
    return sorted(grouped.values(), key=lambda item: item["name"].casefold())


def build_index(cache_dir: Path, *, offline: bool = False) -> dict:
    for source, pin in PINS.items():
        expected_years = set(STUDY_YEARS) | set(EXTENDED_INVENTORY_YEARS)
        if set(pin["commits"]) != expected_years:
            raise ValueError(f"{source} is missing a study year")
    artifacts = []
    observations = []
    inventory_rows = []
    for source in PINS:
        for year in PINS[source]["commits"]:
            raw, artifact = fetch_pinned(source, year, cache_dir, offline=offline)
            source_observations, item_count = parse_occurrences(raw, artifact)
            source_inventory_rows = parse_inventory_rows(raw, artifact)
            artifact["raw_item_count"] = item_count
            artifact["mapped_occurrence_count"] = len(source_observations)
            artifact["inventory_row_count"] = len(source_inventory_rows)
            artifact["unmapped_row_count"] = len(source_inventory_rows) - len(source_observations)
            artifacts.append(artifact)
            observations.extend(source_observations)
            inventory_rows.extend(source_inventory_rows)
    return {
        "mapping_version": "landscape-category-candidates-v1",
        "scope_note": "Dated product/project leads with a separate, partial manual identity review. U.S. eligibility is not inferred from inventory rows.",
        "artifacts": artifacts,
        "occurrences": observations,
        "inventory_rows": inventory_rows,
        "candidates": build_candidates(observations),
    }
