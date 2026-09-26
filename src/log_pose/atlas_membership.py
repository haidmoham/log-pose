"""Build and query an artifact-qualified inventory membership index."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from typing import Iterable, Iterator


def encode(value: object) -> bytes:
    """Return the canonical JSON representation used for stable identifiers."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _digest(prefix: str, value: object) -> str:
    return f"{prefix}_{hashlib.sha256(encode(value)).hexdigest()}"


def _artifact_id(artifact: dict) -> str:
    revision = artifact.get("commit") or artifact.get("artifact_path") or artifact.get("url")
    if not revision:
        raise ValueError("source artifact needs an immutable revision identity")
    return _digest("artifact", [artifact["source"], artifact.get("repository"), revision,
                                artifact["raw_sha256"], artifact["inventory_year"]])


def build_atlas_membership(projection: dict) -> dict:
    """Build a membership-first index without materializing candidate pairs."""
    artifact_rows = sorted(projection["artifacts"], key=lambda row: (
        row["source"], row["year"], row.get("repository") or "",
        row.get("commit") or "", row["raw_sha256"]))
    artifacts = []
    for artifact in artifact_rows:
        projected_artifact = {
            "source": artifact["source"],
            "inventory_year": artifact["year"],
            "raw_sha256": artifact["raw_sha256"],
            "repository": artifact.get("repository"),
            "commit": artifact.get("commit"),
            "committed_at": artifact.get("commit_at"),
            "observation_basis": artifact.get("observation_basis"),
            "coverage_status": artifact.get("coverage_status"),
            "url": artifact.get("url"),
            "artifact_path": artifact.get("artifact_path"),
            "partition_path": artifact.get("partition_path"),
        }
        projected_artifact["id"] = _artifact_id(projected_artifact)
        artifacts.append(projected_artifact)
    artifact_ids = [artifact["id"] for artifact in artifacts]
    if len(set(artifact_ids)) != len(artifact_ids):
        raise ValueError("duplicate source artifact identifier")
    artifact_indices = {artifact["id"]: index for index, artifact in enumerate(artifacts)}
    observation_artifacts: dict[tuple[str, int, str], list[int]] = defaultdict(list)
    for artifact_index, artifact in enumerate(artifacts):
        key = (artifact["source"], artifact["inventory_year"], artifact["raw_sha256"])
        observation_artifacts[key].append(artifact_index)

    nodes = sorted(projection["nodes"], key=lambda node: node["id"])
    candidate_ids = [node["id"] for node in nodes]
    if len(set(candidate_ids)) != len(candidate_ids):
        raise ValueError("duplicate candidate identifier")

    placement_keys = set()
    for node in nodes:
        for observation in node["observations"]:
            lookup = (observation["source"], observation["year"], observation["artifact_sha256"])
            matches = observation_artifacts.get(lookup, [])
            if not matches:
                raise ValueError(f"observation has unknown artifact: {lookup}")
            if len(matches) != 1:
                raise ValueError("observation artifact reference is ambiguous; include an explicit revision identifier")
            artifact_id = artifacts[matches[0]]["id"]
            placement_keys.add((artifact_id, observation["source_category"]))

    placements = []
    for artifact_id, source_category in sorted(placement_keys):
        placement_id = _digest("placement", [artifact_id, source_category])
        placements.append({"id": placement_id,
                           "artifact_index": artifact_indices[artifact_id],
                           "source_category": source_category})
    placement_ids = [placement["id"] for placement in placements]
    if len(set(placement_ids)) != len(placement_ids):
        raise ValueError("duplicate placement identifier")
    placement_indices = {
        (artifacts[placement["artifact_index"]]["id"], placement["source_category"]): index
        for index, placement in enumerate(placements)
    }

    candidates = []
    candidate_placement_indices: list[list[int]] = []
    placement_members: list[list[int]] = [[] for _ in placements]
    memberships = []
    for candidate_index, node in enumerate(nodes):
        candidates.append({key: deepcopy(value) for key, value in node.items()
                           if key != "observations"})
        observations_by_placement: dict[int, list[dict]] = defaultdict(list)
        for observation in node["observations"]:
            lookup = (observation["source"], observation["year"], observation["artifact_sha256"])
            artifact_index = observation_artifacts[lookup][0]
            key = (artifacts[artifact_index]["id"], observation["source_category"])
            observations_by_placement[placement_indices[key]].append(observation)

        member_placements = sorted(observations_by_placement)
        candidate_placement_indices.append(member_placements)
        for placement_index in member_placements:
            placement_members[placement_index].append(candidate_index)
            observations = observations_by_placement[placement_index]
            occurrence_ids = sorted({occurrence_id for observation in observations
                                     for occurrence_id in observation["occurrence_ids"]})
            rows_by_id = {}
            for observation in observations:
                for row in observation["rows"]:
                    row_id = row["id"]
                    if row_id in rows_by_id and rows_by_id[row_id] != row:
                        raise ValueError(f"conflicting retained occurrence row: {row_id}")
                    rows_by_id[row_id] = deepcopy(row)
            if set(rows_by_id) != set(occurrence_ids):
                raise ValueError("membership occurrence identifiers differ from retained rows")
            placement = placements[placement_index]
            membership_id = _digest("membership", [node["id"], placement["id"]])
            memberships.append({
                "id": membership_id,
                "candidate_index": candidate_index,
                "placement_index": placement_index,
                "occurrence_ids": occurrence_ids,
                "rows": [rows_by_id[row_id] for row_id in sorted(rows_by_id)],
            })

    memberships.sort(key=lambda row: (row["candidate_index"], row["placement_index"]))
    index = {
        "schema_version": "1.0",
        "layer": "inventory_membership_index",
        "status": projection["status"],
        "grains": {
            "artifact": "one immutable source artifact revision",
            "placement": "one artifact revision and exact source category path",
            "membership": "one candidate in one exact placement, supported by retained source rows",
            "candidate": projection.get("node_grain", "one candidate key"),
        },
        "input": {
            "projection_build_id": projection.get("build_id"),
            "discovery_sha256": projection.get("provenance", {}).get("discovery_sha256"),
            "queue_sha256": projection.get("provenance", {}).get("queue_sha256"),
        },
        "counts": {
            "artifacts": len(artifacts),
            "placements": len(placements),
            "candidates": len(candidates),
            "memberships": len(memberships),
            "supporting_occurrences": sum(len(row["occurrence_ids"]) for row in memberships),
            "input_worklist_pairs": len(projection.get("edges", [])),
        },
        "artifacts": artifacts,
        "placements": placements,
        "candidates": candidates,
        "candidate_placement_indices": candidate_placement_indices,
        "placement_members": placement_members,
        "memberships": memberships,
    }
    validate_atlas_membership(index)
    index["build_id"] = hashlib.sha256(encode(index)).hexdigest()
    return index


