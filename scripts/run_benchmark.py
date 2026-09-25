#!/usr/bin/env python3
"""Run the credential-free frozen evidence/claim regression harness."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from log_pose.benchmark import BenchmarkError, run_benchmark  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=REPOSITORY_ROOT, help="repository root containing frozen artifacts")
    parser.add_argument("--output-dir", type=Path, default=Path("docs/research/benchmark/scorecard"), help="directory for JSON and Markdown receipts")
    args = parser.parse_args()
    root = args.root.resolve()
    output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    try:
        report = run_benchmark(root, output_dir)
    except (BenchmarkError, OSError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    print(f"wrote {output_dir / 'benchmark-scorecard.json'}")
    print(f"wrote {output_dir / 'benchmark-scorecard.md'}")
    print(f"cases={report['counts']['cases']} controls={len(report['controls'])} credentialed_models_executed=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
