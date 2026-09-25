"""Build the frozen 2024 ML operations research set from pinned source bytes.

Grain: one lead per fixed cohort member; one evidence row per retained passage.
Source time is the dated document or inventory commit. Capture time is separate.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))
from log_pose.core import normalize  # noqa: E402

CUTOFF = date(2024, 12, 31)
COHORT = ("databricks", "datarobot", "weights-and-biases", "iterative-dvc",
          "bentoml", "seldon", "zenml", "whylogs")
ROLES = ("development/experiment management", "deployment/serving",
         "monitoring/evaluation", "governance")


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def source_text(path: Path) -> str:
    raw = path.read_bytes()
    if path.suffix == ".pdf":
        return " ".join(subprocess.check_output(["pdftotext", "-layout", str(path), "-"])
                        .decode().split())
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return normalize(raw)


def passage(text: str, anchor: str, length: int = 195) -> str:
    offset = text.find(anchor)
    if offset < 0:
        raise ValueError(f"passage anchor missing: {anchor}")
    return text[offset:offset + length].rsplit(" ", 1)[0].strip()


def gate(decision: str, note: str, *evidence_ids: str) -> dict:
    return {"decision": decision, "note": note, "evidence_ids": list(evidence_ids)}


def claim(identifier: str, statement: str, basis: str, evidence_ids: list[str],
          unknowns: list[str], counterevidence_ids: list[str] | None = None) -> dict:
    return {"id": identifier, "statement": statement, "basis": basis,
            "evidence_ids": evidence_ids, "counterevidence_ids": counterevidence_ids or [],
            "unknowns": unknowns}


def build() -> dict:
    manifest = json.loads((ROOT / "experiments/ml/mlops-2024/source-manifest.json").read_text())
    report = json.loads((ROOT / "experiments/ml/mlops-2024/acquisition-report.json").read_text())
    report_by_id = {item["id"]: item for item in report["results"]}
    failed_ids = {item["id"] for item in report["failures"]}
    evidence: list[dict] = []

    anchors = {
        "datarobot-series-g-2021": ("today announced a $300 million Series G funding round", 180),
        "datarobot-itochu-2022": ("DataRobot, Inc. (headquartered in Boston", 205),
        "wandb-round-2023": ("strategic investment of $50 million", 190),
        "wandb-nairr-2024": ("By contributing licenses for their AI Developer Platform", 205),
        "wandb-aws-2024": ("Headquartered in San Francisco with a global presence", 170),
        "iterative-series-a-2021": ("DVC Studio, the company’s first commercial product", 180),
        "bentoml-tomtom-2024": ("In one experiment, we realized a significant reduction", 210),
        "zenml-funding-2023": ("The startup is set to launch ZenML Cloud", 170),
        "zenml-terms-2024": ("We are registered in Munich", 175),
        "federal-register-ai-consortium-2022": ("Seldon Technologies Limited, London", 130),
    }
    for item in manifest:
        if item["id"] in failed_ids:
            continue
        path = ROOT / item["artifact_path"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != item["expected_sha256"] or report_by_id[item["id"]]["sha256"] != digest:
            raise ValueError(f"source bytes changed: {item['id']}")
        if date.fromisoformat(item["published_on"]) > CUTOFF:
            raise ValueError(f"post-cutoff source: {item['id']}")
        anchor, length = anchors[item["id"]]
        evidence.append({
            "id": item["id"], "title": item["title"], "publisher": item["publisher"],
            "url": item["source_url"], "publication_date": item["published_on"],
            "date_kind": item.get("date_kind", "document_date"),
            "captured_at": item["retrieved_at"], "artifact_path": item["artifact_path"],
            "artifact_sha256": digest, "passage": passage(source_text(path), anchor, length),
            "review_note": "Live retrieval in 2026 of a dated source; historical body may have changed. "
                           + ("This passage belongs to adjacent AI Infrastructure Alliance notice "
                              "2022-10216 on printed page 29180. " if item["id"].startswith("federal-register") else "")
                           + ("Displayed date is last updated, not proven publication date. "
                              if item.get("date_kind") == "displayed_last_updated" else "")
                           + ("Company claim; not independently verified."
                              if item["source_type"].startswith("company") else "Interpret within its stated scope."),
        })
        if item["id"] == "federal-register-ai-consortium-2022":
            why_labs = dict(evidence[-1])
            why_labs["id"] = "federal-register-whylabs-2022"
            why_labs["passage"] = passage(source_text(path), "WhyLabs Inc., Seattle, WA", 95)
            evidence.append(why_labs)

    pages = {
        "datarobot-page-2024": ("datarobot", 2024,
                                "DataRobot delivers the industry-leading AI applications", 190),
        "wandb-page-2021": ("weights-and-biases", 2021,
                            "The developer-first", 180),
        "wandb-page-2022": ("weights-and-biases", 2022,
                            "300,000", 105),
        "wandb-page-2022-lower": ("weights-and-biases", 2022,
                                  "500,000+ machine learning practitioners", 115),
        "wandb-page-2024": ("weights-and-biases", 2024,
                            "The AI developer platform to build AI applications", 185),
    }
    for evidence_id, (slug, year, anchor, length) in pages.items():
        page = next(item for item in json.loads((ROOT / f"web/data/pages/{slug}.json").read_text())["records"]
                    if item["year"] == year)
        if date.fromisoformat(page["captured_at"][:10]) > CUTOFF:
            raise ValueError(f"post-cutoff page: {evidence_id}")
        if hashlib.sha256(page["normalized_text"].encode()).hexdigest() != page["text_sha256"]:
            raise ValueError(f"page text changed: {evidence_id}")
        evidence.append({"id": evidence_id, "title": f"{page['company_name']} archived homepage ({year})",
                         "publisher": page["company_name"], "url": page["archive_url"],
                         "publication_date": page["captured_at"][:10], "date_kind": "archive_capture",
                         "captured_at": page["captured_at"], "artifact_sha256": page["raw_sha256"],
                         "record_id": page["id"],
                         "passage": passage(page["normalized_text"], anchor, length),
                         "review_note": "Contemporaneous Common Crawl homepage capture; positioning is a company claim."})

    discovery_path = ROOT / "web/discovery.json"
    discovery = json.loads(discovery_path.read_text())
    managed_review = next(item for item in discovery["identity_reviews"]
                          if item["id"] == "identity-review-16")
    evidence.append({"id": "databricks-managed-review", "title": "Reviewed Databricks / MLflow relation",
                     "publisher": "Log Pose identity review", "url": managed_review["source_url"],
                     "publication_date": "2021-06-14", "date_kind": "cited_forum_answer",
                     "captured_at": None, "artifact_path": "web/discovery.json",
                     "artifact_sha256": hashlib.sha256(discovery_path.read_bytes()).hexdigest(),
                     "record_id": managed_review["id"], "passage": managed_review["review_note"],
                     "review_note": "Retained analyst review cites a dated employee answer. Live source retrieval failed with HTTP 403 in this bounded pull; original answer was checked separately, not captured as bytes."})
    occurrence_ids = {
        "mlflow-inventory-2024": "46e8fdef38548ff3a8ae",
        "dvc-inventory-2024": "ba1f60c08acecb7c5929",
        "bentoml-inventory-2024": "ce7bded1908fc1f01e9e",
        "seldon-inventory-2024": "afd1fd73ca63dddf9838",
        "zenml-inventory-2024": "a4dc545be702c068f5cd",
        "whylogs-inventory-2024": "97526d785cbfa2474e96",
    }
    occurrences = {item["id"]: item for item in discovery["occurrences"]}
    artifacts = {(item["source"], item["year"]): item for item in discovery["artifacts"]}
    for evidence_id, occurrence_id in occurrence_ids.items():
        row = occurrences[occurrence_id]
        artifact = artifacts[(row["source"], row["year"])]
        if row["year"] > CUTOFF.year or date.fromisoformat(artifact["commit_at"][:10]) > CUTOFF:
            raise ValueError(f"post-cutoff inventory: {evidence_id}")
        if (hashlib.sha256((ROOT / artifact["artifact_path"]).read_bytes()).hexdigest()
                != row["artifact_sha256"]):
            raise ValueError(f"inventory bytes changed: {evidence_id}")
        evidence.append({"id": evidence_id, "title": f"{row['name']} in {row['source']} inventory",
                         "publisher": row["source"].upper(), "url": row["source_url"],
                         "publication_date": artifact["commit_at"][:10],
                         "date_kind": "inventory_commit", "captured_at": artifact["commit_at"],
                         "artifact_path": artifact["artifact_path"],
                         "artifact_sha256": row["artifact_sha256"],
                         "record_id": occurrence_id, "passage": row["name"] + ": " + row["description"][:160],
                         "review_note": "Directory occurrence establishes listing only; not provider identity, payment, or adoption."})

    members = [
        {"id": "databricks", "name": "Databricks / MLflow", "disposition": "comparator",
         "disposition_reason": "A reviewed managed-service relationship to MLflow; the project is not an independent Databricks company lead.",
         "identity": {"name": "Databricks", "status": "reviewed", "aliases": ["MLflow", "MLFlow"],
                      "candidate_ids": ["be9bfc3d0ccd4bf29f49"], "review_id": "identity-review-16"},
         "gates": {"product": gate("supported", "Managed MLflow relationship is reviewed; independent commercial product details are outside this bounded pull.", "databricks-managed-review", "mlflow-inventory-2024"),
                   "private": gate("unknown", "No cutoff-dated ownership/control review in this set."),
                   "us_base": gate("unknown", "No cutoff-dated U.S. operating-base review in this set.")},
         "roles": ["development/experiment management", "deployment/serving"],
         "comparison": {"buyer": "enterprise ML teams", "offering": "managed MLflow comparator; terms unreviewed",
                        "distribution": "MLflow appears in two 2024 inventories; no usage inference",
                        "financing": "not reviewed", "competitive_context": "platform and open project comparator",
                        "unknowns": ["commercial attach", "paid retention", "control and base at cutoff"]},
         "claims": [claim("databricks-relation", "The MLflow listing is a project signal, not a count of Databricks customers.",
                          "Existing reviewed relation is managed_service (identity-review-16).", ["databricks-managed-review", "mlflow-inventory-2024"],
                          ["managed-service conversion", "commercial terms"])]},
        {"id": "datarobot", "name": "DataRobot", "disposition": "unresolved",
         "disposition_reason": "Commercial platform and Boston headquarters are documented; private/control status at the cutoff remains unresolved.",
         "identity": {"name": "DataRobot, Inc.", "status": "reviewed", "aliases": ["DataRobot"], "pilot_slug": "datarobot"},
         "gates": {"product": gate("supported", "Archived platform pages show enterprise AI software; the company reported its 2021 financing.", "datarobot-page-2024", "datarobot-series-g-2021"),
                   "private": gate("unresolved", "A 2021 private financing round does not establish 2024 control status.", "datarobot-series-g-2021"),
                   "us_base": gate("supported", "ITOCHU describes DataRobot, Inc. as Boston headquartered in 2022.", "datarobot-itochu-2022")},
         "roles": ["development/experiment management", "deployment/serving", "monitoring/evaluation", "governance"],
         "comparison": {"buyer": "enterprise AI and data leaders", "offering": "enterprise AI applications and platform",
                        "distribution": "ITOCHU described a pharmaceutical research partnership; paid scale unknown",
                        "financing": "company announced $300M Series G in 2021; neither revenue nor cutoff ownership proof",
                        "competitive_context": "broad platforms and specialist ML tooling",
                        "unknowns": ["2024 ownership", "organic recurring revenue", "retention", "services mix"]},
         "claims": [claim("datarobot-case", "Partner-led enterprise distribution is a diligence hypothesis.",
                          "ITOCHU announced a partnership; outcome and commercial value are not established.",
                          ["datarobot-itochu-2022", "datarobot-page-2024"],
                          ["contract value", "rollout", "organic growth"])]},
        {"id": "weights-and-biases", "name": "Weights & Biases", "disposition": "unresolved",
         "disposition_reason": "Product expansion and a 2024 San Francisco headquarters statement are documented; cutoff private/control status is unresolved.",
         "identity": {"name": "Weights & Biases", "status": "reviewed", "aliases": ["W&B", "wandb"],
                      "pilot_slug": "weights-and-biases"},
         "gates": {"product": gate("supported", "Archived pages and the 2023 release document tracking and LLM tooling.", "wandb-page-2021", "wandb-round-2023", "wandb-page-2024"),
                   "private": gate("unresolved", "2023 strategic financing and investor backing do not prove cutoff control status.", "wandb-round-2023", "wandb-aws-2024"),
                   "us_base": gate("supported", "A dated December 2024 company release explicitly says San Francisco headquarters; live retrieval weakens temporal certainty.", "wandb-aws-2024")},
         "roles": ["development/experiment management", "monitoring/evaluation", "governance"],
         "comparison": {"buyer": "AI developers and enterprise model teams", "offering": "experiment management, W&B Prompts and Weave",
                        "distribution": "NAIRR contributed licenses and company-reported users; neither is paid revenue",
                        "financing": "company announced $50M strategic round in 2023",
                        "competitive_context": "cloud ML suites and specialist observability tools",
                        "unknowns": ["2024 control", "paid-account cohorts", "retention", "LLM product attach"]},
         "claims": [claim("wandb-expansion", "The company described expansion from experiment tooling into LLM workflows.",
                          "2021 archived positioning differs from the 2023 launch and 2024 archived homepage.",
                          ["wandb-page-2021", "wandb-round-2023", "wandb-page-2024"],
                          ["paid conversion", "comparable usage series; the same 2022 page gives two counts"],
                          ["wandb-page-2022", "wandb-page-2022-lower"]),
                    claim("wandb-distribution", "NAIRR is a distribution signal, not a federal revenue claim.",
                          "The company announced contributed licenses for a pilot.", ["wandb-nairr-2024"],
                          ["paid conversion", "pilot usage"])]},
        {"id": "iterative-dvc", "name": "Iterative / DVC", "disposition": "unresolved",
         "disposition_reason": "Provider link, commercial DVC Studio and San Francisco base are documented in 2021; cutoff continuity and market foothold need fresh evidence.",
         "identity": {"name": "Iterative", "status": "reviewed", "aliases": ["DVC", "DVC Studio"],
                      "candidate_ids": ["be14615c5052b1c0025c"], "review_id": "identity-review-05"},
         "gates": {"product": gate("supported", "The 2021 company release calls DVC Studio its first commercial product.", "iterative-series-a-2021"),
                   "private": gate("unresolved", "A 2021 venture round does not establish 2024 independent ownership.", "iterative-series-a-2021"),
                   "us_base": gate("unresolved", "The 2021 release says San Francisco based; no newer base observation in this set.", "iterative-series-a-2021")},
         "roles": ["development/experiment management"],
         "comparison": {"buyer": "data scientists and ML engineers", "offering": "DVC Studio versus open DVC/CML",
                        "distribution": "2024 DVC directory listing; no commercial customer inference",
                        "financing": "company announced $20M Series A in 2021",
                        "competitive_context": "experiment platforms and cloud-native ML tooling",
                        "unknowns": ["2024 status and base", "customer accounts", "paid retention"]},
         "claims": [claim("iterative-product", "DVC Studio was described as commercial in 2021.",
                          "The developer relationship is separately reviewed; inventory presence does not establish adoption.",
                          ["iterative-series-a-2021", "dvc-inventory-2024"],
                          ["2024 product status", "customer foothold"])]},
        {"id": "bentoml", "name": "BentoML", "disposition": "unresolved",
         "disposition_reason": "A dated TomTom technical collaboration exists; project aliases, independent provider, paid offering and U.S. base remain unreviewed.",
         "identity": {"name": "BentoML provider hypothesis", "status": "unreviewed", "aliases": ["BentoML", "BentoCloud"],
                      "candidate_ids": ["172c379611b08a792ffe", "2602af2c38fb5fd03c99"]},
         "gates": {"product": gate("unresolved", "Case study shows technical use, not a paid contract or verified commercial terms.", "bentoml-tomtom-2024"),
                   "private": gate("unknown", "No reviewed legal provider or cutoff control record."),
                   "us_base": gate("unknown", "No dated operating-base evidence in this set.")},
         "roles": ["deployment/serving"],
         "comparison": {"buyer": "AI application and inference teams", "offering": "BentoML framework; BentoCloud commercial status unverified",
                        "distribution": "TomTom reports one collaborative experiment, not paid rollout",
                        "financing": "not reviewed", "competitive_context": "model-serving frameworks and cloud inference",
                        "unknowns": ["alias identity", "paid terms", "U.S. base", "contract and deployment scale"]},
         "claims": [claim("bentoml-experiment", "TomTom described a technical experiment with BentoML.",
                          "The case reports approximately 50% latency and cost reductions in one experiment.",
                          ["bentoml-tomtom-2024", "bentoml-inventory-2024"],
                          ["production rollout", "paid agreement", "generalizability"])]},
        {"id": "seldon", "name": "Seldon", "disposition": "unresolved",
         "disposition_reason": "A 2022 federal notice lists Seldon Technologies Limited in London; no U.S. operating base or paid-product record is established here.",
         "identity": {"name": "Seldon Technologies Limited hypothesis", "status": "unreviewed", "aliases": ["Seldon"],
                      "candidate_ids": ["d0a782423582785d9074"]},
         "gates": {"product": gate("unknown", "Inventory listing is a project occurrence, not paid-product evidence.", "seldon-inventory-2024"),
                   "private": gate("unknown", "No cutoff control record."),
                   "us_base": gate("unresolved", "The federal notice lists London; this does not rule out a U.S. operation.", "federal-register-ai-consortium-2022")},
         "roles": ["deployment/serving", "monitoring/evaluation"],
         "comparison": {"buyer": "ML platform teams", "offering": "open project listed; paid offering unverified",
                        "distribution": "2024 directory listing only", "financing": "not reviewed",
                        "competitive_context": "serving and monitoring platforms", "unknowns": ["provider link", "paid terms", "U.S. operation"]},
         "claims": [claim("seldon-location", "The named Seldon entity had a London listing in the 2022 notice.",
                          "Location of a named entity is narrower than a company operating-base decision.",
                          ["federal-register-ai-consortium-2022", "seldon-inventory-2024"],
                          ["U.S. offices", "provider relationship"])]},
        {"id": "zenml", "name": "ZenML", "disposition": "unresolved",
         "disposition_reason": "A managed Cloud plan and German registered office are documented; launched paid availability and a U.S. operating base at cutoff are not.",
         "identity": {"name": "ZenML GmbH hypothesis", "status": "unreviewed", "aliases": ["ZenML", "ZenML Cloud"],
                      "candidate_ids": ["474857eadd25cbb53593"]},
         "gates": {"product": gate("unresolved", "2023 announcement calls Cloud forthcoming; 2024 terms mention billing without proving launch.", "zenml-funding-2023", "zenml-terms-2024"),
                   "private": gate("unresolved", "2023 seed extension does not prove 2024 control.", "zenml-funding-2023"),
                   "us_base": gate("unresolved", "Munich registered office is not a full operating-base review.", "zenml-terms-2024")},
         "roles": ["development/experiment management", "deployment/serving"],
         "comparison": {"buyer": "ML platform builders", "offering": "open framework; managed Cloud was planned",
                        "distribution": "2024 directory listing; adoption unknown",
                        "financing": "company reported $3.7M seed extension in 2023",
                        "competitive_context": "pipeline orchestration and managed ML platforms",
                        "unknowns": ["Cloud launch and pricing", "paid usage", "U.S. operation", "provider continuity"]},
         "claims": [claim("zenml-cloud", "ZenML announced a managed Cloud plan, not proven 2023 availability.",
                          "The article describes a forthcoming service and the live terms carry a 2024 last-updated date.",
                          ["zenml-funding-2023", "zenml-terms-2024", "zenml-inventory-2024"],
                          ["launch date", "paid account count"])]},
        {"id": "whylogs", "name": "whylogs", "disposition": "unresolved",
         "disposition_reason": "The 2024 whylogs project listing and a 2022 Seattle WhyLabs entity listing do not yet establish a reviewed provider link or paid product.",
         "identity": {"name": "WhyLabs Inc. provider hypothesis", "status": "unreviewed", "aliases": ["whylogs", "WhyLabs"],
                      "candidate_ids": ["008a0f637e5153875eb3"]},
         "gates": {"product": gate("unknown", "Project listing is not commercial availability.", "whylogs-inventory-2024"),
                   "private": gate("unknown", "No cutoff control record."),
                   "us_base": gate("unresolved", "Federal notice lists WhyLabs Inc. in Seattle, but does not state operating-base type or link to whylogs.", "federal-register-whylabs-2022")},
         "roles": ["monitoring/evaluation"],
         "comparison": {"buyer": "ML monitoring teams", "offering": "whylogs project; provider commercial layer unreviewed",
                        "distribution": "2024 directory listing only", "financing": "not reviewed",
                        "competitive_context": "model observability and data quality tools",
                        "unknowns": ["provider link", "paid product", "Seattle operating-base type"]},
         "claims": [claim("whylogs-provider", "WhyLabs and whylogs are an unresolved provider hypothesis.",
                          "Separate dated records name the entity and project but do not document their relationship.",
                          ["federal-register-whylabs-2022", "whylogs-inventory-2024"],
                          ["legal relationship", "commercial offering"])]},
    ]

    result = {
        "schema_version": "1.0", "id": "mlops-2024", "title": "ML operations · eight-lead study",
        "as_of": CUTOFF.isoformat(), "information_cutoff": CUTOFF.isoformat(),
        "question": "Which selected U.S.-based private ML operations vendors had a distinct commercial product and credible evidence of an expanding market foothold by 2024-12-31?",
        "denominator": {"kind": "frozen_leads", "count": 8, "note": "All eight fixed leads, including comparators and unresolved cases."},
        "role_rubric": list(ROLES), "members": members, "evidence": evidence,
        "memo": {
            "priority_ids": [],
            "decision": "No unconditional diligence priority passes every identity, commercial-product, private/control, U.S.-base and cutoff gate on this bounded record.",
            "conditional_hypotheses": [
                {"member_id": "weights-and-biases", "case": "Developer distribution plus a move into LLM workflows may support enterprise expansion.",
                 "counterargument": "Reported users may be free usage; NAIRR licenses were contributed, not federal revenue.",
                 "could_change": "A 2024 control record and paid-account cohorts, retention, expansion, and LLM product attach.",
                 "next_question": "What fraction of 2024 active organizations paid, retained, and expanded?",
                 "evidence_ids": ["wandb-round-2023", "wandb-nairr-2024", "wandb-aws-2024", "wandb-page-2022", "wandb-page-2022-lower"]},
                {"member_id": "datarobot", "case": "Enterprise platform breadth and a pharmaceutical partner channel may support commercial durability.",
                 "counterargument": "Financing, acquisition, customer stories and partnership announcements do not establish organic growth or revenue quality.",
                 "could_change": "2024 control status and 2022–2024 recurring-revenue cohorts, retention, services mix, and partner outcomes.",
                 "next_question": "How much partner-sourced recurring revenue persisted after initial deployment?",
                 "evidence_ids": ["datarobot-series-g-2021", "datarobot-itochu-2022", "datarobot-page-2024"]},
            ],
            "lens": "Independent use of Telescope Partners' public partnerships and approach descriptions; not its internal criteria.",
            "limits": "This record cannot establish market share, revenue quality, complete financing history, investment returns, or a recommendation. Missing evidence does not prove absence.",
        },
        "source_budget": {"new_dated_primary_documents": len(manifest) - len(failed_ids),
                          "attempted_documents": len(manifest), "failed_retrieval_ids": sorted(failed_ids),
                          "maximum": 24,
                          "note": "Each source is one URL; the federal page informs two leads. Live 2026 retrieval caveats and failed retrievals remain visible."},
    }
    validate(result)
    return result


def validate(result: dict) -> None:
    members = result["members"]
    if tuple(item["id"] for item in members) != COHORT:
        raise ValueError("cohort order, membership or identity changed")
    if len(set(item["id"] for item in members)) != 8:
        raise ValueError("duplicate lead identity")
    if result["denominator"]["count"] != len(members):
        raise ValueError("incorrect fixed-cohort denominator")
    evidence = {item["id"]: item for item in result["evidence"]}
    if len(evidence) != len(result["evidence"]):
        raise ValueError("duplicate evidence ID")
    for item in evidence.values():
        if date.fromisoformat(item["publication_date"]) > CUTOFF:
            raise ValueError(f"cutoff leakage: {item['id']}")
        if not item["passage"] or not item["artifact_sha256"]:
            raise ValueError(f"incomplete evidence: {item['id']}")
    for member in members:
        if member["identity"]["status"] not in ("reviewed", "unreviewed"):
            raise ValueError(f"invalid identity status: {member['id']}")
        if member["disposition"] not in ("included", "comparator", "excluded", "unresolved"):
            raise ValueError(f"invalid disposition: {member['id']}")
        if set(member["roles"]) - set(ROLES):
            raise ValueError(f"unknown role: {member['id']}")
        refs = [ref for gate_item in member["gates"].values() for ref in gate_item["evidence_ids"]]
        for item in member["claims"]:
            refs += item["evidence_ids"] + item["counterevidence_ids"]
        if set(refs) - evidence.keys():
            raise ValueError(f"broken evidence reference: {member['id']}")
    priority_ids = result["memo"]["priority_ids"]
    for priority_id in priority_ids:
        member = next((item for item in members if item["id"] == priority_id), None)
        if member is None or member["identity"]["status"] != "reviewed" or any(
                gate_item["decision"] != "supported" for gate_item in member["gates"].values()):
            raise ValueError(f"priority does not pass gates: {priority_id}")
    reviewed = sum(item["identity"]["status"] == "reviewed" for item in members)
    if reviewed != 4 or len(members) != 8:
        raise ValueError("reviewed-identity aggregation changed")


if __name__ == "__main__":
    artifact = build()
    write_json(ROOT / "experiments/ml/mlops-2024/study.json", artifact)
    write_json(ROOT / "web/experimental/mlops-2024/study.json", artifact)
    print(f"built {len(artifact['members'])} leads, {len(artifact['evidence'])} evidence passages")
