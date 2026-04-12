"""
Repair legacy company_rules vectors that were written without tenant_id.

The preferred repair path resolves tenant ownership from the canonical
`company_playbooks` table using the vector's `rule_id` (or point id).
Vectors that still cannot be resolved are reported so operators can
either re-upload the affected playbooks or wipe the collection cleanly.

Usage:
    cd /root/workspace-saas
    python3 -m backend.scripts.repair_playbook_vectors
    python3 -m backend.scripts.repair_playbook_vectors --apply
    python3 -m backend.scripts.repair_playbook_vectors --apply --wipe-collection
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, PointStruct, VectorParams
from supabase import create_client


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
load_dotenv(BACKEND_DIR / ".env")

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
COLLECTION = "company_rules"


def build_clients() -> tuple[QdrantClient, Any]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    qdrant = QdrantClient(url=QDRANT_URL)
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return qdrant, supabase


def fetch_all_points(qdrant: QdrantClient) -> list[Any]:
    points: list[Any] = []
    offset = None

    while True:
        batch, offset = qdrant.scroll(
            collection_name=COLLECTION,
            limit=200,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )
        points.extend(batch)
        if offset is None:
            break

    return points


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def load_rule_tenant_map(supabase: Any, orphan_points: list[Any]) -> dict[str, str]:
    candidate_ids: set[str] = set()
    for point in orphan_points:
        payload = dict(point.payload or {})
        rule_id = payload.get("rule_id")
        if rule_id is not None:
            candidate_ids.add(str(rule_id))
        if point.id is not None:
            candidate_ids.add(str(point.id))

    mapping: dict[str, str] = {}
    for batch in chunked(sorted(candidate_ids), 100):
        response = (
            supabase.table("company_playbooks")
            .select("id, tenant_id")
            .in_("id", batch)
            .execute()
        )
        for row in response.data or []:
            if row.get("id") is not None and row.get("tenant_id"):
                mapping[str(row["id"])] = row["tenant_id"]

    return mapping


def build_repaired_points(orphan_points: list[Any], tenant_map: dict[str, str]) -> tuple[list[PointStruct], list[Any]]:
    repaired: list[PointStruct] = []
    unresolved: list[Any] = []

    for point in orphan_points:
        payload = dict(point.payload or {})
        candidate_ids = [payload.get("rule_id"), point.id]

        tenant_id = None
        for candidate in candidate_ids:
            if candidate is None:
                continue
            tenant_id = tenant_map.get(str(candidate))
            if tenant_id:
                break

        if not tenant_id:
            unresolved.append(point)
            continue

        payload.pop("user_id", None)
        payload["tenant_id"] = tenant_id
        repaired.append(
            PointStruct(
                id=point.id,
                vector=point.vector,
                payload=payload,
            )
        )

    return repaired, unresolved


def wipe_collection(qdrant: QdrantClient) -> None:
    qdrant.delete_collection(collection_name=COLLECTION)
    qdrant.create_collection(
        collection_name=COLLECTION,
        vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Repair legacy company_rules vectors")
    parser.add_argument("--apply", action="store_true", help="Upsert repaired payloads back into Qdrant")
    parser.add_argument(
        "--wipe-collection",
        action="store_true",
        help="Delete and recreate the entire company_rules collection after reporting unresolved vectors",
    )
    args = parser.parse_args()

    qdrant, supabase = build_clients()
    points = fetch_all_points(qdrant)

    orphan_points = [
        point
        for point in points
        if not dict(point.payload or {}).get("tenant_id")
    ]

    print(f"[playbook-repair] Total vectors scanned: {len(points)}")
    print(f"[playbook-repair] Vectors missing tenant_id: {len(orphan_points)}")

    if not orphan_points:
        if args.wipe_collection:
            wipe_collection(qdrant)
            print("[playbook-repair] company_rules collection wiped and recreated.")
            return 0
        print("[playbook-repair] Nothing to repair.")
        return 0

    tenant_map = load_rule_tenant_map(supabase, orphan_points)
    repaired, unresolved = build_repaired_points(orphan_points, tenant_map)

    print(f"[playbook-repair] Repairable via company_playbooks lookup: {len(repaired)}")
    print(f"[playbook-repair] Still unresolved: {len(unresolved)}")

    if args.apply and repaired:
        qdrant.upsert(collection_name=COLLECTION, points=repaired)
        print(f"[playbook-repair] Applied repairs to {len(repaired)} vectors.")
    elif repaired:
        print("[playbook-repair] Dry run only. Re-run with --apply to write repaired payloads.")

    if unresolved:
        sample_ids = [str(point.id) for point in unresolved[:10]]
        print(f"[playbook-repair] Sample unresolved point ids: {sample_ids}")
        print(
            "[playbook-repair] Unresolved vectors could not be mapped from company_playbooks. "
            "Re-upload those playbooks or wipe the collection and re-vectorize cleanly."
        )

    if args.wipe_collection:
        wipe_collection(qdrant)
        print("[playbook-repair] company_rules collection wiped and recreated.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
