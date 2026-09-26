import json
import subprocess
import sys
from pathlib import Path

import pytest

from log_pose.atlas_read import (
    AtlasReadError, export_investigation, read_atlas, read_atlas_record,
    export_layered_investigation, validate_layered_investigation,
)


def write_adapter(root: Path, source: str) -> None:
    scripts = root / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    (scripts / "atlas_request.js").write_text(source)


def response_body():
    return {"schema_version": "1.0", "build_id": "a" * 64, "receipt_id": "b" * 64,
            "selection": {"clock": "inventory_year", "temporal_mode": "snapshot"},
            "operation": "focus", "focus": {"id": "candidate-a"}, "edges": []}


def test_read_atlas_passes_encoded_arguments_without_a_shell(tmp_path):
    body = dict(response_body(), operation="search")
    write_adapter(tmp_path, """
const params = new URLSearchParams(process.argv[2]);
process.stdout.write(JSON.stringify({status: 200, body: {
  ...JSON.parse(process.env.TEST_BODY), query: params.get('query')}}));
""")
    import os
    prior = os.environ.get("TEST_BODY")
    os.environ["TEST_BODY"] = json.dumps(body)
    try:
        result = read_atlas(tmp_path, {"mode": "search", "query": "$(touch never); a&b"})
    finally:
        if prior is None:
            os.environ.pop("TEST_BODY", None)
        else:
            os.environ["TEST_BODY"] = prior
    assert result["query"] == "$(touch never); a&b"
    assert not (tmp_path / "never").exists()


def test_read_atlas_enforces_clock_timeout_size_and_status(tmp_path):
    with pytest.raises(AtlasReadError, match="inventory_year"):
        read_atlas(tmp_path, {"clock": "system_known"})

    write_adapter(tmp_path, "setTimeout(() => {}, 1000);")
    with pytest.raises(AtlasReadError, match="exceeded"):
        read_atlas(tmp_path, {}, timeout_seconds=0.05)

    write_adapter(tmp_path, "process.stdout.write('x'.repeat(101));")
    with pytest.raises(AtlasReadError, match="exceeds"):
        read_atlas(tmp_path, {}, max_output_bytes=100)

    write_adapter(tmp_path, "process.stdout.write(JSON.stringify({status:409,body:{error:'build_required'}}));")
    with pytest.raises(AtlasReadError, match="409: build_required"):
        read_atlas(tmp_path, {})


def test_export_investigation_binds_one_build_and_evidence_limits(tmp_path):
    page = response_body()
    output = tmp_path / "investigation.json"
    result = export_investigation(
        output, question="Why is this overlap present?",
        cohort_query={"candidate": "candidate-a", "year": 2024},
        selected_pages=[page], omissions=["later inventory years"],
        observations=[{"status": "observed", "premise_ids": ["row-a"]}],
        interpretation="Both candidates occur in one exact placement.",
        counterevidence=[{"status": "not_reviewed"}],
        result="The overlap is an inventory lead only.",
        uncertainty="Company identity and relationship meaning are not reviewed.",
        next_question="Does a primary source document a scoped relationship?")
    assert json.loads(output.read_text()) == result
    assert result["system_known_replay"] == "unsupported"
    assert result["geometry_use"] == "display_only_not_model_input"

    conflicting = dict(page, build_id="c" * 64)
    with pytest.raises(ValueError, match="one immutable build"):
        export_investigation(
            output, question="Question", cohort_query={}, selected_pages=[page, conflicting],
            omissions=[], observations=[], interpretation="Interpretation", counterevidence=[],
            result="Result", uncertainty="Uncertainty", next_question="Next")


