import json
from pathlib import Path

import pytest

from scripts.build_dashboard import validate_announcements


def test_curated_announcements_match_pilot_and_study_years():
    cohort = json.loads(Path("docs/research/pilot-cohort.json").read_text())
    announcements = json.loads(Path("docs/research/financing-announcements.json").read_text())
    validate_announcements(announcements, cohort)
    assert {event["announced_on"][:4] for event in announcements} == {
        "2021", "2022", "2023", "2024"
    }


def test_announcements_reject_unknown_pilot_link():
    cohort = [{"slug": "known"}]
    event = {"slug": "other", "announced_on": "2023-09-14"}
    with pytest.raises(ValueError, match="unknown financing announcement"):
        validate_announcements([event], cohort)
