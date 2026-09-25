"""Expose a bounded inventory-overlap worklist without creating relationship claims."""

from __future__ import annotations

import hashlib
import json

from .topology import build_market_neighbor_queue, load_discovery_candidates


EXPLORATORY_STATUS = "unreviewed_inventory_overlap"


def export_topology_discovery(discovery: dict, queue: dict, *, discovery_sha256: str,
                              queue_sha256: str) -> dict:
    """Resolve each queued pair back to exact source/year/category occurrences.

    Candidate IDs remain product/project keys. A reviewed provider relation is
    attached as evidence, while an automatic navigation match stays unreviewed.
    Neither can promote a category overlap into a company relationship.
    """
    if queue.get("input_sha256") != discovery_sha256:
        raise ValueError("topology discovery queue has a stale discovery fingerprint")
    limit = queue.get("queue_limit")
    random_seed = queue.get("random_seed")
    if type(limit) is not int or type(random_seed) is not int:
        raise ValueError("topology discovery queue needs an integer limit and random seed")
    expected = build_market_neighbor_queue(discovery, limit=limit, random_seed=random_seed)
    expected["input_sha256"] = discovery_sha256
    if queue != expected:
        raise ValueError("topology discovery queue differs from its deterministic input projection")

    candidates = unique_index(discovery["candidates"], "id", "candidate")
    occurrences = unique_index(discovery["occurrences"], "id", "occurrence")
    artifacts = unique_index(discovery["artifacts"], "raw_sha256", "artifact")
    reviews = unique_index(discovery["identity_reviews"], "id", "identity review")
    used_candidate_ids = sorted(candidate["id"] for candidate in load_discovery_candidates(discovery))
    nodes = []
    candidate_observations = {}
    for candidate_id in used_candidate_ids:
        candidate = candidates[candidate_id]
        observations = {}
        for occurrence_id in candidate["occurrence_ids"]:
            occurrence = occurrences[occurrence_id]
            artifact = artifacts[occurrence["artifact_sha256"]]
            if occurrence["source"] != artifact["source"] or occurrence["year"] != artifact["year"]:
                raise ValueError(f"inventory occurrence differs from its pinned source: {occurrence_id}")
            category = occurrence["source_category"]
            if occurrence.get("source_subcategory"):
                category += f" / {occurrence['source_subcategory']}"
            key = (occurrence["source"], occurrence["year"], category)
            observations.setdefault(key, []).append(occurrence)
        candidate_observations[candidate_id] = observations
        review_id = candidate.get("identity_review_id")
        review = reviews.get(review_id) if review_id else None
        if review_id and (review is None or candidate_id not in review["candidate_ids"]):
            raise ValueError(f"candidate identity review does not reference the candidate: {candidate_id}")
        nodes.append({"id": candidate_id, "candidate_id": candidate_id, "name": candidate["name"],
                      "description": candidate["description"],
                      "record_type": "product_or_project_candidate",
                      "candidate_tags": candidate["candidate_tags"],
                      "observed_years": candidate["observed_years"],
                      "sources": candidate["sources"], "homepage_url": candidate["homepage_url"],
                      "repo_url": candidate["repo_url"], "occurrence_ids": candidate["occurrence_ids"],
                      "identity_review": review, "navigation_match": candidate.get("pilot_match"),
                      "company_eligibility": "unreviewed", "relationship_status": "unreviewed",
                      "observations": [project_observation(key, rows, artifacts)
                                       for key, rows in sorted(observations.items())]})

    edges = []
    for pair in queue["pairs"]:
        subject_id, object_id = pair["subject_candidate_id"], pair["object_candidate_id"]
        subject_observations = candidate_observations[subject_id]
        object_observations = candidate_observations[object_id]
        shared = sorted(subject_observations.keys() & object_observations.keys())
        evidence = []
        for source, year, category in shared:
            subject_rows = subject_observations[(source, year, category)]
            object_rows = object_observations[(source, year, category)]
            hashes = {row["artifact_sha256"] for row in subject_rows + object_rows}
            if len(hashes) != 1:
                raise ValueError("overlap observations must share one exact pinned source artifact")
            artifact = artifacts[next(iter(hashes))]
            row_fields = ("id", "name", "description", "source_path", "homepage_url", "repo_url")
            evidence.append({"source": source, "year": year, "source_category": category,
                "artifact_sha256": artifact["raw_sha256"], "source_commit": artifact["commit"],
                "source_committed_at": artifact["commit_at"], "source_url": artifact["url"],
                "coverage_status": artifact["coverage_status"],
                "partition_path": public_inventory_path(artifact),
                "subject_occurrence_ids": sorted(row["id"] for row in subject_rows),
                "object_occurrence_ids": sorted(row["id"] for row in object_rows),
                "subject_rows": [{key: row[key] for key in row_fields}
                                 for row in sorted(subject_rows, key=lambda row: row["id"])],
                "object_rows": [{key: row[key] for key in row_fields}
                                for row in sorted(object_rows, key=lambda row: row["id"])]})
        if not evidence:
            raise ValueError(f"queued candidate pair has no exact inventory overlap: {pair['id']}")
        edges.append({key: pair[key] for key in (
            "id", "subject_candidate_id", "object_candidate_id", "candidate_kind", "status",
            "selection_method", "shared_source_categories", "shared_inventory_years",
            "shared_inventory_sources", "source_basis", "research_next_step", "claim")}
            | {"observations": evidence})
    result = {"schema_version": "1.0", "layer": "inventory_overlap_review_queue",
              "status": EXPLORATORY_STATUS,
              "node_grain": "one product/project candidate key, not a verified company",
              "edge_grain": "one sampled or prioritized worklist pair; not the full possible overlap network",
              "observation_grain": "one pinned source artifact, inventory year, and category shared by both candidates",
              "counts": {"nodes": len(nodes), "edges": len(edges),
                         "candidate_frame": queue["candidate_entity_count"],
                         "possible_pairs": queue["possible_pair_count"],
                         "inventory_candidates": len(candidates), "reviewed_relationships": 0,
                         "observations": sum(len(node["observations"]) for node in nodes)},
              "provenance": {"discovery_sha256": discovery_sha256, "queue_sha256": queue_sha256,
                             "generator": "inventory-overlap-export-v1", "random_seed": random_seed,
                             "queue_limit": limit, "source_mapping_version": queue["source_mapping_version"],
                             "selection_counts": {"highest_shared_category_and_year_overlap": queue["priority_selection_count"],
                                                  "source_year_stratified_sample": queue["source_year_stratified_count"],
                                                  "deterministic_random_sample": queue["random_selection_count"]}},
              "neighbor_rule": "Candidates overlap only when an observation has the same source, year, and source_category. Use all node observations, not worklist edges, to derive neighbors.",
              "artifacts": [{key: artifact[key] for key in (
                  "source", "year", "repository", "commit", "commit_at", "observation_basis",
                  "coverage_status", "url", "raw_sha256", "artifact_path")}
                  | {"partition_path": public_inventory_path(artifact)}
                  for artifact in sorted(artifacts.values(), key=lambda item: (item["source"], item["year"]))],
              "nodes": nodes, "edges": edges, "limitations": queue["limitations"] + [
                  "Lines mean shared inventory placement. They do not establish a company relationship or its dates.",
                  "The bounded research queue favors some overlaps; degree and component shape do not measure market importance.",
                  "A reviewed provider relationship or unreviewed navigation match does not establish company eligibility or an edge claim."]}
    result["build_id"] = hashlib.sha256(json.dumps(result, ensure_ascii=False, sort_keys=True,
        separators=(",", ":")).encode()).hexdigest()
    return result


