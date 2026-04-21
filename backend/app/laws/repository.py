from __future__ import annotations

import logging
from datetime import date
from typing import Any

from app.laws.utils import normalize_identifier

logger = logging.getLogger("pariana.laws.repository")

GLOBAL_CORPUS_TABLES = {
    "laws",
    "law_versions",
    "structural_nodes",
    "pasal_references",
    "corpus_coverage",
}


def _rows(result: Any) -> list[dict[str, Any]]:
    data = getattr(result, "data", None)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


class LawCorpusRepository:
    def __init__(
        self,
        *,
        supabase: Any,
        qdrant: Any,
        active_collection: str,
        v2_collection: str,
        legacy_collection: str,
        qdrant_url: str | None = None,
    ) -> None:
        self.supabase = supabase
        self.qdrant = qdrant
        self.active_collection = active_collection
        self.v2_collection = v2_collection
        self.legacy_collection = legacy_collection
        self.qdrant_url = qdrant_url

    def _table(self, table_name: str) -> Any:
        if table_name not in GLOBAL_CORPUS_TABLES:
            raise ValueError(f"Unsupported corpus table access: {table_name}")
        return self.supabase.table(table_name)

    def read_table(self, table_name: str, *, select: str = "*") -> list[dict[str, Any]]:
        return _rows(self._table(table_name).select(select).execute())

    def upsert_rows(self, table_name: str, rows: list[dict[str, Any]] | dict[str, Any], *, on_conflict: str | None = None) -> list[dict[str, Any]]:
        query = self._table(table_name).upsert(rows, on_conflict=on_conflict) if on_conflict else self._table(table_name).upsert(rows)
        return _rows(query.execute())

    def get_known_law_shorts(self) -> set[str]:
        laws = _rows(self._table("laws").select("short_name").execute())
        return {str(item["short_name"]).upper() for item in laws if item.get("short_name")}

    def list_laws_catalog(self) -> list[dict[str, Any]]:
        return _rows(
            self._table("laws")
            .select("id, short_name, full_name, law_type, number, year, category, legal_status, official_source_url, last_verified_at")
            .order("year", desc=True)
            .execute()
        )

    def list_coverage(self) -> list[dict[str, Any]]:
        return _rows(
            self._table("corpus_coverage")
            .select("*")
            .order("category")
            .execute()
        )

    def get_law_by_reference(
        self,
        *,
        law_short: str | None,
        law_type: str | None,
        law_number: str | None,
        law_year: int | None,
    ) -> list[dict[str, Any]]:
        if law_short:
            rows = _rows(
                self._table("laws")
                .select("*")
                .eq("short_name", law_short.upper())
                .limit(5)
                .execute()
            )
            if rows:
                return rows
        if law_type and law_number and law_year:
            return _rows(
                self._table("laws")
                .select("*")
                .eq("law_type", law_type.upper())
                .eq("number", str(law_number))
                .eq("year", int(law_year))
                .limit(5)
                .execute()
            )
        return []

    def get_versions_for_law(self, law_id: str) -> list[dict[str, Any]]:
        return _rows(
            self._table("law_versions")
            .select("*")
            .eq("law_id", law_id)
            .order("version_number", desc=True)
            .execute()
        )

    def get_version_as_of(self, law_id: str, effective_as_of: date) -> dict[str, Any] | None:
        versions = self.get_versions_for_law(law_id)
        for version in versions:
            start = date.fromisoformat(str(version["effective_from"]))
            end = date.fromisoformat(str(version["effective_to"])) if version.get("effective_to") else None
            if effective_as_of < start:
                continue
            if end and effective_as_of >= end:
                continue
            return version
        return versions[0] if versions else None

    def find_node_in_version(
        self,
        *,
        law_version_id: str,
        identifier_normalized: str,
        parent_id: str | None = None,
    ) -> dict[str, Any] | None:
        rows = _rows(
            self._table("structural_nodes")
            .select("*")
            .eq("law_version_id", law_version_id)
            .eq("identifier_normalized", identifier_normalized)
            .execute()
        )
        for row in rows:
            if parent_id is None and row.get("parent_id") is None:
                return row
            if parent_id is not None and str(row.get("parent_id")) == str(parent_id):
                return row
        return None

    def find_pasal_node(self, *, law_version_id: str, pasal_identifier: str) -> dict[str, Any] | None:
        normalized = normalize_identifier(pasal_identifier)
        rows = _rows(
            self._table("structural_nodes")
            .select("*")
            .eq("law_version_id", law_version_id)
            .eq("node_type", "pasal")
            .eq("identifier_normalized", normalized)
            .limit(1)
            .execute()
        )
        return rows[0] if rows else None

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        rows = _rows(
            self._table("structural_nodes")
            .select("*")
            .eq("id", node_id)
            .limit(1)
            .execute()
        )
        return rows[0] if rows else None

    def get_nodes_by_ids(self, node_ids: list[str]) -> list[dict[str, Any]]:
        if not node_ids:
            return []
        return _rows(
            self._table("structural_nodes")
            .select("*")
            .in_("id", node_ids)
            .execute()
        )

    def get_pasal_references_for_source_nodes(self, source_node_ids: list[str]) -> list[dict[str, Any]]:
        if not source_node_ids:
            return []
        return _rows(
            self._table("pasal_references")
            .select("*")
            .in_("source_node_id", source_node_ids)
            .execute()
        )

    def get_children(self, parent_id: str) -> list[dict[str, Any]]:
        return _rows(
            self._table("structural_nodes")
            .select("*")
            .eq("parent_id", parent_id)
            .order("sequence_order")
            .execute()
        )

    def get_parent_chain(self, node: dict[str, Any]) -> list[dict[str, Any]]:
        chain: list[dict[str, Any]] = []
        current = node
        seen: set[str] = set()
        while current.get("parent_id"):
            parent_id = str(current["parent_id"])
            if parent_id in seen:
                break
            seen.add(parent_id)
            parent = self.get_node(parent_id)
            if not parent:
                break
            chain.append(parent)
            current = parent
        chain.reverse()
        return chain

    def get_article_siblings(self, node: dict[str, Any]) -> list[dict[str, Any]]:
        article = node
        seen: set[str] = set()
        while article.get("parent_id") and article.get("node_type") != "pasal":
            parent_id = str(article["parent_id"])
            if parent_id in seen:
                break
            seen.add(parent_id)
            parent = self.get_node(parent_id)
            if not parent:
                break
            article = parent

        container = article
        while container.get("parent_id") and container.get("node_type") != "bab":
            parent_id = str(container["parent_id"])
            if parent_id in seen:
                break
            seen.add(parent_id)
            parent = self.get_node(parent_id)
            if not parent:
                break
            container = parent

        if container.get("node_type") != "bab":
            return self.get_children(str(article["id"])) if article.get("node_type") == "pasal" else []

        siblings: list[dict[str, Any]] = []
        queue = self.get_children(str(container["id"]))
        while queue:
            current = queue.pop(0)
            if current.get("node_type") == "pasal":
                siblings.append(current)
                continue
            queue.extend(self.get_children(str(current["id"])))
        return siblings

    def get_law(self, law_id: str) -> dict[str, Any] | None:
        rows = _rows(self._table("laws").select("*").eq("id", law_id).limit(1).execute())
        return rows[0] if rows else None

    def get_version(self, version_id: str) -> dict[str, Any] | None:
        rows = _rows(self._table("law_versions").select("*").eq("id", version_id).limit(1).execute())
        return rows[0] if rows else None

    def list_content_nodes(self) -> list[dict[str, Any]]:
        rows = _rows(
            self._table("structural_nodes")
            .select("*")
            .order("law_version_id")
            .order("sequence_order")
            .execute()
        )
        return [row for row in rows if row.get("body")]

    def canonical_counts(self) -> dict[str, int]:
        all_nodes = self.read_table("structural_nodes", select="id, body")
        laws = self.read_table("laws", select="id")
        return {
            "canonical_node_count": len(all_nodes),
            "canonical_nodes_with_body": len([node for node in all_nodes if node.get("body")]),
            "total_laws": len(laws),
        }

    def get_alias_target(self, alias_name: str) -> str | None:
        getter = getattr(self.qdrant, "get_aliases", None)
        if not callable(getter):
            return None
        response = getter()
        aliases = getattr(response, "aliases", None)
        if aliases is None and isinstance(response, dict):
            aliases = response.get("aliases", [])
        for alias in aliases or []:
            alias_name_value = getattr(alias, "alias_name", None) or alias.get("alias_name")
            collection_name = getattr(alias, "collection_name", None) or alias.get("collection_name")
            if alias_name_value == alias_name:
                return collection_name
        return None

    def get_qdrant_point_count(self, collection_name: str) -> int:
        try:
            info = self.qdrant.get_collection(collection_name)
        except Exception:
            return 0
        count = getattr(info, "points_count", None)
        if count is None and isinstance(info, dict):
            count = info.get("points_count", 0)
        return int(count or 0)

    def get_sync_status(self, *, alias_name: str, target_collection: str, payload_schema_version: int) -> dict[str, Any]:
        counts = self.canonical_counts()
        alias_target = self.get_alias_target(alias_name)
        qdrant_points = self.get_qdrant_point_count(alias_target or target_collection)
        parity_failures: list[str] = []
        if qdrant_points != counts["canonical_nodes_with_body"]:
            parity_failures.append("point_count_mismatch")
        return {
            "alias_name": alias_name,
            "alias_target_collection": alias_target,
            "legacy_collection": self.legacy_collection,
            "target_collection": target_collection,
            "payload_schema_version": payload_schema_version,
            "canonical_content_node_count": counts["canonical_nodes_with_body"],
            "qdrant_point_count": qdrant_points,
            "orphan_point_count": 0,
            "parity_sample_failures": parity_failures,
            "sync_status": "in_sync" if not parity_failures else "drift_detected",
        }


def build_law_corpus_repository() -> LawCorpusRepository:
    from app.config import (
        LAW_QDRANT_ACTIVE_ALIAS,
        LAW_QDRANT_V2_COLLECTION,
        NATIONAL_LAWS_COLLECTION,
        QDRANT_URL,
        admin_supabase,
        qdrant,
    )

    return LawCorpusRepository(
        supabase=admin_supabase,
        qdrant=qdrant,
        active_collection=LAW_QDRANT_ACTIVE_ALIAS,
        v2_collection=LAW_QDRANT_V2_COLLECTION,
        legacy_collection=NATIONAL_LAWS_COLLECTION,
        qdrant_url=QDRANT_URL,
    )
