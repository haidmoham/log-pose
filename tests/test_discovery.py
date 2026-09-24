import json
from pathlib import Path

import yaml

from log_pose.discovery import (EXPECTED_SHA256, EXTENDED_INVENTORY_YEARS, PINS, STUDY_YEARS, build_candidates,
                                candidate_tags, link_pilot_candidates, parse_occurrences,
                                parse_inventory_rows)
from log_pose.discovery_store import reconcile_source_rows
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


def test_null_inventory_items_are_empty_categories():
    document = {"landscape": [{"name": "CNAI", "subcategories": [
        {"name": "Vector Databases", "items": None},
    ]}]}
    observations, total = parse_occurrences(yaml.safe_dump(document).encode(), artifact(2026))
    assert observations == []
    assert total == 0


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
    expected = {(source, year) for source, pin in PINS.items() for year in pin["commits"]}
    assert set(actual) == expected
    assert all(actual[key]["raw_sha256"] == EXPECTED_SHA256[key] for key in expected)
    for source in PINS:
        for year in EXTENDED_INVENTORY_YEARS:
            item = actual[(source, year)]
            assert item["artifact_path"]
            assert item["observation_basis"] == "point_in_time_repository_state"
            assert item["coverage_status"] == ("partial_year_snapshot" if year == 2026
                                                 else "dated_inventory_snapshot")
            raw = Path(item["artifact_path"]).read_bytes()
            import hashlib
            assert hashlib.sha256(raw).hexdigest() == item["raw_sha256"]


def test_partitioned_inventory_exports_every_raw_directory_row():
    export = json.loads(Path("web/discovery.json").read_text())
    raw_rows = mapped_rows = unmapped_rows = 0
    for artifact in export["artifacts"]:
        partition = json.loads(Path(artifact["inventory_export_path"]).read_text())
        assert partition["raw_sha256"] == artifact["raw_sha256"]
        assert len(partition["rows"]) == artifact["inventory_row_count"]
        assert sum(bool(row["candidate_tags"]) for row in partition["rows"]) == artifact["mapped_occurrence_count"]
        assert all(row["record_type"] == ("product_or_project_candidate" if row["candidate_tags"]
                                          else "unmapped_directory_row")
                   for row in partition["rows"])
        raw_rows += len(partition["rows"])
        mapped_rows += sum(bool(row["candidate_tags"]) for row in partition["rows"])
        unmapped_rows += sum(not row["candidate_tags"] for row in partition["rows"])
    assert (raw_rows, mapped_rows, unmapped_rows) == (18076, 6096, 11980)


def test_import_rejects_changed_parsed_rows_before_database_write():
    export = json.loads(Path("web/discovery.json").read_text())
    artifact = export["artifacts"][0]
    raw = Path(artifact["artifact_path"]).read_bytes()
    rows = parse_inventory_rows(raw, artifact)
    mapped, _ = parse_occurrences(raw, artifact)
    reconcile_source_rows(raw, artifact, rows, mapped)
    changed = [dict(row) for row in rows]
    changed[0]["name"] = "changed without updating the source"
    import pytest
    with pytest.raises(ValueError, match="inventory rows differ"):
        reconcile_source_rows(raw, artifact, changed, mapped)


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


def test_provider_leads_keep_location_and_company_eligibility_separate():
    export = json.loads(Path("web/discovery.json").read_text())
    providers = export["provider_candidates"]
    assert len(providers) == 15
    assert sum(item["us_status"] == "dated_us_base" for item in providers) == 5
    assert all(item["company_eligibility"] == "unreviewed" for item in providers)
    weaviate = next(item for item in providers if item["name"] == "Weaviate")
    assert len(weaviate["directory_candidate_ids"]) == 3
    assert weaviate["us_status"] == "unreviewed"
    gitlab = next(item for item in providers if item["name"] == "GitLab")
    assert gitlab["us_status"] == "reviewed_unresolved"