def public_inventory_path(artifact: dict) -> str:
    path = artifact["inventory_export_path"]
    if not path.startswith("web/discovery-inventory/") or ".." in path.split("/"):
        raise ValueError("inventory partition must be under the public discovery-inventory directory")
    return path.removeprefix("web/")


def project_observation(key: tuple, rows: list[dict], artifacts: dict) -> dict:
    """Keep exact source rows available while deduplicating artifact metadata."""
    source, year, category = key
    hashes = {row["artifact_sha256"] for row in rows}
    if len(hashes) != 1:
        raise ValueError("candidate observation must resolve to one pinned source artifact")
    artifact_hash = next(iter(hashes))
    fields = ("id", "name", "description", "source_path", "homepage_url", "repo_url")
    return {"source": source, "year": year, "source_category": category,
            "artifact_sha256": artifact_hash, "partition_path": public_inventory_path(artifacts[artifact_hash]),
            "occurrence_ids": sorted(row["id"] for row in rows),
            "rows": [{field: row[field] for field in fields}
                     for row in sorted(rows, key=lambda item: item["id"])]}


def unique_index(rows: list[dict], key: str, label: str) -> dict:
    indexed = {row[key]: row for row in rows}
    if len(indexed) != len(rows):
        raise ValueError(f"duplicate topology discovery {label} identifier")
    return indexed
