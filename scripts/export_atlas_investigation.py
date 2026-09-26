"""Run bounded atlas pages from a spec and save an evidence-limited investigation."""

import argparse
import json
from pathlib import Path

from log_pose.atlas_read import export_investigation, read_atlas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True,
                        help="repository containing scripts/atlas_request.js and the snapshot")
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    spec = json.loads(args.spec.read_bytes())
    pages = []
    for request in spec["requests"]:
        body = read_atlas(args.repo_root, request["parameters"])
        pages.append({"name": request["name"], **body})
    result = export_investigation(
        args.output, question=spec["question"], cohort_query=spec["cohort_query"],
        selected_pages=pages, omissions=spec["omissions"], observations=spec["observations"],
        interpretation=spec["interpretation"], counterevidence=spec["counterevidence"],
        result=spec["result"], uncertainty=spec["uncertainty"],
        next_question=spec["next_question"])
    print(json.dumps({"output": str(args.output), "build_id": result["build_id"],
                      "pages": len(result["selected_pages"])}))


if __name__ == "__main__":
    main()
