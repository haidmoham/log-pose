"""Record two bounded investigations from pinned retained atlas builds; no acquisition or writes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from log_pose.atlas_read import AtlasReadError, export_layered_investigation, read_atlas_record


def record_investigations(root: Path, output: Path, inventory_build: str, reviewed_build: str) -> list[Path]:
    paths = [output / "reviewed-cross-layer.json", output / "reviewed-publication-cutoff.json"]
    if any(path.exists() for path in paths):
        raise ValueError("choose a new output directory; prior investigation receipts remain immutable")
    inventory_query = {"layer": "inventory", "mode": "search", "build_id": inventory_build,
        "source": "cncf", "year": "2024", "temporal_mode": "snapshot", "query": "Snowflake",
        "artifact": "artifact_01044292a1f8dc05285bdb5e7c3814dd91e577059b74385fff4bacaaf26bc3a8"}
    inventory = read_atlas_record(root, inventory_query)
    matches = [candidate for candidate in inventory["response"]["candidates"]
               if candidate.get("identity_review", {}).get("pilot_slug") == "snowflake"]
    if len(matches) != 1:
        raise ValueError("expected one explicitly reviewed Snowflake candidate identity")
    candidate = matches[0]
    reviewed_query = {"layer": "reviewed", "build_id": reviewed_build,
        "entity": "snowflake", "candidate": candidate["id"], "cutoff": "2022-02-24"}
    focused = read_atlas_record(root, dict(reviewed_query, mode="focus"))
    explained = read_atlas_record(root, dict(reviewed_query, mode="explain", neighbor="dbt-labs", limit=25))
    identity_links = focused["response"]["focus"]["candidate_links"]
    if not any(link["candidate_id"] == candidate["id"]
               and link["identity_review_id"] == candidate["identity_review"]["id"] for link in identity_links):
        raise ValueError("inventory and reviewed builds disagree about the selected identity review")
    claims = explained["response"]["claims"]
    predicates = sorted({claim["predicate"] for claim in claims})
    if not {"announced_partnership_with", "invested_in"}.issubset(predicates):
        raise ValueError("pinned neighborhood lacks the expected partnership and financing slices")
    export_layered_investigation(paths[0],
        question="What can the inventory and reviewed layers jointly establish about Snowflake and dbt Labs?",
        cohort_query={"inventory": inventory_query, "reviewed": reviewed_query},
        reads=[inventory, focused, explained],
        observations=[{"candidate_id": candidate["id"], "identity_review_id": candidate["identity_review"]["id"],
                       "mapping_use": "present_day_navigation_only"},
                      {"claim_ids": [claim["id"] for claim in claims], "predicates": predicates}],
        omissions=["Only the selected CNCF revision and dbt Labs neighbor are inspected.",
                   "Other neighbors and unreviewed claims are outside this saved read.",
                   "Publication filtering does not make present-day identity mapping historical."],
        interpretation="A reviewed identity link connects the selected inventory lead to a separate company frame. "
                       "The retained announcement supports separately scoped accepted claim types; the join is navigation.",
        counterevidence=[{"status": "scope_limit", "detail": "No ownership percentage, continuing relationship, "
                          "integration functionality or causal path is inferred from financing or partnership."}],
        result=f"The saved neighbor exposes {len(claims)} accepted claims under independent layer builds and clocks.",
        uncertainty="The page was retrieved in 2026 and has later modification metadata; its exact 2022 wording is unproven. "
                    "Current accepted reviews and present-day identity remain explicit lenses.",
        next_question="Which separately reviewed premises can support additional technical or commercial claims?")

    hypothesis_query = {"layer": "reviewed", "mode": "explain", "build_id": reviewed_build,
        "entity": "datadog", "neighbor": "snowflake", "basis": "hypothesis", "cutoff": "2024-12-31"}
    earlier = read_atlas_record(root, hypothesis_query)
    later = read_atlas_record(root, dict(hypothesis_query, cutoff="2025-02-20"))
    comparison = read_atlas_record(root, {"layer": "reviewed", "mode": "compare", "build_id": reviewed_build,
        "entity": "datadog", "basis": "hypothesis", "cutoff": "2025-02-20", "compare_cutoff": "2024-12-31"})
    if earlier["response"]["claims"] or len(later["response"]["claims"]) != 1:
        raise ValueError("unexpected pinned hypothesis eligibility across publication cutoffs")
    claim = later["response"]["claims"][0]
    if claim["predicate"] != "shared_exposure_hypothesis" or len(claim["sources"]) != 2:
        raise ValueError("the hypothesis must retain two distinct supporting premises")
    excluded_sources = [source for source in claim["sources"] if source["source_date"] > "2024-12-31"]
    if not excluded_sources or max(source["source_date"] for source in claim["sources"]) != "2025-02-20":
        raise ValueError("expected later filing premise is absent")
    rejected_clocks = []
    for selector in ({"review_cutoff": "2024-12-31"}, {"clock": "system_known"}, {"valid_at": "2024-12-31"}):
        try:
            read_atlas_record(root, {**hypothesis_query, **selector})
        except AtlasReadError as error:
            rejected_clocks.append({"request": selector, "status": "unsupported", "reason": str(error)})
        else:
            raise ValueError("unsupported historical query unexpectedly succeeded")
    export_layered_investigation(paths[1],
        question="Does a later filing enter an earlier publication-cutoff hypothesis frame?",
        cohort_query=hypothesis_query, reads=[earlier, later, comparison],
        observations=[{"claim_id": claim["id"], "earlier_claim_count": 0, "later_claim_count": 1,
            "excluded_premises": [{key: source.get(key) for key in ("id", "source_date", "artifact_sha256")}
                                  for source in excluded_sources]},
            {"unsupported_clock_checks": rejected_clocks}],
        omissions=["Review-time replay and relationship validity are unsupported, so they are rejected rather than simulated.",
                   "This is a publication-metadata filter over retained sources and current accepted reviews."],
        interpretation="The combined hypothesis is absent before its latest supporting filing date. "
                       "The later frame exposes both premises and the review history without accepting a stronger claim.",
        counterevidence=[{"status": "not_tested", "detail": "The common-exposure hypothesis remains untested; "
                          "source publication and acceptance do not prove the hypothesis."}],
        result="The 2025-02-20 filing cannot enter the 2024-12-31 frame through the hypothesis's older premise.",
        uncertainty="The cutoff does not prove when this system knew the claim. It uses current review decisions "
                    "and does not establish in-period availability of mutable retained page wording.",
        next_question="What independently reviewed evidence would test the proposed shared exposure?")
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory-build", required=True)
    parser.add_argument("--reviewed-build", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    paths = record_investigations(root, args.output, args.inventory_build, args.reviewed_build)
    print(json.dumps({"reads": 6, "new_sources": 0, "canonical_writes": False,
                      "outputs": [str(path) for path in paths]}, indent=2))


if __name__ == "__main__":
    main()