def test_normal_package_import_does_not_load_experimental_attachment_validator():
    completed = subprocess.run(
        [sys.executable, "-c", "import sys,log_pose; "
         "assert 'experiments.ml.atlas.validator' not in sys.modules"],
        check=False, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr


def reviewed_response_body():
    return {"build_id": "c" * 64, "receipt_id": "d" * 64, "frame_id": "e" * 64,
            "versions": {"query": "atlas-reviewed-query-v1"}, "operation": "focus",
            "focus": {"id": "snowflake", "candidate_links": [
                {"candidate_id": "candidate-snowflake", "identity_review_id": "identity-review-02"}]},
            "selection": {"clock": "source_publication", "temporal_mode": "published_through",
                          "review_lens": "current_accepted_at_build", "cutoff": "2022-02-24",
                          "basis": "documented", "predicate": "", "direction": "both"}}


def test_reviewed_read_pins_its_build_and_current_review_lens(tmp_path):
    body = reviewed_response_body()
    write_adapter(tmp_path, "process.stdout.write(" + json.dumps(json.dumps({"status": 200, "body": body})) + ");")
    record = read_atlas_record(tmp_path, {"layer": "reviewed", "mode": "focus", "cutoff": "2022-02-24"})
    assert record["request"]["build_id"] == body["build_id"]
    assert record["request"]["review_lens"] == "current_accepted_at_build"
    assert record["response"] == body
    with pytest.raises(AtlasReadError, match="immutable build"):
        read_atlas(tmp_path, {"layer": "reviewed", "cutoff": "2022-02-24", "build_id": "f" * 64})
    with pytest.raises(AtlasReadError, match="cutoff"):
        read_atlas(tmp_path, {"layer": "reviewed", "cutoff": "2021-01-01"})
    for extra in ({"clock": "inventory_year"}, {"review_cutoff": "2022-02-24"},
                  {"year": 2022}, {"valid_at": "2022-02-24"}, {"review_lens": "as_known_then"}):
        with pytest.raises(AtlasReadError):
            read_atlas(tmp_path, {"layer": "reviewed", **extra})


def test_layered_investigation_keeps_independent_builds_and_rejects_mixed_frames(tmp_path):
    from copy import deepcopy
    inventory = dict(response_body(), frame_id="f" * 64, versions={"query": "atlas-query-v1"})
    reviewed = reviewed_response_body()
    reads = [
        {"layer": "inventory", "request": {"layer": "inventory", "mode": "focus",
                                               "build_id": inventory["build_id"]},
         "response": inventory},
        {"layer": "reviewed", "request": {"layer": "reviewed", "mode": "focus",
                                             "build_id": reviewed["build_id"],
                                           "cutoff": "2022-02-24"}, "response": reviewed}]
    output = tmp_path / "layered.json"
    result = export_layered_investigation(output, question="Which evidence supports each layer?",
        cohort_query={"entity": "snowflake"}, reads=reads, omissions=["unreviewed identity joins"],
        observations=[], interpretation="The layers retain distinct evidence semantics.",
        counterevidence=[], result="Separate versioned frames.", uncertainty="Historical wording is unproven.",
        next_question="Which premise dates exclude a claim?")
    assert json.loads(output.read_text()) == result
    assert result["layer_builds"] == {"inventory": "a" * 64, "reviewed": "c" * 64}
    assert "clock" not in result
    assert result["system_known_replay"] == "unsupported"
    for field, value, message in (("build_id", "a" * 64, "immutable build"),
                                  ("frame_id", "", "frame identity")):
        changed = deepcopy(result)
        changed["reads"][1]["response"][field] = value
        with pytest.raises(ValueError, match=message):
            validate_layered_investigation(changed)
    changed = deepcopy(result)
    changed["reads"][1]["response"]["selection"]["cutoff"] = "2025-02-20"
    with pytest.raises(ValueError, match="cutoff"):
        validate_layered_investigation(changed)
    changed = deepcopy(result)
    changed["system_known_replay"] = "verified"
    with pytest.raises(ValueError, match="system-known"):
        validate_layered_investigation(changed)


def test_saved_reads_bind_operation_compare_cutoff_and_target_selectors():
    from copy import deepcopy
    response = reviewed_response_body()
    request = {"layer": "reviewed", "mode": "focus", "entity": "snowflake",
               "candidate": "candidate-snowflake", "cutoff": "2022-02-24",
               "build_id": response["build_id"]}
    investigation = {"schema_version": "atlas-layered-investigation-v1",
        "status": "research_record_not_reviewed_claim", "question": "Question",
        "interpretation": "Interpretation", "result": "Result", "uncertainty": "Unknown",
        "next_question": "Next", "omissions": [], "observations": [], "counterevidence": [],
        "cohort_query": {}, "system_known_replay": "unsupported",
        "geometry_use": "display_only_not_model_input",
        "cross_layer_join": "explicit_present_day_navigation_not_inference",
        "layer_builds": {"reviewed": response["build_id"]},
        "reads": [{"layer": "reviewed", "request": request, "response": response}]}
    validate_layered_investigation(investigation)

    swapped = deepcopy(investigation)
    swapped["reads"][0]["response"]["focus"] = {
        "id": "datadog", "candidate_links": [{"candidate_id": "candidate-datadog"}]}
    with pytest.raises(ValueError, match="entity"):
        validate_layered_investigation(swapped)

    wrong_operation = deepcopy(investigation)
    wrong_operation["reads"][0]["response"]["operation"] = "explain"
    with pytest.raises(ValueError, match="operation"):
        validate_layered_investigation(wrong_operation)

    comparison = deepcopy(investigation)
    comparison["reads"][0]["request"].update(
        {"mode": "compare", "compare_cutoff": "2021-12-31"})
    comparison["reads"][0]["response"]["operation"] = "compare"
    comparison["reads"][0]["response"]["selection"]["compare_cutoff"] = "2021-12-31"
    validate_layered_investigation(comparison)
    comparison["reads"][0]["response"]["selection"]["compare_cutoff"] = "2020-12-31"
    with pytest.raises(ValueError, match="compare_cutoff"):
        validate_layered_investigation(comparison)


def test_saved_explain_binds_neighbor_and_claim_without_build_dependence():
    response = reviewed_response_body() | {"operation": "explain",
        "neighbor": {"id": "dbt-labs"}, "claims": [{"id": "partnership-claim"}]}
    from log_pose.atlas_read import _validate_response
    parameters = {"layer": "reviewed", "mode": "explain", "entity": "snowflake",
                  "neighbor": "dbt-labs", "claim": "partnership-claim",
                  "cutoff": "2022-02-24"}
    _validate_response(response, parameters)
    with pytest.raises(AtlasReadError, match="neighbor"):
        _validate_response(response, {**parameters, "neighbor": "datadog"})
    with pytest.raises(AtlasReadError, match="claim"):
        _validate_response(response, {**parameters, "claim": "other-claim"})


def test_real_reviewed_python_read_excludes_later_premises_and_preserves_reviews():
    root = Path(__file__).resolve().parents[1]
    parameters = {"layer": "reviewed", "mode": "explain", "entity": "datadog",
                  "neighbor": "snowflake", "basis": "hypothesis", "cutoff": "2024-12-31"}
    before = read_atlas_record(root, parameters)
    after = read_atlas_record(root, {**parameters, "cutoff": "2025-02-20",
                                    "build_id": before["response"]["build_id"]})
    assert before["response"]["claims"] == []
    claims = after["response"]["claims"]
    assert len(claims) == 1
    assert claims[0]["predicate"] == "shared_exposure_hypothesis"
    assert len(claims[0]["sources"]) == 2
    assert claims[0]["review_history"]
    assert max(source["source_date"] for source in claims[0]["sources"]) == "2025-02-20"
    assert before["response"]["frame_id"] != after["response"]["frame_id"]
