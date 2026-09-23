"""List short, source-exact passages for manual historical-page review."""

import argparse
import json
import re
from html import unescape
from pathlib import Path

from bs4 import BeautifulSoup

from log_pose.storage import connect


def candidate_passages(raw_html: bytes, normalized_text: str, limit: int = 8) -> list[dict]:
    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header"]):
        tag.decompose()
    body = soup.body or soup
    passages = []
    seen = set()
    for tag in body.find_all(["h1", "h2", "h3", "p"]):
        quote = re.sub(r"\s+", " ", unescape(tag.get_text(" ", strip=True))).strip()
        minimum = 15 if tag.name.startswith("h") else 35
        if not minimum <= len(quote) <= 300 or quote in seen:
            continue
        offset = normalized_text.find(quote)
        if offset < 0:
            continue
        seen.add(quote)
        passages.append({"tag": tag.name, "start": offset, "end": offset + len(quote), "quote": quote})
        if len(passages) >= limit:
            break
    return passages


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=Path("docs/research/pilot-cohort.json"))
    parser.add_argument("--output", type=Path, help="write JSON candidates here; otherwise print them")
    args = parser.parse_args()
    cohort = {item["slug"]: item for item in json.loads(args.cohort.read_text())}
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute("""SELECT company.slug, snapshot.id, snapshot.captured_at,
            snapshot.raw_html, snapshot.normalized_text
            FROM snapshots AS snapshot
            JOIN sources AS source ON source.id=snapshot.source_id
            JOIN companies AS company ON company.id=source.company_id
            WHERE snapshot.provider='commoncrawl'
            ORDER BY company.slug,snapshot.captured_at""")
        rows = cursor.fetchall()
    results = []
    for row in rows:
        if row["slug"] not in cohort:
            continue
        results.append({
            "slug": row["slug"],
            "category": cohort[row["slug"]]["category"],
            "snapshot_id": row["id"],
            "captured_at": row["captured_at"].isoformat(),
            "text_characters": len(row["normalized_text"]),
            "candidates": candidate_passages(row["raw_html"], row["normalized_text"]),
        })
    output = json.dumps(results, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
