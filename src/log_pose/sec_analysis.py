"""A named, conservative interpretation of retained SEC annual candidates."""

from __future__ import annotations

from datetime import date


POLICY_VERSION = "sec-annual-earliest-filed-v1"
TAG_ORDER = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "Revenue",
        "RevenueFromContractsWithCustomers",
    ),
    "net_income": ("NetIncomeLoss", "ProfitLoss"),
    "assets": ("Assets",),
}


def select_fact(candidates: list[dict], as_of: date) -> tuple[str, dict | None]:
    """Choose one USD annual candidate, or expose why the cell is unresolved.

    The earliest eligible annual filing wins within a preferred taxonomy/tag.
    Each candidate keeps its original SEC accession and source-member hash.
    This is an ex-post interpretation of a currently retrieved bulk member;
    it does not recreate a historical SEC ZIP vintage.
    """
    if not candidates:
        return "no_candidate", None
    available = [row for row in candidates if row["filed_date"] <= as_of]
    if not available:
        return "not_filed_by_cutoff", None
    units = {row["unit"] for row in available}
    if units != {"USD"}:
        return "unit_review_required", None
    periods = {(row["start_date"], row["end_date"]) for row in available}
    if len(periods) != 1:
        return "period_review_required", None
    concept = available[0]["concept_group"]
    if any(row["concept_group"] != concept for row in available):
        return "concept_review_required", None
    for tag in TAG_ORDER[concept]:
        tagged = [row for row in available if row["tag"] == tag]
        if not tagged:
            continue
        first_date = min(row["filed_date"] for row in tagged)
        first_filing = [row for row in tagged if row["filed_date"] == first_date]
        identities = {(row["accession_number"], row["value"], row["taxonomy"])
                      for row in first_filing}
        if len(identities) != 1:
            return "same_day_conflict", None
        return "selected", first_filing[0]
    return "unsupported_tag", None
