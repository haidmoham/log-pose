"""Bounded Python reads and investigation exports for the immutable atlas."""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode


MAX_OUTPUT_BYTES = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 10


class AtlasReadError(RuntimeError):
    """A bounded atlas request failed or returned an invalid response."""


def read_atlas(repo_root: Path, parameters: dict[str, object], *,
               timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
               max_output_bytes: int = MAX_OUTPUT_BYTES) -> dict:
    """Invoke the Node atlas adapter without a shell and return a successful body."""
    root = repo_root.resolve()
    clock = parameters.get("clock", "inventory_year")
    if clock != "inventory_year":
        raise AtlasReadError("only inventory_year reconstruction is supported")
    if parameters.get("temporal_mode", "snapshot") not in {"snapshot", "accumulated"}:
        raise AtlasReadError("unsupported temporal mode")
    request_script = root / "scripts" / "atlas_request.js"
    if not request_script.is_file():
        raise AtlasReadError(f"atlas request script is missing: {request_script}")
    query = urlencode([(key, str(value)) for key, value in parameters.items()])
    try:
        completed = subprocess.run(
            ["node", str(request_script), query], cwd=root, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout_seconds,
            check=False)
    except subprocess.TimeoutExpired as error:
        raise AtlasReadError(f"atlas request exceeded {timeout_seconds:g} seconds") from error
    if len(completed.stdout) > max_output_bytes:
        raise AtlasReadError(f"atlas response exceeds {max_output_bytes} bytes")
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise AtlasReadError(f"atlas request process failed: {message or completed.returncode}")
    try:
        response = json.loads(completed.stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AtlasReadError("atlas request returned invalid JSON") from error
    if not isinstance(response, dict) or not isinstance(response.get("status"), int):
        raise AtlasReadError("atlas request lacks an HTTP-style status")
    if response["status"] != 200:
        body = response.get("body", {})
        raise AtlasReadError(f"atlas request failed with {response['status']}: "
                             f"{body.get('error', 'unknown_error')}")
    body = response.get("body")
    if not isinstance(body, dict) or body.get("selection", {}).get("clock") != "inventory_year":
        raise AtlasReadError("atlas response does not bind the inventory-year clock")
    if "build_id" not in body or "receipt_id" not in body:
        raise AtlasReadError("atlas response lacks immutable build or receipt identity")
    return body


def validate_investigation(investigation: dict) -> None:
    required_text = ("question", "interpretation", "result", "uncertainty", "next_question")
    for field in required_text:
        if not isinstance(investigation.get(field), str) or not investigation[field].strip():
            raise ValueError(f"investigation needs {field}")
    if investigation.get("clock") != {"name": "inventory_year", "precision": "year"}:
        raise ValueError("investigation must use year-precision inventory reconstruction")
    if investigation.get("system_known_replay") != "unsupported":
        raise ValueError("investigation must not claim system-known replay")
    for field in ("cohort_query", "selected_pages", "omissions", "observations", "counterevidence"):
        if not isinstance(investigation.get(field), (dict, list)):
            raise ValueError(f"investigation needs structured {field}")
    pages = investigation["selected_pages"]
    if not pages or any(page.get("selection", {}).get("clock") != "inventory_year" for page in pages):
        raise ValueError("investigation pages must bind the inventory-year clock")
    build_ids = {page.get("build_id") for page in pages}
    if None in build_ids or len(build_ids) != 1:
        raise ValueError("investigation pages must share one immutable build")
    if investigation.get("build_id") not in build_ids:
        raise ValueError("investigation build differs from selected pages")
    if investigation.get("geometry_use") != "display_only_not_model_input":
        raise ValueError("investigation must not treat geometry as model input")


def export_investigation(path: Path, *, question: str, cohort_query: dict,
                         selected_pages: list[dict], omissions: list,
                         observations: list, interpretation: str,
                         counterevidence: list, result: str, uncertainty: str,
                         next_question: str) -> dict:
    """Write one version-bound investigation with explicit evidence limits."""
    investigation = {
        "schema_version": "atlas-investigation-v1",
        "status": "research_record_not_reviewed_claim",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "build_id": selected_pages[0]["build_id"] if selected_pages else None,
        "clock": {"name": "inventory_year", "precision": "year"},
        "system_known_replay": "unsupported",
        "geometry_use": "display_only_not_model_input",
        "question": question,
        "cohort_query": cohort_query,
        "selected_pages": selected_pages,
        "omissions": omissions,
        "observations": observations,
        "interpretation": interpretation,
        "counterevidence": counterevidence,
        "result": result,
        "uncertainty": uncertainty,
        "next_question": next_question,
    }
    validate_investigation(investigation)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(investigation, ensure_ascii=False, indent=2,
                               sort_keys=True) + "\n")
    return investigation
