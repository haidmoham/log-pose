"""Retrieve and validate Cboe's annual U.S. equities market-volume files."""

import csv
import io
import urllib.request
from datetime import date
from decimal import Decimal


URL = "https://cdn.cboe.com/resources/us/equities/market-statistics/historical-market-volume/market_history_{year}.csv"
MAX_CSV_BYTES = 5_000_000
NUMBER_FIELDS = (
    "Tape A Shares", "Tape B Shares", "Tape C Shares", "Total Shares",
    "Tape A Notional", "Tape B Notional", "Tape C Notional", "Total Notional",
    "Tape A Trade Count", "Tape B Trade Count", "Tape C Trade Count", "Total Trade Count",
)


def fetch_cboe(year: int) -> tuple[str, bytes]:
    if year not in range(2021, 2025):
        raise ValueError("Cboe pilot year must be 2021–2024")
    url = URL.format(year=year)
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read(MAX_CSV_BYTES + 1)
    if not raw or len(raw) > MAX_CSV_BYTES:
        raise ValueError("Cboe CSV is empty or exceeds the probe limit")
    return url, raw


def parse_cboe(raw: bytes, year: int) -> list[dict]:
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    required = {"Day", "Market Participant", *NUMBER_FIELDS}
    if not required <= set(reader.fieldnames or []):
        raise ValueError(f"Cboe CSV is missing columns: {sorted(required - set(reader.fieldnames or []))}")

    rows = []
    seen = set()
    for row_number, source_row in enumerate(reader, start=2):
        trade_day = date.fromisoformat(source_row["Day"])
        participant = source_row["Market Participant"].strip()
        if trade_day.year != year or not participant:
            raise ValueError(f"Cboe row {row_number} has the wrong year or no participant")
        key = (trade_day, participant)
        if key in seen:
            raise ValueError(f"Cboe row {row_number} duplicates a day and participant")
        seen.add(key)
        values = {}
        for field in NUMBER_FIELDS:
            value = Decimal(source_row[field])
            if not value.is_finite() or value < 0:
                raise ValueError(f"Cboe row {row_number} has an invalid {field}")
            if "Notional" not in field and value != value.to_integral_value():
                raise ValueError(f"Cboe row {row_number} has a noninteger {field}")
            values[field] = value
        for suffix in ("Shares", "Notional", "Trade Count"):
            tapes = sum(values[f"Tape {letter} {suffix}"] for letter in "ABC")
            if tapes != values[f"Total {suffix}"]:
                raise ValueError(f"Cboe row {row_number} has a wrong total for {suffix}")
        rows.append({"row_number": row_number, "trade_date": trade_day,
                     "market_participant": participant, **values})
    if not rows:
        raise ValueError("Cboe CSV contains no observations")
    return rows
