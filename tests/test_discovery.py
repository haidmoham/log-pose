import json
from pathlib import Path

import yaml

from log_pose.discovery import (EXPECTED_SHA256, PINS, STUDY_YEARS, build_candidates,
                                candidate_tags, link_pilot_candidates, parse_occurrences)
from scripts.audit_discovery import CHALLENGE


def artifact(year):
    return {
        "source": "cncf",
        "year": year,
        "url": f"https://github.com/cncf/landscape/blob/example-{year}/landscape.yml",
        "raw_sha256": "a" * 64,
    }


def test_repeated_top_level_name_keeps_distinct_source_paths():
    document = {"landscape": [
        {"name": "CNAI", "subcategories": [
            {"name": "Vector Databases", "items": [
                {"name": "Example DB", "homepage_url": "https://example.com/db"}
            ]}
        ]},
        {"name": "CNAI", "subcategories": [
            {"name": "Model/LLM Observability", "items": [
                {"name": "Example Monitor", "homepage_url": "https://example.com/monitor"}
            ]}
        ]},
        {"name": "CNCF Members", "subcategories": [
            {"name": "Silver", "items": [{"name": "Example Member"}]}
        ]},
    ]}
    observations, total = parse_occurrences(yaml.safe_dump(document).encode(), artifact(2024))
    assert total == 3
    assert [(row["name"], row["source_path"]) for row in observations] == [
        ("Example DB", [0, 0, 0]),
        ("Example Monitor", [1, 0, 0]),
    ]
    assert observations[0]["candidate_tags"] == ["data_infrastructure", "ai_automation"]


def test_candidate_grouping_needs_both_name_and_specific_url():
    first = {
        "id": "one", "name": "Example", "description": "", "homepage_url": "https://example.com/tool",
        "repo_url": "", "source_category": "CNAI", "source_subcategory": "Vector Databases",
        "candidate_tags": ["data_infrastructure"], "source": "cncf", "year": 2021,
    }
    same_product = {**first, "id": "two", "year": 2024,
                    "homepage_url": "https://www.example.com/tool/"}
    different_product = {**first, "id": "three", "year": 2024,
                         "homepage_url": "https://example.com/other"}
    candidates = build_candidates([first, same_product, different_product])
    assert len(candidates) == 2
    assert sorted(len(item["occurrence_ids"]) for item in candidates) == [1, 2]


def test_non_product_directory_paths_are_not_tagged():
    assert candidate_tags("cncf", "CNCF Members", "Silver") == ()
    assert candidate_tags("lfai", "Data", "Education") == ()
    assert candidate_tags("lfai", "Data", "Governance") == ()


def test_pilot_navigation_match_requires_name_and_homepage():
    candidates = [
        {"name": "Example", "homepage_url": "https://www.example.com/"},
        {"name": "Example", "homepage_url": "https://example.com/product"},
    ]
    cohort = [{"name": "Example", "url": "https://example.com", "slug": "example"}]
    assert link_pilot_candidates(candidates, cohort) == 1
    assert candidates[0]["pilot_match"]["slug"] == "example"
    assert "pilot_match" not in candidates[1]


def test_committed_export_covers_every_pinned_source_year():
    export = json.loads(Path("web/discovery.json").read_text())
    actual = {(item["source"], item["year"]): item for item in export["artifacts"]}
    expected = {(source, year) for source in PINS for year in STUDY_YEARS}
    assert set(actual) == expected
    assert all(actual[key]["raw_sha256"] == EXPECTED_SHA256[key] for key in expected)


def test_identity_review_covers_challenge_and_groups_weaviate_aliases():
    export = json.loads(Path("web/discovery.json").read_text())
    reviews = export["identity_reviews"]
    reviewed_ids = {candidate_id for review in reviews for candidate_id in review["candidate_ids"]}
    assert len(reviews) == 20
    assert set(CHALLENGE) <= reviewed_ids
    assert len(reviewed_ids) == 22
    weaviate = next(review for review in reviews if review["provider_name"] == "Weaviate")
    assert len(weaviate["candidate_ids"]) == 3
    assert all(review["provider_relation"] == "none" for review in reviews
               if review["provider_name"] is None)
