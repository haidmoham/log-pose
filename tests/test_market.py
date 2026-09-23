from decimal import Decimal

import pytest

from log_pose.market import parse_cboe


HEADER = (
    "Day,Market Participant,Tape A Shares,Tape B Shares,Tape C Shares,Total Shares,"
    "Tape A Notional,Tape B Notional,Tape C Notional,Total Notional,"
    "Tape A Trade Count,Tape B Trade Count,Tape C Trade Count,Total Trade Count\n"
)
ROW = "2022-01-03,Example Market,1,2,3,6,1.25,2.50,3.75,7.50,4,5,6,15\n"


def test_cboe_parser_preserves_decimal_values_and_checks_totals():
    parsed = parse_cboe((HEADER + ROW).encode(), 2022)
    assert parsed[0]["Total Notional"] == Decimal("7.50")
    with pytest.raises(ValueError, match="wrong total for Shares"):
        parse_cboe((HEADER + ROW.replace(",6,1.25", ",7,1.25")).encode(), 2022)
    with pytest.raises(ValueError, match="duplicates"):
        parse_cboe((HEADER + ROW + ROW).encode(), 2022)


def test_cboe_parser_rejects_wrong_year_and_nonfinite_value():
    with pytest.raises(ValueError, match="wrong year"):
        parse_cboe((HEADER + ROW).encode(), 2021)
    with pytest.raises(ValueError, match="invalid"):
        parse_cboe((HEADER + ROW.replace("7.50", "NaN")).encode(), 2022)
