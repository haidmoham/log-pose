"""Validate isolated model/scenario attachments without promoting them to evidence."""

from __future__ import annotations

from datetime import datetime, timezone


TARGET_KINDS = {"candidate", "claim", "investigation", "source_artifact"}
OUTPUT_KINDS = {"score", "probability"}
LABEL_STRUCTURES = {"multilabel", "categorical", "continuous"}
VALIDATION_STATES = {"unvalidated", "evaluated_experimental"}


def _timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{label} needs an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} needs an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{label} needs an explicit timezone")
    return parsed.astimezone(timezone.utc)


def validate_attachment(attachment: dict) -> None:
    """Reject ambiguous outputs, future provenance, and review/canonical claims."""
    if attachment.get("schema_version") != "atlas-model-attachment-v1":
        raise ValueError("unsupported attachment schema")
    if attachment.get("status") != "experimental_model_attachment":
        raise ValueError("attachment status must remain experimental")
    if attachment.get("canonical_write") is not False:
        raise ValueError("experimental attachment must prohibit canonical writes")
    if attachment.get("reviewed_status") not in (None, "not_reviewed"):
        raise ValueError("experimental attachment cannot claim reviewed status")
    target = attachment.get("target", {})
    if target.get("kind") not in TARGET_KINDS or not isinstance(target.get("id"), str):
        raise ValueError("attachment needs a typed target ID")
    model = attachment.get("model", {})
    for field in ("name", "model_version", "prompt_version", "code_version"):
        if not isinstance(model.get(field), str) or not model[field].strip():
            raise ValueError(f"attachment model needs {field}")
    issued_at = _timestamp(attachment.get("issued_at"), "issued_at")
    cutoff = _timestamp(attachment.get("evidence_cutoff"), "evidence_cutoff")
    if cutoff > issued_at:
        raise ValueError("evidence cutoff cannot follow issuance")
    inputs = attachment.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ValueError("attachment needs input evidence IDs")
    input_ids = []
    for item in inputs:
        if not isinstance(item.get("id"), str) or not item["id"]:
            raise ValueError("attachment input needs an evidence ID")
        available_at = _timestamp(item.get("available_at"), "input available_at")
        if available_at > cutoff:
            raise ValueError("future input provenance exceeds evidence cutoff")
        input_ids.append(item["id"])
    if len(set(input_ids)) != len(input_ids):
        raise ValueError("duplicate input evidence ID")
    definition = attachment.get("target_definition", {})
    for field in ("target", "horizon"):
        if not isinstance(definition.get(field), str) or not definition[field].strip():
            raise ValueError(f"target definition needs {field}")
    structure = definition.get("label_structure")
    if structure not in LABEL_STRUCTURES:
        raise ValueError("invalid label structure")
    output = attachment.get("output", {})
    if output.get("kind") not in OUTPUT_KINDS:
        raise ValueError("output must distinguish score from probability")
    values = output.get("values")
    if not isinstance(values, dict) or not values or not all(
            isinstance(value, (int, float)) and not isinstance(value, bool)
            for value in values.values()):
        raise ValueError("output needs numeric labeled values")
    if output["kind"] == "probability":
        if any(value < 0 or value > 1 for value in values.values()):
            raise ValueError("probabilities must be between zero and one")
        if structure == "categorical" and abs(sum(values.values()) - 1.0) > 1e-9:
            raise ValueError("categorical probabilities must sum to one")
    if structure == "multilabel" and output.get("normalization") == "sums_to_one":
        raise ValueError("multilabel outputs must not claim categorical normalization")
    assumptions = attachment.get("assumptions")
    if not isinstance(assumptions, list) or not all(isinstance(item, str) for item in assumptions):
        raise ValueError("attachment needs explicit assumptions")
    validation = attachment.get("validation", {})
    if validation.get("state") not in VALIDATION_STATES:
        raise ValueError("invalid experimental validation state")
    references = validation.get("evaluation_refs")
    if not isinstance(references, list) or not all(isinstance(item, str) for item in references):
        raise ValueError("validation needs evaluation references")
