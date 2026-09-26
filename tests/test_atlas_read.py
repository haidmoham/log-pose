import json
import subprocess
import sys
from pathlib import Path

import pytest

from log_pose.atlas_read import AtlasReadError, export_investigation, read_atlas


def write_adapter(root: Path, source: str) -> None:
    scripts = root / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    (scripts / "atlas_request.js").write_text(source)


def response_body():
    return {"schema_version": "1.0", "build_id": "a" * 64, "receipt_id": "b" * 64,
            "selection": {"clock": "inventory_year", "temporal_mode": "snapshot"},
            "operation": "focus", "edges": []}


def test_read_atlas_passes_encoded_arguments_without_a_shell(tmp_path):
    body = response_body()
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
