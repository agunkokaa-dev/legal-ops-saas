"""
Canonical-to-Qdrant sync and alias cutover for the laws module.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "app" / ".env")

try:
    from qdrant_client.http.models import Distance, PayloadSchemaType, PointStruct, VectorParams  # noqa: E402
except Exception:  # pragma: no cover - local test fallback
    class Distance:  # type: ignore[no-redef]
        COSINE = "cosine"

    class PayloadSchemaType:  # type: ignore[no-redef]
        INTEGER = "integer"
        KEYWORD = "keyword"

    class VectorParams:  # type: ignore[no-redef]
        def __init__(self, *, size: int, distance: str):
            self.size = size
            self.distance = distance

    class PointStruct:  # type: ignore[no-redef]
        def __init__(self, *, id: str, vector: list[float], payload: dict[str, Any]):
            self.id = id
            self.vector = vector
            self.payload = payload

from app.cache.law_cache import invalidate_law_caches  # noqa: E402
from app.laws.repository import build_law_corpus_repository  # noqa: E402
from app.laws.service import LAW_PAYLOAD_SCHEMA_VERSION  # noqa: E402
from app.laws.utils import stable_uuid  # noqa: E402


def _embed(text: str) -> list[float]:
    from app.config import openai_client

    response = openai_client.embeddings.create(
        input=text[:8000],
        model="text-embedding-3-small",
    )
    return response.data[0].embedding


def ensure_collection(collection_name: str) -> None:
    from app.config import qdrant

    existing = [collection.name for collection in qdrant.get_collections().collections]
    if collection_name in existing:
        qdrant.delete_collection(collection_name)
    qdrant.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
    )
    for field_name, field_schema in [
        ("schema_version", PayloadSchemaType.INTEGER),
        ("law_short", PayloadSchemaType.KEYWORD),
        ("category", PayloadSchemaType.KEYWORD),
        ("legal_status", PayloadSchemaType.KEYWORD),
        ("verification_status", PayloadSchemaType.KEYWORD),
        ("contract_relevance", PayloadSchemaType.KEYWORD),
        ("structural_node_id", PayloadSchemaType.KEYWORD),
    ]:
        qdrant.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=field_schema,
        )


def build_payload(node: dict[str, Any], law: dict[str, Any], version: dict[str, Any], hierarchy: list[dict[str, Any]]) -> dict[str, Any]:
    identifier_full = " ".join(
        item.get("identifier") or item.get("heading") or ""
        for item in hierarchy
        if item.get("identifier") or item.get("heading")
    ).strip()
    bab = next((item.get("heading") for item in hierarchy if item.get("node_type") == "bab"), None)
    return {
        "schema_version": LAW_PAYLOAD_SCHEMA_VERSION,
        "structural_node_id": str(node["id"]),
        "law_id": str(law["id"]),
        "law_version_id": str(version["id"]),
        "law_short": law["short_name"],
        "law_type": law["law_type"],
        "category": law["category"],
        "identifier": node["identifier"],
        "identifier_full": identifier_full or node["identifier"],
        "bab": bab,
        "body": node.get("body"),
        "legal_status": node.get("legal_status"),
        "effective_from": str(node.get("effective_from") or version.get("effective_from")),
        "effective_to": str(node.get("effective_to")) if node.get("effective_to") else (str(version.get("effective_to")) if version.get("effective_to") else None),
        "contract_relevance": node.get("contract_relevance"),
        "contract_types": node.get("contract_types") or [],
        "topic_tags": node.get("topic_tags") or [],
        "extraction_method": node.get("extraction_method"),
        "verification_status": node.get("verification_status"),
        "human_verified_at": str(node.get("human_verified_at")) if node.get("human_verified_at") else None,
    }


def build_points(repo, content_nodes: list[dict[str, Any]]) -> list[PointStruct]:
    points: list[PointStruct] = []
    for node in content_nodes:
        version = repo.get_version(str(node["law_version_id"]))
        if not version:
            continue
        law = repo.get_law(str(version["law_id"]))
        if not law:
            continue
        hierarchy = repo.get_parent_chain(node) + [node]
        payload = build_payload(node, law, version, hierarchy)
        context = " ".join(filter(None, [payload.get("bab"), payload["identifier_full"], payload["body"]]))
        vector = _embed(context)
        points.append(
            PointStruct(
                id=stable_uuid("qdrant-point", node["id"]),
                vector=vector,
                payload=payload,
            )
        )
    return points


def sync_collection(target_collection: str) -> dict[str, Any]:
    from app.config import qdrant

    repo = build_law_corpus_repository()
    content_nodes = repo.list_content_nodes()
    ensure_collection(target_collection)
    points = build_points(repo, content_nodes)

    batch_size = 32
    for index in range(0, len(points), batch_size):
        qdrant.upsert(
            collection_name=target_collection,
            points=points[index : index + batch_size],
        )

    return {
        "canonical_content_nodes": len(content_nodes),
        "qdrant_points": len(points),
        "target_collection": target_collection,
    }


def collect_parity(target_collection: str) -> dict[str, Any]:
    from app.config import qdrant

    repo = build_law_corpus_repository()
    content_nodes = repo.list_content_nodes()
    info = qdrant.get_collection(target_collection)
    point_count = int(getattr(info, "points_count", 0) or 0)
    failures: list[str] = []
    if point_count != len(content_nodes):
        failures.append("point_count_mismatch")

    sample_failures: list[str] = []
    sample_ids = {str(node["id"]) for node in content_nodes[:20]}
    scanned_ids: set[str] = set()
    offset = None
    while True:
        points, next_offset = qdrant.scroll(
            collection_name=target_collection,
            limit=50,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in points:
            payload = point.payload or {}
            structural_node_id = payload.get("structural_node_id")
            if payload.get("schema_version") != LAW_PAYLOAD_SCHEMA_VERSION:
                sample_failures.append("schema_version_mismatch")
            if not structural_node_id:
                sample_failures.append("missing_structural_node_id")
            if structural_node_id in sample_ids:
                scanned_ids.add(str(structural_node_id))
        if next_offset is None:
            break
        offset = next_offset
    missing_samples = sorted(sample_ids - scanned_ids)
    if missing_samples:
        sample_failures.append("missing_sample_nodes")

    return {
        "target_collection": target_collection,
        "canonical_content_nodes": len(content_nodes),
        "qdrant_point_count": point_count,
        "parity_ok": not failures and not sample_failures,
        "failures": failures,
        "parity_sample_failures": sample_failures,
    }


def _qdrant_http_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.config import QDRANT_URL

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url=f"{QDRANT_URL.rstrip('/')}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def promote_alias(target_collection: str, alias_name: str | None = None) -> dict[str, Any]:
    from app.config import LAW_QDRANT_ACTIVE_ALIAS

    alias_name = alias_name or LAW_QDRANT_ACTIVE_ALIAS
    parity = collect_parity(target_collection)
    if not parity["parity_ok"]:
        raise SystemExit(f"Cannot promote alias; parity failed: {json.dumps(parity)}")

    payload = {
        "actions": [
            {
                "delete_alias": {
                    "alias_name": alias_name,
                }
            },
            {
                "create_alias": {
                    "collection_name": target_collection,
                    "alias_name": alias_name,
                }
            },
        ]
    }
    try:
        return _qdrant_http_request("POST", "/collections/aliases", payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            payload = {
                "actions": [
                    {
                        "create_alias": {
                            "collection_name": target_collection,
                            "alias_name": alias_name,
                        }
                    }
                ]
            }
            return _qdrant_http_request("POST", "/collections/aliases", payload)
        raise


def rollback_alias(target_collection: str, alias_name: str | None = None) -> dict[str, Any]:
    from app.config import LAW_QDRANT_ACTIVE_ALIAS

    alias_name = alias_name or LAW_QDRANT_ACTIVE_ALIAS
    payload = {
        "actions": [
            {
                "delete_alias": {
                    "alias_name": alias_name,
                }
            },
            {
                "create_alias": {
                    "collection_name": target_collection,
                    "alias_name": alias_name,
                }
            },
        ]
    }
    return _qdrant_http_request("POST", "/collections/aliases", payload)


def parse_args() -> argparse.Namespace:
    from app.config import LAW_QDRANT_V2_COLLECTION, NATIONAL_LAWS_COLLECTION

    parser = argparse.ArgumentParser(description="Sync canonical laws into Qdrant v2 and manage alias cutover.")
    parser.add_argument("--target-collection", default=LAW_QDRANT_V2_COLLECTION)
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--parity-check", action="store_true")
    parser.add_argument("--promote-alias", action="store_true")
    parser.add_argument("--rollback-alias", action="store_true")
    parser.add_argument("--rollback-collection", default=NATIONAL_LAWS_COLLECTION)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result: dict[str, Any] = {}

    if args.build_only or (not args.parity_check and not args.promote_alias and not args.rollback_alias):
        result["build"] = sync_collection(args.target_collection)

    if args.parity_check:
        result["parity"] = collect_parity(args.target_collection)

    if args.promote_alias:
        result["alias"] = promote_alias(args.target_collection)

    if args.rollback_alias:
        result["rollback"] = rollback_alias(args.rollback_collection)

    if result:
        print(json.dumps(result, indent=2))
    if result.get("parity") and not result["parity"]["parity_ok"]:
        return 1
    if result.get("build"):
        import asyncio
        asyncio.run(invalidate_law_caches())
    return 0


if __name__ == "__main__":
    sys.exit(main())
