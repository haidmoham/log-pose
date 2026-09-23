"""Check that SEC analysis resolves filing and tag conflicts explicitly."""

from datetime import date
from decimal import Decimal

from log_pose.sec_analysis import select_fact


def candidate(tag, filed, value, *, accession="one", end="2024-01-31"):
    return {
        "concept_group": "revenue", "taxonomy": "us-gaap", "tag": tag,
        "unit": "USD", "value": Decimal(value),
        "start_date": date(2023, 2, 1), "end_date": date.fromisoformat(end),
        "filed_date": date.fromisoformat(filed), "accession_number": accession,
    }


def test_cutoff_and_preferred_tag_choose_earliest_eligible_filing():
    rows = [
        candidate("RevenueFromContractWithCustomerIncludingAssessedTax", "2024-03-07", "100"),
        candidate("RevenueFromContractWithCustomerIncludingAssessedTax", "2025-03-10", "110", accession="two"),
        candidate("Revenues", "2024-03-07", "90"),
    ]
    assert select_fact(rows, date(2024, 3, 1)) == ("not_filed_by_cutoff", None)
    status, selected = select_fact(rows, date(2025, 4, 1))
    assert status == "selected"
    assert selected is rows[0]


def test_conflicting_periods_or_same_day_values_require_review():
    first = candidate("Revenues", "2024-03-07", "100")
    changed_period = candidate("Revenues", "2024-03-07", "100", end="2024-02-01")
    assert select_fact([first, changed_period], date(2025, 4, 1))[0] == "period_review_required"
    same_day_revision = candidate("Revenues", "2024-03-07", "110", accession="two")
    assert select_fact([first, same_day_revision], date(2025, 4, 1))[0] == "same_day_conflict"
