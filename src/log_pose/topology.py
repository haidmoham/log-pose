"""Validate reviewed, source-backed company relationship claims."""

from __future__ import annotations

import hashlib
import json
import random
from datetime import date, datetime
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

PREDICATES = {
    "possible_substitute_for",
    "named_competitor_of",
    "integrates_with",
    "announced_partnership_with",
    "invested_in",
    "shared_exposure_hypothesis",
}
DIRECTIONS = {"symmetric", "subject_to_object", "object_to_subject"}
CLAIM_STATUSES = {"documented", "reviewed_inference", "hypothesis"}
IDENTITY_STATUSES = {"reviewed_pilot_company", "reviewed_company", "unresolved"}
CLAIM_ENDPOINT_STATUSES = {"reviewed_pilot_company", "reviewed_company"}
TEMPORAL_FORMS = {"event", "observed_state", "explicit_interval", "unknown"}


def _iso_date(value: Any, field: str, *, nullable: bool = False) -> None:
    if value is None and nullable:
        return
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{field} must be an ISO date: {value}") from error
    if parsed.isoformat() != value:
        raise ValueError(f"{field} must use YYYY-MM-DD: {value}")


def validate_topology(
    topology: dict[str, Any],
    cohort: list[dict[str, Any]],
    *,
    repository_root: Path = Path("."),
) -> None:
    """Check claim taxonomy, identity links, dates, URLs, and saved evidence hashes."""
    if topology.get("schema_version") != "1.0":
        raise ValueError("unsupported market topology schema version")
    _iso_date(topology.get("reviewed_at"), "reviewed_at")

    cohort_by_slug = {company["slug"]: company for company in cohort}
    if len(cohort_by_slug) != len(cohort):
        raise ValueError("pilot cohort contains duplicate slugs")

    entities = topology.get("entities")
    if not isinstance(entities, list) or not entities:
        raise ValueError("market topology must list its claim-bearing entities")
    entity_by_slug: dict[str, dict[str, Any]] = {}
    artifact_text_cache: dict[str, str] = {}
    for entity in entities:
        slug = entity.get("slug")
        if not isinstance(slug, str) or not slug or slug in entity_by_slug:
            raise ValueError(f"invalid or duplicate topology entity slug: {slug}")
        if entity.get("identity_status") not in IDENTITY_STATUSES:
            raise ValueError(f"invalid identity status for topology entity: {slug}")
        if not entity.get("name") or not entity.get("category"):
            raise ValueError(f"topology entity lacks a name or category: {slug}")
        if entity.get("identity_status") == "reviewed_pilot_company":
            company = cohort_by_slug.get(slug)
            if company is None or company["name"] != entity["name"] or company["category"] != entity["category"]:
                raise ValueError(f"pilot entity identity differs from cohort: {slug}")
        entity_by_slug[slug] = entity

    claims = topology.get("claims")
    if not isinstance(claims, list):
        raise ValueError("market topology claims must be a list")
    claim_ids: set[str] = set()
    for claim in claims:
        claim_id = claim.get("id")
        if not isinstance(claim_id, str) or not claim_id or claim_id in claim_ids:
            raise ValueError(f"invalid or duplicate topology claim id: {claim_id}")
        claim_ids.add(claim_id)

        subject = claim.get("subject_slug")
        object_ = claim.get("object_slug")
        if subject == object_ or subject not in entity_by_slug or object_ not in entity_by_slug:
            raise ValueError(f"topology claim has unresolved or identical endpoints: {claim_id}")
        if (entity_by_slug[subject]["identity_status"] not in CLAIM_ENDPOINT_STATUSES
                or entity_by_slug[object_]["identity_status"] not in CLAIM_ENDPOINT_STATUSES):
            raise ValueError(f"topology claim endpoint identity is unresolved: {claim_id}")
        if claim.get("predicate") not in PREDICATES:
            raise ValueError(f"invalid topology predicate: {claim_id}")
        if claim.get("direction") not in DIRECTIONS:
            raise ValueError(f"invalid topology direction: {claim_id}")
        if claim.get("claim_status") not in CLAIM_STATUSES:
            raise ValueError(f"invalid topology claim status: {claim_id}")
        if not all(isinstance(claim.get(field), str) and claim[field].strip()
                   for field in ("scope", "interpretation", "alternative_or_unknown")):
            raise ValueError(f"topology claim lacks scope, interpretation, or limitation: {claim_id}")
        _iso_date(claim.get("event_date"), f"{claim_id}.event_date", nullable=True)
        _iso_date(claim.get("valid_from"), f"{claim_id}.valid_from", nullable=True)
        _iso_date(claim.get("valid_to"), f"{claim_id}.valid_to", nullable=True)
        temporal_form = claim.get("temporal_form")
        if temporal_form not in TEMPORAL_FORMS or not claim.get("temporal_basis"):
            raise ValueError(f"topology claim lacks a valid temporal form or basis: {claim_id}")
        if temporal_form == "event" and claim.get("event_date") is None:
            raise ValueError(f"event claim needs an event date: {claim_id}")
        if temporal_form == "explicit_interval":
            valid_from = claim.get("valid_from")
            valid_to = claim.get("valid_to")
            if valid_from is None or valid_to is None or valid_from > valid_to:
                raise ValueError(f"explicit interval needs ordered validity dates: {claim_id}")
        elif claim.get("valid_from") is not None or claim.get("valid_to") is not None:
            raise ValueError(f"validity dates require explicit_interval form: {claim_id}")

        sources = claim.get("sources")
        if not isinstance(sources, list) or not sources:
            raise ValueError(f"topology claim has no sources: {claim_id}")
        seen_source_keys: set[tuple[str, str]] = set()
        for source in sources:
            source_url = source.get("source_url", "")
            if not isinstance(source_url, str) or not source_url.startswith("https://"):
                raise ValueError(f"topology source must use an HTTPS URL: {claim_id}")
            for field in ("source_date", "retrieved_on"):
                _iso_date(source.get(field), f"{claim_id}.{field}")
            retrieved_at = source.get("retrieved_at")
            if not isinstance(retrieved_at, str):
                raise ValueError(f"{claim_id}.retrieved_at must be an ISO timestamp")
            try:
                parsed_retrieved_at = datetime.fromisoformat(retrieved_at)
            except ValueError as error:
                raise ValueError(f"{claim_id}.retrieved_at must be an ISO timestamp") from error
            if parsed_retrieved_at.tzinfo is None:
                raise ValueError(f"{claim_id}.retrieved_at needs an explicit timezone")
            _iso_date(source.get("period_start"), f"{claim_id}.period_start", nullable=True)
            _iso_date(source.get("period_end"), f"{claim_id}.period_end", nullable=True)
            _iso_date(source.get("event_date"), f"{claim_id}.source.event_date", nullable=True)
            if (source.get("period_start") and source.get("period_end")
                    and source["period_start"] > source["period_end"]):
                raise ValueError(f"source reporting period is reversed: {claim_id}")
            if not all(isinstance(source.get(field), str) and source[field].strip()
                       for field in ("publisher", "source_type", "evidence_text", "evidence_locator")):
                raise ValueError(f"topology source lacks publisher, type, evidence text, or locator: {claim_id}")
            if source.get("evidence_kind") != "summary":
                raise ValueError(f"topology evidence_text must be labeled as a summary: {claim_id}")
            if source.get("evidence_quote") is not None and not isinstance(source["evidence_quote"], str):
                raise ValueError(f"topology evidence quote must be text: {claim_id}")
            key = (source_url, source.get("source_date"))
            if key in seen_source_keys:
                raise ValueError(f"topology claim repeats a source: {claim_id}")
            seen_source_keys.add(key)

            artifact_path = source.get("artifact_path")
            artifact_hash = source.get("artifact_sha256")
            if artifact_path is not None or artifact_hash is not None:
                if not isinstance(artifact_path, str) or not isinstance(artifact_hash, str):
                    raise ValueError(f"topology source artifact path/hash must be paired: {claim_id}")
                artifact_file = repository_root / artifact_path
                if not artifact_file.is_file():
                    raise ValueError(f"topology source artifact is missing: {artifact_path}")
                raw_artifact = artifact_file.read_bytes()
                actual_hash = hashlib.sha256(raw_artifact).hexdigest()
                if actual_hash != artifact_hash:
                    raise ValueError(f"topology source artifact hash differs: {artifact_path}")
                quote = source.get("evidence_quote")
                if quote:
                    if artifact_path not in artifact_text_cache:
                        artifact_text_cache[artifact_path] = BeautifulSoup(
                            raw_artifact, "html.parser"
                        ).get_text(" ", strip=True)
                    if quote not in artifact_text_cache[artifact_path]:
                        raise ValueError(f"source quote is absent from retained artifact: {artifact_path}")

        if claim["predicate"] == "shared_exposure_hypothesis":
            if claim["claim_status"] != "hypothesis" or len(sources) < 2:
                raise ValueError(f"shared exposure hypothesis needs two sources and hypothesis status: {claim_id}")
            if "untested" not in claim["alternative_or_unknown"].lower():
                raise ValueError(f"shared exposure claim must state that co-movement is untested: {claim_id}")