def validate_atlas_membership(index: dict) -> None:
    """Validate identifiers, references, and both membership index directions."""
    artifacts = index["artifacts"]
    placements = index["placements"]
    candidates = index["candidates"]
    candidate_placements = index["candidate_placement_indices"]
    placement_members = index["placement_members"]
    memberships = index["memberships"]

    for label, rows in (("artifact", artifacts), ("placement", placements),
                        ("candidate", candidates), ("membership", memberships)):
        identifiers = [row["id"] for row in rows]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError(f"duplicate {label} identifier")
    if len(candidate_placements) != len(candidates):
        raise ValueError("candidate placement index length differs from candidates")
    if len(placement_members) != len(placements):
        raise ValueError("placement member index length differs from placements")
    for placement in placements:
        if not 0 <= placement["artifact_index"] < len(artifacts):
            raise ValueError("placement has invalid artifact index")
        artifact = artifacts[placement["artifact_index"]]
        expected_id = _digest("placement", [artifact["id"], placement["source_category"]])
        if placement["id"] != expected_id:
            raise ValueError("placement identifier differs from its artifact and category")
    for artifact in artifacts:
        if artifact["id"] != _artifact_id(artifact):
            raise ValueError("artifact identifier differs from its immutable revision fields")

    expected_links = set()
    for membership in memberships:
        candidate_index = membership["candidate_index"]
        placement_index = membership["placement_index"]
        if not 0 <= candidate_index < len(candidates) or not 0 <= placement_index < len(placements):
            raise ValueError("membership has invalid candidate or placement index")
        link = (candidate_index, placement_index)
        if link in expected_links:
            raise ValueError("duplicate candidate placement membership")
        expected_links.add(link)
        expected_id = _digest("membership", [candidates[candidate_index]["id"],
                                              placements[placement_index]["id"]])
        if membership["id"] != expected_id:
            raise ValueError("membership identifier differs from its references")
        row_ids = [row["id"] for row in membership["rows"]]
        if len(set(row_ids)) != len(row_ids) or sorted(row_ids) != membership["occurrence_ids"]:
            raise ValueError("membership rows differ from occurrence identifiers")

    candidate_links = set()
    for candidate_index, indices in enumerate(candidate_placements):
        if indices != sorted(set(indices)):
            raise ValueError("candidate placement indices must be unique and sorted")
        candidate_links.update((candidate_index, placement_index) for placement_index in indices)
    member_links = set()
    for placement_index, indices in enumerate(placement_members):
        if indices != sorted(set(indices)):
            raise ValueError("placement members must be unique and sorted")
        member_links.update((candidate_index, placement_index) for candidate_index in indices)
    if expected_links != candidate_links or expected_links != member_links:
        raise ValueError("membership rows and bidirectional indexes differ")

    counts = index["counts"]
    expected_counts = {
        "artifacts": len(artifacts), "placements": len(placements),
        "candidates": len(candidates), "memberships": len(memberships),
        "supporting_occurrences": sum(len(row["occurrence_ids"]) for row in memberships),
    }
    if any(counts.get(name) != value for name, value in expected_counts.items()):
        raise ValueError("membership counts differ from indexed records")
    if "build_id" in index:
        content = {key: value for key, value in index.items() if key != "build_id"}
        if index["build_id"] != hashlib.sha256(encode(content)).hexdigest():
            raise ValueError("membership build identifier differs from canonical content")


