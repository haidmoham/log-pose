"""Validate Cboe's annual U.S. equities market-volume CSVs, 2021–2024."""

import argparse
import hashlib
import json
from pathlib import Path

from log_pose.market import fetch_cboe, parse_cboe


def inspect_year(year: int) -> dict:
    url, raw = fetch_cboe(year)
    rows = parse_cboe(raw, year)
    days = {row["trade_date"] for row in rows}
    participants = {row["market_participant"] for row in rows}
    return {
        "year": year,
        "url": url,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "rows": len(rows),
        "trading_days": len(days),
        "first_day": min(days).isoformat(),
        "last_day": max(days).isoformat(),
        "market_participants": len(participants),
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
