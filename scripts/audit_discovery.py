"""Check a fixed 20-lead challenge set against cached original YAML rows."""

import argparse
import hashlib
import json
from pathlib import Path

import yaml


CHALLENGE = {
    "83d31ee8e2872672fdfd": "MongoDB",
    "9129ab18dfd8c1058038": "Snowflake",
    "16e8a2a890c23ec885f3": "Weaviate",
    "4f41f68387145a22bbe7": "Milvus",
    "be14615c5052b1c0025c": "DVC",
    "db7244f000eedc7a99c9": "GitLab",
    "27253adefb85d9c48b54": "LaunchDarkly",
    "517e2e92c81249d0c145": "3Scale",
    "91153e94387ce0643779": "Jenkins",
    "fa7331f6567cee42cdeb": "Backstage",
    "9467a8d3b100f62c7a3f": "Snyk",
    "4d9ade2bfb2aa6cb4afb": "Datadog",
    "0b53be52084e857862ac": "Elastic",
    "ee90402c929c690e796a": "OpenTelemetry",
    "02155d1023964b6c5233": "Vault",
    "be9bfc3d0ccd4bf29f49": "Mlflow",
    "e21278dece72ba13a566": "Kubeflow",
    "c2e4e8c5478f43051892": "AutoGen",
    "69c4a0268194c280db13": "Acumos",
    "f39bffc38db8af5f0c39": "TensorFlow",
}


def audit(index: dict, cache_dir: Path) -> list[dict]:
    artifacts = {(item["source"], item["year"]): item for item in index["artifacts"]}
    occurrences = {item["id"]: item for item in index["occurrences"]}
    candidates = {item["id"]: item for item in index["candidates"]}
    checked = []
    for candidate_id, expected_name in CHALLENGE.items():
        candidate = candidates[candidate_id]
        if candidate["name"] != expected_name:
            raise ValueError(f"challenge candidate changed: {expected_name}")
        occurrence = occurrences[candidate["occurrence_ids"][0]]
        artifact = artifacts[(occurrence["source"], occurrence["year"])]
        path = cache_dir / f"{artifact['source']}-{artifact['year']}-{artifact['commit']}.yml"
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != artifact["raw_sha256"]:
            raise ValueError(f"cached artifact changed: {path}")
        document = yaml.safe_load(raw)
        category_index, subcategory_index, item_index = occurrence["source_path"]
        category = document["landscape"][category_index]
        subcategory = category["subcategories"][subcategory_index]
        item = subcategory["items"][item_index]
        if (item["name"] != occurrence["name"]
                or (item.get("description") or "").strip() != occurrence["description"]
                or (item.get("homepage_url") or "") != occurrence["homepage_url"]
                or category["name"] != occurrence["source_category"]
                or subcategory["name"] != occurrence["source_subcategory"]):
            raise ValueError(f"source occurrence changed: {expected_name}")
        checked.append({
            "candidate": expected_name,
            "source": occurrence["source"],
            "year": occurrence["year"],
            "source_path": occurrence["source_path"],
            "source_url": occurrence["source_url"],
        })
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path("web/discovery.json"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/discovery"))
    args = parser.parse_args()
    checked = audit(json.loads(args.index.read_text()), args.cache_dir)
    print(f"{len(checked)} of {len(CHALLENGE)} challenge records match pinned original rows")
    for item in checked:
        print(f"{item['candidate']}: {item['source']} {item['year']} row {'.'.join(map(str, item['source_path']))}")


if __name__ == "__main__":
    main()