def matching_placement_indices(index: dict, *, source: str | None = None,
                               year: int | None = None, category: str | None = None,
                               artifact_sha256: str | None = None) -> list[int]:
    """Return placements matching exact source facets and artifact revision."""
    result = []
    for placement_index, placement in enumerate(index["placements"]):
        artifact = index["artifacts"][placement["artifact_index"]]
        if source is not None and artifact["source"] != source:
            continue
        if year is not None and artifact["inventory_year"] != year:
            continue
        if category is not None and placement["source_category"] != category:
            continue
        if artifact_sha256 is not None and artifact["raw_sha256"] != artifact_sha256:
            continue
        result.append(placement_index)
    return result


def select_candidate_neighborhood(index: dict, candidate_id: str, *, source: str | None = None,
                                  year: int | None = None, category: str | None = None,
                                  artifact_sha256: str | None = None, limit: int = 60,
                                  offset: int = 0) -> dict:
    """Select one candidate's neighbors without expanding unrelated placement cliques."""
    if limit < 0 or offset < 0:
        raise ValueError("limit and offset must be non-negative")
    candidate_indices = {candidate["id"]: index for index, candidate in enumerate(index["candidates"])}
    if candidate_id not in candidate_indices:
        raise KeyError(candidate_id)
    center_index = candidate_indices[candidate_id]
    allowed = set(matching_placement_indices(index, source=source, year=year, category=category,
                                             artifact_sha256=artifact_sha256))
    supports: dict[int, list[int]] = defaultdict(list)
    for placement_index in index["candidate_placement_indices"][center_index]:
        if placement_index not in allowed:
            continue
        for neighbor_index in index["placement_members"][placement_index]:
            if neighbor_index != center_index:
                supports[neighbor_index].append(placement_index)
    ordered = sorted(supports, key=lambda item: index["candidates"][item]["id"])
    selected = ordered[offset:offset + limit]
    return {
        "candidate_id": candidate_id,
        "total": len(ordered),
        "offset": offset,
        "limit": limit,
        "truncated": offset + len(selected) < len(ordered),
        "neighbors": [{"candidate_index": neighbor_index,
                       "candidate_id": index["candidates"][neighbor_index]["id"],
                       "supporting_placement_indices": supports[neighbor_index]}
                      for neighbor_index in selected],
    }


def iter_exact_pairs(index: dict, *, placement_indices: Iterable[int] | None = None
                     ) -> Iterator[tuple[int, int, tuple[int, ...]]]:
    """Stream the exact distinct-pair oracle for an explicit placement selection.

    This offline oracle materializes only the distinct pair-to-support map. The
    retained index and interactive neighborhood path never require this step.
    """
    selected = (set(range(len(index["placements"]))) if placement_indices is None
                else set(placement_indices))
    for placement_index in selected:
        if not 0 <= placement_index < len(index["placements"]):
            raise ValueError("invalid placement index")
    for left_index, candidate_placements in enumerate(index["candidate_placement_indices"]):
        supports: dict[int, list[int]] = defaultdict(list)
        for placement_index in candidate_placements:
            if placement_index not in selected:
                continue
            for right_index in index["placement_members"][placement_index]:
                if right_index > left_index:
                    supports[right_index].append(placement_index)
        for right_index in sorted(supports):
            yield left_index, right_index, tuple(supports[right_index])


def materialize_pair_oracle(index: dict, *, max_candidates: int,
                            max_pairs: int) -> list[list[object]]:
    """Materialize the offline oracle only under caller-supplied bounds."""
    if max_candidates < 0 or max_pairs < 0:
        raise ValueError("oracle bounds must be non-negative")
    if len(index["candidates"]) > max_candidates:
        raise ValueError(f"oracle exceeds explicit {max_candidates} candidate bound")
    result = []
    for left, right, supports in iter_exact_pairs(index):
        if len(result) >= max_pairs:
            raise ValueError(f"oracle exceeds explicit {max_pairs} pair bound")
        result.append([left, right, list(supports)])
    return result
