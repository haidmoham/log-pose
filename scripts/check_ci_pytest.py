"""Reject a green fixture run that silently skipped its disposable database tests."""

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path


REQUIRED_MODULES = ("test_postgres", "test_topology_postgres", "test_medallion")


def audit_report(path: Path) -> dict:
    root = ET.parse(path).getroot()
    cases = root.findall(".//testcase")
    skipped = [case.get("name") for case in cases if case.find("skipped") is not None]
    failed = [case.get("name") for case in cases
              if case.find("failure") is not None or case.find("error") is not None]
    missing_modules = [module for module in REQUIRED_MODULES
                       if not any(module in (case.get("classname") or "")
                                  and case.find("skipped") is None for case in cases)]
    result = {"tests": len(cases), "skipped": skipped, "failed": failed,
              "missing_database_modules": missing_modules}
    result["passed"] = bool(cases) and not skipped and not failed and not missing_modules
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("junit_xml", type=Path)
    args = parser.parse_args()
    result = audit_report(args.junit_xml)
    print(json.dumps(result, sort_keys=True))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
