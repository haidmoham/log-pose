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

PINS = {
    "cncf": {
        "repository": "cncf/landscape",
        "commits": {
            2021: ("f3ff2dc3fd73c9239eb454e189934fb150afb383", "2021-12-24T05:52:34Z"),
            2022: ("8b765491cc9a6e94e52039c2c515c68638e2c743", "2022-12-30T20:05:50Z"),
            2023: ("bd539b9fef36c09fbdc99a6063ad53e8515baf53", "2023-12-23T01:01:22Z"),
            2024: ("e4f13c918275affaefb3dbe1a21a4a8e38ee3842", "2024-12-31T14:58:22Z"),
        },
    },
    "lfai": {
        "repository": "lfai/lfai-landscape",
        "commits": {
            2021: ("b7bad8d8d544f2a7dca4c933ac76652e0ae5cee0", "2021-12-18T04:32:45Z"),
            2022: ("1c995e69a864aedd7f0df72211dab36c5592dadb", "2022-12-31T04:20:38Z"),
            2023: ("a634762cbac70264b3033b985a6743f8c0363d6b", "2023-12-27T09:26:18Z"),
            2024: ("9999a5ca4ddae6d202e83606ed6f84b368bc0099", "2024-12-19T04:29:51Z"),
        },
    },
}

EXPECTED_SHA256 = {
    ("cncf", 2021): "da810037b82d7d4f8b73b7fd92d93421e082225b0ea4ba72e63221ace8277ed6",
    ("cncf", 2022): "fd5c99efd9bb8981f86cec6855f59978e956452d7e0638dd41bd79b34e71a3d2",
    ("cncf", 2023): "2bc00cfcfef6f5b908a2da0f6993bc7aa01879faf72a8461f7bbc0060dd75432",
    ("cncf", 2024): "f1036cb6b8e9b9ef7647a0203ac349ba308173bf407f79cc8ccd4d4a2e7d46fd",
    ("lfai", 2021): "67a01cf1866de1c62ef79d43e3e2bb2da17e8622b94255c1e81120d827144f2d",
    ("lfai", 2022): "e2583bce1f7ac000ff894032116d44946686dfa05c8adff6d5483ca1aa8e3fe3",
    ("lfai", 2023): "0765d26680e0f526665600790b291ccb42e8716807366b2f1d5c5c5e3d50106a",
    ("lfai", 2024): "22915df88f4e3b18f28563445baeb22bceb446763774015edcf74b788480adb8",
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
    if cache_path.exists():
        raw = cache_path.read_bytes()
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
        "url": source_url(pin["repository"], commit, raw=False),
        "raw_sha256": digest,
        "bytes": len(raw),
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
            for item_index, item in enumerate(subcategory.get("items", [])):
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


def build_index(cache_dir: Path, *, offline: bool = False) -> dict:
    for source, pin in PINS.items():
        if set(pin["commits"]) != set(STUDY_YEARS):
            raise ValueError(f"{source} is missing a study year")
    artifacts = []
    observations = []
    for source in PINS:
        for year in PINS[source]["commits"]:
            raw, artifact = fetch_pinned(source, year, cache_dir, offline=offline)
            source_observations, item_count = parse_occurrences(raw, artifact)
            artifact["raw_item_count"] = item_count
            artifact["mapped_occurrence_count"] = len(source_observations)
            artifacts.append(artifact)
            observations.extend(source_observations)
    return {
        "mapping_version": "landscape-category-candidates-v1",
        "scope_note": "Dated product/project leads with a separate, partial manual identity review. U.S. eligibility is not inferred from inventory rows.",
        "artifacts": artifacts,
        "occurrences": observations,
        "candidates": build_candidates(observations),
    }
