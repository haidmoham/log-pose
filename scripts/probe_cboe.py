"""Check Cboe's free annual U.S. equities market-volume CSVs, 2021–2024."""

import argparse
import csv
import hashlib
import io
import json
import urllib.request
from datetime import date
from pathlib import Path


URL = "https://cdn.cboe.com/resources/us/equities/market-statistics/historical-market-volume/market_history_{year}.csv"
REQUIRED = {"Day", "Market Participant", "Total Shares", "Total Notional", "Total Trade Count"}


def inspect_year(year: int) -> dict:
    url = URL.format(year=year)
    with urllib.request.urlopen(url, timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"{year}: HTTP {response.status}")
        raw = response.read(5_000_001)
    if len(raw) > 5_000_000:
        raise ValueError(f"{year}: CSV exceeds 5 MB probe limit")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    fields = set(reader.fieldnames or [])
    if not REQUIRED <= fields:
        raise ValueError(f"{year}: missing required columns: {sorted(REQUIRED - fields)}")

    days = set()
    participants = set()
    rows = 0
    for row in reader:
        day = date.fromisoformat(row["Day"])
        if day.year != year:
            raise ValueError(f"{year}: out-of-year row: {day}")
        int(row["Total Shares"])
        float(row["Total Notional"])
        int(row["Total Trade Count"])
        days.add(day)
        participants.add(row["Market Participant"])
        rows += 1
    if not rows:
        raise ValueError(f"{year}: empty CSV")
    return {
        "year": year,
        "url": url,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "rows": rows,
        "trading_days": len(days),
        "first_day": min(days).isoformat(),
        "last_day": max(days).isoformat(),
        "market_participants": len(participants),
        "columns": reader.fieldnames,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="write the metadata here; otherwise print JSON")
    args = parser.parse_args()
    results = [inspect_year(year) for year in range(2021, 2025)]
    output = json.dumps(results, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