def load_topology(path: Path, cohort_path: Path, *, repository_root: Path = Path(".")) -> dict[str, Any]:
    topology = json.loads(path.read_text())
    cohort = json.loads(cohort_path.read_text())
    validate_topology(topology, cohort, repository_root=repository_root)
    return topology


def load_discovery_candidates(discovery: dict[str, Any]) -> list[dict[str, Any]]:
    """Return only distinct inventory candidates eligible for a relationship research queue."""
    candidates = discovery.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError("discovery export has no candidate list")
    seen: set[str] = set()
    result = []
    for item in candidates:
        candidate_id = item.get("id")
        if not isinstance(candidate_id, str) or not candidate_id or candidate_id in seen:
            raise ValueError(f"invalid or duplicate discovery candidate id: {candidate_id}")
        seen.add(candidate_id)
        tags = item.get("candidate_tags", [])
        years = item.get("observed_years", [])
        categories = item.get("source_categories", [])
        if item.get("record_type") != "product_or_project_candidate":
            continue
        homepage_url = item.get("homepage_url")
        if not isinstance(homepage_url, str) or not homepage_url.startswith("https://"):
            continue
        if not tags or not years or not categories:
            continue
        result.append(item)
    return result


def build_market_neighbor_queue(discovery: dict[str, Any], *, limit: int = 100,
                                random_seed: int = 20260924) -> dict[str, Any]:
    """Create unreviewed source-prioritized research leads; never call them relations."""
    if limit < 1 or limit > 1000:
        raise ValueError("queue limit must be between 1 and 1000")
    candidates = load_discovery_candidates(discovery)
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for first_index, first in enumerate(candidates):
        first_categories = set(first["source_categories"])
        first_years = set(first["observed_years"])
        for second in candidates[first_index + 1:]:
            shared_categories = sorted(first_categories & set(second["source_categories"]))
            shared_years = sorted(first_years & set(second["observed_years"]))
            shared_sources = sorted(set(first.get("sources", [])) & set(second.get("sources", [])))
            if not shared_categories or not shared_years or not shared_sources:
                continue
            left, right = sorted((first["id"], second["id"]))
            key = (left, right)
            pairs[key] = {
                "id": f"inventory-overlap-{left}-{right}",
                "subject_candidate_id": left,
                "object_candidate_id": right,
                "candidate_kind": "inventory_category_overlap",
                "status": "needs_company_identity_and_relation_evidence",
                "shared_source_categories": shared_categories,
                "shared_inventory_years": shared_years,
                "shared_inventory_sources": shared_sources,
                "source_year_strata": [f"{source}:{year}" for source in shared_sources for year in shared_years],
                "source_basis": "Both rows appeared in the same named source category in at least one pinned inventory year.",
                "claim": None,
                "research_next_step": "Resolve both product/project candidates to dated company identities, then seek a primary source that supports a scoped relationship claim.",
            }
    ranked_pairs = sorted(
        pairs.values(),
        key=lambda item: (
            -len(item["shared_source_categories"]),
            -len(item["shared_inventory_years"]),
            item["subject_candidate_id"],
            item["object_candidate_id"],
        ),
    )
    priority_count = min((limit * 1) // 2, len(ranked_pairs))
    prioritized = ranked_pairs[:priority_count]
    prioritized_ids = {item["id"] for item in prioritized}
    remaining = [item for item in ranked_pairs if item["id"] not in prioritized_ids]
    random_generator = random.Random(random_seed)
    strata: dict[str, list[dict[str, Any]]] = {}
    for item in remaining:
        for stratum in item["source_year_strata"]:
            strata.setdefault(stratum, []).append(item)
    for stratum_candidates in strata.values():
        random_generator.shuffle(stratum_candidates)
    stratified: list[dict[str, Any]] = []
    stratified_ids: set[str] = set()
    ordered_strata = sorted(strata)
    while len(stratified) < min(25, limit - len(prioritized)) and ordered_strata:
        for stratum in ordered_strata:
            candidates_for_stratum = strata[stratum]
            while candidates_for_stratum and candidates_for_stratum[0]["id"] in stratified_ids:
                candidates_for_stratum.pop(0)
            if candidates_for_stratum:
                item = candidates_for_stratum.pop(0)
                stratified.append(item)
                stratified_ids.add(item["id"])
                if len(stratified) >= min(25, limit - len(prioritized)):
                    break
        ordered_strata = [stratum for stratum in ordered_strata if strata[stratum]]
    after_strata = [item for item in remaining if item["id"] not in stratified_ids]
    random_count = min(25, limit - len(prioritized) - len(stratified), len(after_strata))
    sampled = random_generator.sample(after_strata, random_count) if random_count else []
    for item in prioritized:
        item["selection_method"] = "highest_shared_category_and_year_overlap"
    for item in stratified:
        item["selection_method"] = "source_year_stratified_sample"
    for item in sampled:
        item["selection_method"] = "deterministic_random_sample"
    queue = prioritized + stratified + sampled
    return {
        "schema_version": "1.0",
        "generated_from": "web/discovery.json",
        "source_mapping_version": discovery.get("mapping_version"),
        "universe_status": "discovery_leads_unreviewed_for_us_company_eligibility",
        "candidate_entity_count": len(candidates),
        "possible_pair_count": len(pairs),
        "queue_limit": limit,
        "random_seed": random_seed,
        "priority_selection_count": len(prioritized),
        "source_year_stratified_count": len(stratified),
        "random_selection_count": len(sampled),
        "reviewed_relationship_count": 0,
        "pairs": queue,
        "limitations": [
            "Landscape rows may describe products or projects rather than companies.",
            "Category co-occurrence is only a research prioritization signal; it is not evidence of competition, partnership, integration, or shared performance exposure.",
            "These inventories do not establish U.S. location or company eligibility in any year.",
            "The bounded queue is not a representative sample of the U.S. software universe.",
        ],
    }
