"""Build the complete, bounded exact-placement graph for read-only field queries."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from itertools import combinations


MAX_CANDIDATES = 5000
MAX_PAIRS = 250000


def encode(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def build_market_field_graph(projection: dict) -> dict:
    """Pairs have candidate indices and exact placement-key indices; adjacency has pair indices."""
    nodes = sorted(projection["nodes"], key=lambda node: node["id"])
    if len(nodes) > MAX_CANDIDATES:
        raise ValueError(f"market field exceeds {MAX_CANDIDATES} candidates")
    candidate_ids = [node["id"] for node in nodes]
    if len(set(candidate_ids)) != len(candidate_ids):
        raise ValueError("duplicate market field candidate")

    members = defaultdict(set)
    candidate_keys = []
    categories = set()
    for index, node in enumerate(nodes):
        keys = set()
        for observation in node["observations"]:
            key = (observation["source"], observation["year"], observation["source_category"])
            if key in keys:
                raise ValueError("duplicate projected observation key; merge source rows before graph build")
            keys.add(key)
            categories.add(observation["source_category"])
        candidate_keys.append(keys)
        for key in keys:
            members[key].add(index)

    keys = sorted(members)
    pairs_by_members = defaultdict(list)
    for key_index, key in enumerate(keys):
        for pair in combinations(sorted(members[key]), 2):
            if pair not in pairs_by_members and len(pairs_by_members) >= MAX_PAIRS:
                raise ValueError(f"market field exceeds {MAX_PAIRS} pairs")
            pairs_by_members[pair].append(key_index)
    pairs = [[left, right, key_indices] for (left, right), key_indices in sorted(pairs_by_members.items())]
    observation_count = sum(len(node["observations"]) for node in nodes)
    if (len(nodes) != projection["counts"]["nodes"]
            or observation_count != projection["counts"]["observations"]
            or len(pairs) != projection["counts"]["possible_pairs"]):
        raise ValueError("market field graph differs from retained projection counts")
    if len(projection["edges"]) != projection["counts"]["edges"]:
        raise ValueError("review worklist count differs from retained projection")
    adjacency = [[] for _ in nodes]
    for pair_index, (left, right, _) in enumerate(pairs):
        adjacency[left].append(pair_index)
        adjacency[right].append(pair_index)

    key_indices = {key: index for index, key in enumerate(keys)}
    summaries = []
    for node, observed_keys in zip(nodes, candidate_keys):
        summary_fields = ("id", "name", "description", "candidate_tags", "observed_years",
                          "sources", "homepage_url", "repo_url", "identity_review")
        summaries.append({field: node[field] for field in summary_fields})
    review_pairs = {tuple(sorted((edge["subject_candidate_id"], edge["object_candidate_id"])))
                    for edge in projection["edges"]}
    if len(review_pairs) != len(projection["edges"]):
        raise ValueError("duplicate review worklist pair")
    graph_pairs = {(candidate_ids[left], candidate_ids[right]) for left, right, _ in pairs}
    if not review_pairs.issubset(graph_pairs):
        raise ValueError("review worklist pair lacks an exact inventory overlap")
    graph = {
        "schema_version": "1.0",
        "status": projection["status"],
        "input_hashes": {"discovery_sha256": projection["provenance"]["discovery_sha256"],
                         "queue_sha256": projection["provenance"]["queue_sha256"],
                         "projection_build_id": projection["build_id"]},
        "counts": {name: projection["counts"][name] for name in
                   ("nodes", "observations", "possible_pairs", "edges")},
        "facets": {"sources": sorted({artifact["source"] for artifact in projection["artifacts"]}),
                   "years": sorted({artifact["year"] for artifact in projection["artifacts"]}),
                   "categories": sorted(categories)},
        "keys": [list(key) for key in keys],
        "candidates": summaries,
        "candidate_key_indices": [[key_indices[key] for key in sorted(observed_keys)]
                                  for observed_keys in candidate_keys],
        "pairs": pairs,
        "adjacency": adjacency,
        "review_pairs": [list(pair) for pair in sorted(review_pairs)],
    }
    graph["build_id"] = hashlib.sha256(encode(graph)).hexdigest()
    return graph
