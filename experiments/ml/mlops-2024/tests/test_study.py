"""Checks for the historical research-set contract and its risky boundaries."""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SPEC = importlib.util.spec_from_file_location(
    "build_mlops_research_set", ROOT / "experiments/ml/mlops-2024/build.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ResearchSetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.built = MODULE.build()

    def test_versioned_export_is_deterministic(self) -> None:
        expected = json.loads((ROOT / "web/experimental/mlops-2024/study.json").read_text())
        self.assertEqual(self.built, expected)
        self.assertEqual(expected, json.loads((ROOT / "experiments/ml/mlops-2024/study.json").read_text()))

    def test_duplicate_identity_is_rejected(self) -> None:
        changed = copy.deepcopy(self.built)
        changed["members"][1]["id"] = changed["members"][0]["id"]
        with self.assertRaises(ValueError):
            MODULE.validate(changed)

    def test_post_cutoff_evidence_is_rejected(self) -> None:
        changed = copy.deepcopy(self.built)
        changed["evidence"][0]["publication_date"] = "2025-01-01"
        with self.assertRaisesRegex(ValueError, "cutoff"):
            MODULE.validate(changed)

    def test_reviewed_identity_count_uses_frozen_denominator(self) -> None:
        changed = copy.deepcopy(self.built)
        changed["members"][4]["identity"]["status"] = "reviewed"
        with self.assertRaisesRegex(ValueError, "aggregation"):
            MODULE.validate(changed)
        changed = copy.deepcopy(self.built)
        changed["denominator"]["count"] = 4
        with self.assertRaisesRegex(ValueError, "denominator"):
            MODULE.validate(changed)

    def test_priority_must_pass_all_gates(self) -> None:
        changed = copy.deepcopy(self.built)
        changed["memo"]["priority_ids"] = ["weights-and-biases"]
        with self.assertRaisesRegex(ValueError, "priority"):
            MODULE.validate(changed)


if __name__ == "__main__":
    unittest.main()
