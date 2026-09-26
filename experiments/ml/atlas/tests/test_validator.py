from copy import deepcopy

import pytest

from experiments.ml.atlas.validator import validate_attachment


def fixture_attachment():
    return {"schema_version": "atlas-model-attachment-v1",
            "status": "experimental_model_attachment", "canonical_write": False,
            "reviewed_status": "not_reviewed",
            "target": {"kind": "candidate", "id": "candidate-a"},
            "model": {"name": "example", "model_version": "v1", "prompt_version": "p1",
                      "code_version": "c1"},
            "issued_at": "2026-09-25T12:00:00+00:00",
            "evidence_cutoff": "2026-09-24T23:59:59+00:00",
            "inputs": [{"id": "source-a", "available_at": "2026-09-24T10:00:00+00:00"}],
            "target_definition": {"target": "workflow participation", "horizon": "12 months",
                                  "label_structure": "multilabel"},
            "output": {"kind": "probability", "values": {"workflow-a": 0.7,
                                                            "workflow-b": 0.6}},
            "assumptions": ["Input identity is held fixed for this scenario."],
            "validation": {"state": "unvalidated", "evaluation_refs": []}}


def test_multilabel_probabilities_need_not_sum_to_one():
    validate_attachment(fixture_attachment())
    categorical = fixture_attachment()
    categorical["target_definition"]["label_structure"] = "categorical"
    with pytest.raises(ValueError, match="sum to one"):
        validate_attachment(categorical)


@pytest.mark.parametrize("field,value,message", [
    ("reviewed_status", "accepted", "reviewed status"),
    ("canonical_write", True, "canonical writes"),
    ("status", "reviewed_claim", "experimental"),
])
def test_attachment_cannot_claim_review_or_canonical_state(field, value, message):
    attachment = fixture_attachment()
    attachment[field] = value
    with pytest.raises(ValueError, match=message):
        validate_attachment(attachment)


def test_future_provenance_and_ambiguous_probability_are_rejected():
    future = fixture_attachment()
    future["inputs"][0]["available_at"] = "2026-09-25T10:00:00+00:00"
    with pytest.raises(ValueError, match="future input"):
        validate_attachment(future)
    invalid = fixture_attachment()
    invalid["output"]["values"]["workflow-a"] = 1.2
    with pytest.raises(ValueError, match="between zero and one"):
        validate_attachment(invalid)
    mislabeled = fixture_attachment()
    mislabeled["output"]["normalization"] = "sums_to_one"
    with pytest.raises(ValueError, match="categorical normalization"):
        validate_attachment(mislabeled)
