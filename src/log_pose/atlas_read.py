"""Bounded Python reads and investigation exports for the immutable atlas."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode


MAX_OUTPUT_BYTES = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 10


class AtlasReadError(RuntimeError):
    """A bounded atlas request failed or returned an invalid response."""


def _temporal_contract(parameters: dict) -> tuple[str, str, str]:
    layer = parameters.get("layer", "inventory")
    unsupported = {"system_time", "review_cutoff", "valid_at", "valid_from", "valid_to", "replay"}
    unsupported |= ({"year", "inventory_year", "source", "category", "artifact"}
                    if layer == "reviewed" else {"cutoff", "compare_cutoff", "review_lens"})
    if unsupported.intersection(parameters):
        raise AtlasReadError("requested historical clock is unsupported")
    if layer == "inventory":
        clock, default_mode, modes = "inventory_year", "snapshot", {"snapshot", "accumulated"}
    elif layer == "reviewed":
        clock, default_mode, modes = "source_publication", "published_through", {"published_through"}
        if parameters.get("review_lens", "current_accepted_at_build") != "current_accepted_at_build":
            raise AtlasReadError("only the current accepted review lens is supported")
    else:
        raise AtlasReadError("choose inventory or reviewed layer")
    if parameters.get("clock", clock) != clock:
        raise AtlasReadError(f"{layer} reads require the {clock} clock")
    temporal_mode = parameters.get("temporal_mode", default_mode)
    if temporal_mode not in modes:
        raise AtlasReadError("unsupported temporal mode")
    return layer, clock, temporal_mode


def _validate_response(body: dict, parameters: dict) -> None:
    layer, clock, temporal_mode = _temporal_contract(parameters)
    selection = body.get("selection", {})
    if not isinstance(selection, dict):
        raise AtlasReadError("atlas response needs explicit selectors")
    if selection.get("clock") != clock or selection.get("temporal_mode") != temporal_mode:
        raise AtlasReadError("atlas response does not bind the requested clock and mode")
    if layer == "reviewed" and selection.get("review_lens") != "current_accepted_at_build":
        raise AtlasReadError("reviewed response lacks the current accepted review lens")
    defaults = {"cutoff": "", "basis": "documented", "predicate": "", "direction": "both"}
    selector_fields = defaults if layer == "reviewed" else {key: "" for key in
        ("source", "year", "category", "artifact") if key in parameters}
    for key, default in selector_fields.items():
        expected = str(parameters.get(key, default))
        if key == "predicate" and expected == "all":
            expected = ""
        if selection.get(key) != expected:
            raise AtlasReadError(f"atlas response differs from requested {key}")
    for field in ("build_id", "receipt_id"):
        if not isinstance(body.get(field), str) or not re.fullmatch(r"[a-f0-9]{64}", body[field]):
            raise AtlasReadError("atlas response lacks immutable build or receipt identity")
    if parameters.get("build_id") and parameters["build_id"] != body["build_id"]:
        raise AtlasReadError("atlas response differs from the requested immutable build")
    operation = str(parameters.get("mode", "discover"))
    if body.get("operation") != operation:
        raise AtlasReadError("atlas response differs from requested operation")
    if "compare_cutoff" in parameters \
            and selection.get("compare_cutoff") != str(parameters["compare_cutoff"]):
        raise AtlasReadError("atlas response differs from requested compare_cutoff")
    _validate_target_binding(body, parameters, layer)


def _validate_target_binding(body: dict, parameters: dict, layer: str) -> None:
    """Bind saved target selectors to descriptors, independent of build identity."""
    operation = str(parameters.get("mode", "discover"))
    if operation == "traverse" and layer == "reviewed":
        focus = body.get("start")
        neighbor_descriptor = None
        claims = [claim for edge in body.get("path") or [] for claim in edge.get("claims", [])]
    elif operation == "traverse":
        path = body.get("path") or []
        focus = {"id": path[0].get("subject")} if path else None
        neighbor_descriptor = None
        claims = []
    elif operation == "export" and layer == "reviewed":
        focus_envelope = body.get("focus")
        focus = focus_envelope.get("focus") if isinstance(focus_envelope, dict) else None
        evidence = body.get("explained")
        neighbor_descriptor = evidence.get("neighbor") if isinstance(evidence, dict) else None
        claims = evidence.get("claims", []) if isinstance(evidence, dict) else []
    elif operation == "export":
        focus_envelope = body.get("neighborhood")
        focus = focus_envelope.get("focus") if isinstance(focus_envelope, dict) else None
        evidence = body.get("evidence")
        neighbor_descriptor = evidence.get("object") if isinstance(evidence, dict) else None
        claims = []
    else:
        focus = body.get("focus")
        neighbor_descriptor = body.get("neighbor") if layer == "reviewed" else body.get("object")
        claims = body.get("claims", [])
    if "entity" in parameters:
        if not isinstance(focus, dict) or focus.get("id") != str(parameters["entity"]):
            raise AtlasReadError("atlas response differs from requested entity")
    if "candidate" in parameters:
        candidate = str(parameters["candidate"])
        if layer == "reviewed":
            links = focus.get("candidate_links", []) if isinstance(focus, dict) else []
            if not any(isinstance(link, dict) and link.get("candidate_id") == candidate
                       for link in links):
                raise AtlasReadError("atlas response differs from requested candidate")
        else:
            descriptor = focus if isinstance(focus, dict) else body.get("subject")
            if operation == "traverse" and descriptor is None:
                pass  # Inventory misses do not return start/target descriptors.
            elif not isinstance(descriptor, dict) or descriptor.get("id") != candidate:
                raise AtlasReadError("atlas response differs from requested candidate")
    if "neighbor" in parameters:
        if not isinstance(neighbor_descriptor, dict) \
                or neighbor_descriptor.get("id") != str(parameters["neighbor"]):
            raise AtlasReadError("atlas response differs from requested neighbor")
    if "claim" in parameters:
        if not isinstance(claims, list) or not any(
                isinstance(claim, dict) and claim.get("id") == str(parameters["claim"])
                for claim in claims):
            raise AtlasReadError("atlas response differs from requested claim")
    if "target" in parameters:
        if layer == "reviewed":
            target = body.get("target")
            target_id = target.get("id") if isinstance(target, dict) else None
            if target_id is None:
                raise AtlasReadError("atlas response lacks requested target")
        else:
            path = body.get("path") or []
            target_id = path[-1].get("object") if path else None
        if target_id is not None and target_id != str(parameters["target"]):
            raise AtlasReadError("atlas response differs from requested target")


def read_atlas(repo_root: Path, parameters: dict[str, object], *,
               timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
               max_output_bytes: int = MAX_OUTPUT_BYTES) -> dict:
    """Invoke the Node atlas adapter without a shell and return a successful body."""
    root = repo_root.resolve()
    _temporal_contract(parameters)
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
    if not isinstance(body, dict):
        raise AtlasReadError("atlas response needs an object body")
    _validate_response(body, parameters)
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


def read_atlas_record(repo_root: Path, parameters: dict[str, object], **limits) -> dict:
    """Retain a replayable request beside its response without merging clocks."""
    body = read_atlas(repo_root, parameters, **limits)
    layer, clock, temporal_mode = _temporal_contract(parameters)
    request = dict(parameters, layer=layer, clock=clock, temporal_mode=temporal_mode,
                   build_id=body["build_id"])
    request.setdefault("mode", "discover")
    if layer == "reviewed":
        request["review_lens"] = "current_accepted_at_build"
    return {"layer": layer, "request": request, "response": body}


def validate_layered_investigation(investigation: dict) -> None:
    """Validate independent read frames; a path or join is not a new claim."""
    if investigation.get("schema_version") != "atlas-layered-investigation-v1":
        raise ValueError("unsupported layered investigation schema")
    if investigation.get("status") != "research_record_not_reviewed_claim":
        raise ValueError("investigation cannot claim semantic acceptance")
    for field in ("question", "interpretation", "result", "uncertainty", "next_question"):
        if not isinstance(investigation.get(field), str) or not investigation[field].strip():
            raise ValueError(f"investigation needs {field}")
    for field in ("omissions", "observations", "counterevidence"):
        if not isinstance(investigation.get(field), list):
            raise ValueError(f"investigation needs structured {field}")
    if not isinstance(investigation.get("cohort_query"), dict):
        raise ValueError("investigation needs a cohort query")
    if investigation.get("system_known_replay") != "unsupported":
        raise ValueError("investigation must not claim system-known replay")
    if investigation.get("geometry_use") != "display_only_not_model_input":
        raise ValueError("investigation must not treat geometry as model input")
    if investigation.get("cross_layer_join") != "explicit_present_day_navigation_not_inference":
        raise ValueError("cross-layer navigation is not an inferred or historical relationship")
    reads = investigation.get("reads")
    if not isinstance(reads, list) or not 1 <= len(reads) <= 32:
        raise ValueError("investigation needs 1 to 32 bounded reads")
    builds = {}
    for record in reads:
        if not isinstance(record, dict) or not isinstance(record.get("request"), dict) \
                or not isinstance(record.get("response"), dict):
            raise ValueError("investigation needs request/response records")
        request, response = record["request"], record["response"]
        layer = record.get("layer")
        if layer not in {"inventory", "reviewed"} or request.get("layer") != layer:
            raise ValueError("read layer differs from its request")
        try:
            _validate_response(response, request)
        except AtlasReadError as error:
            raise ValueError(str(error)) from error
        if request.get("build_id") != response["build_id"]:
            raise ValueError("saved request must pin its response build")
        if layer in builds and builds[layer] != response["build_id"]:
            raise ValueError("each layer must share one immutable build")
        builds[layer] = response["build_id"]
        if not isinstance(response.get("versions"), dict) or not response["versions"]:
            raise ValueError("saved read needs derivation versions")
        if not isinstance(response.get("frame_id"), str) \
                or not re.fullmatch(r"[a-f0-9]{64}", response["frame_id"]):
            raise ValueError("saved read needs an immutable frame identity")
        if len(json.dumps(response).encode("utf-8")) > MAX_OUTPUT_BYTES:
            raise ValueError("saved read exceeds the interactive response limit")
    if investigation.get("layer_builds") != builds:
        raise ValueError("layer build manifest differs from saved reads")


def export_layered_investigation(path: Path, *, question: str, cohort_query: dict,
                                 reads: list[dict], omissions: list,
                                 observations: list, interpretation: str,
                                 counterevidence: list, result: str, uncertainty: str,
                                 next_question: str) -> dict:
    """Save independent versioned read frames and an explicitly unreviewed interpretation."""
    investigation = {
        "schema_version": "atlas-layered-investigation-v1",
        "status": "research_record_not_reviewed_claim",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "layer_builds": {record["layer"]: record["response"]["build_id"] for record in reads},
        "system_known_replay": "unsupported",
        "geometry_use": "display_only_not_model_input",
        "cross_layer_join": "explicit_present_day_navigation_not_inference",
        "question": question, "cohort_query": cohort_query, "reads": reads,
        "omissions": omissions, "observations": observations,
        "interpretation": interpretation, "counterevidence": counterevidence,
        "result": result, "uncertainty": uncertainty, "next_question": next_question,
    }
    validate_layered_investigation(investigation)
    serialized = json.dumps(investigation, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if len(serialized.encode("utf-8")) > 4 * MAX_OUTPUT_BYTES:
        raise ValueError("investigation exceeds the 4 MiB saved-record limit")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(serialized)
    return investigation
