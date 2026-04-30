#!/usr/bin/env python3
"""
Law Ingestion CLI — clause.id
=============================
Tambah data hukum Indonesia ke corpus hukum lokal.

Usage:
  python scripts/laws/add_law.py --file uu_ite.txt --meta meta.json
  python scripts/laws/add_law.py --pdf uu_ite.pdf --meta meta.json
  python scripts/laws/add_law.py --paste --meta meta.json
  python scripts/laws/add_law.py --json scripts/laws/uu_ite_full.json
  python scripts/laws/add_law.py --discover
  python scripts/laws/add_law.py --list

Contoh cepat:
  python scripts/laws/add_law.py --file scripts/laws/examples/example_paste.txt \
      --meta scripts/laws/examples/example_meta.json --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional for dry-run only setups
    def load_dotenv(*args: Any, **kwargs: Any) -> bool:
        return False

load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / "app" / ".env", override=False)

from app.laws.utils import normalize_identifier, stable_uuid, utcnow

try:
    from app.laws.service import LAW_PAYLOAD_SCHEMA_VERSION
except Exception:  # pragma: no cover - keep script usable without full app deps
    LAW_PAYLOAD_SCHEMA_VERSION = 2

LAW_QDRANT_ACTIVE_ALIAS = "id_national_laws_active"
LAW_QDRANT_V2_COLLECTION = "id_national_laws_v2"
NATIONAL_LAWS_COLLECTION = "id_national_laws"
EMBED_MODEL = "text-embedding-3-small"
EMBED_BATCH_SIZE = 16
DEFAULT_VERSION_NUMBER = 1
DISCOVER_EXCLUDED = {"template.json"}

CATEGORIES = {
    "general": "Umum",
    "data_protection": "Perlindungan Data Pribadi",
    "technology": "Teknologi & Informasi (ITE)",
    "labor": "Ketenagakerjaan",
    "commercial": "Hukum Dagang / Perdata",
    "financial_services": "Jasa Keuangan (OJK/BI)",
    "consumer_protection": "Perlindungan Konsumen",
    "corporate": "Hukum Perusahaan / PT",
    "procurement": "Pengadaan Barang & Jasa",
    "language": "Bahasa dalam Perjanjian",
    "general_business": "Bisnis Umum / Korporasi",
}

LAW_TYPES = ["UU", "PP", "POJK", "PERMENDAG", "PERPRES", "KUH", "SEMA", "SE"]


@dataclass
class PreparedLaw:
    law: dict[str, Any]
    version: dict[str, Any]
    structure: list[dict[str, Any]]
    node_rows: list[dict[str, Any]]
    preview_nodes: list[dict[str, Any]]
    source_label: str


def _info(message: str) -> None:
    print(message)


def _warn(message: str) -> None:
    print(f"⚠️  {message}")


def _fail(message: str, *, exit_code: int = 1) -> None:
    print(f"❌ {message}", file=sys.stderr)
    raise SystemExit(exit_code)


def _require_package(module_name: str, install_hint: str):
    try:
        return __import__(module_name, fromlist=["__name__"])
    except ImportError as exc:  # pragma: no cover - depends on local env
        _fail(f"Package `{module_name}` belum tersedia. Jalankan: {install_hint}\nDetail: {exc}")


def _normalize_whitespace(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n").replace("\x0c", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _read_text_file(path: Path) -> str:
    try:
        return _normalize_whitespace(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        return _normalize_whitespace(path.read_bytes().decode("utf-8", errors="ignore"))


def _extract_text_with_pdfplumber(pdf_path: Path) -> str:
    pdfplumber = _require_package("pdfplumber", "pip install pdfplumber")
    text_parts: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
    return _normalize_whitespace("\n\n".join(text_parts))


def _extract_text_with_pymupdf(pdf_path: Path) -> str:
    fitz = _require_package("fitz", "pip install pymupdf")
    document = fitz.open(pdf_path)
    try:
        return _normalize_whitespace("\n\n".join(page.get_text() for page in document))
    finally:
        document.close()


def extract_text_from_pdf(pdf_path: Path) -> str:
    errors: list[str] = []
    for label, extractor in [
        ("pdfplumber", _extract_text_with_pdfplumber),
        ("pymupdf", _extract_text_with_pymupdf),
    ]:
        try:
            text = extractor(pdf_path)
            if text:
                _info(f"📄 PDF diextract dengan {label}")
                return text
            errors.append(f"{label}: hasil kosong")
        except SystemExit:
            raise
        except Exception as exc:  # pragma: no cover - depends on PDF parser/env
            errors.append(f"{label}: {exc}")
    _fail("Gagal extract PDF.\n" + "\n".join(f"  - {message}" for message in errors))


def read_paste_input() -> str:
    editor = os.getenv("EDITOR")
    if editor and sys.stdin.isatty() and sys.stdout.isatty():
        with tempfile.NamedTemporaryFile("w+", suffix=".txt", encoding="utf-8", delete=False) as handle:
            temp_path = Path(handle.name)
        try:
            subprocess.run([editor, str(temp_path)], check=True)
            text = temp_path.read_text(encoding="utf-8")
            if text.strip():
                return _normalize_whitespace(text)
        except Exception as exc:  # pragma: no cover - depends on local editor
            _warn(f"Gagal membuka editor `{editor}`: {exc}. Fallback ke stdin.")
        finally:
            temp_path.unlink(missing_ok=True)

    _info("Paste teks UU di bawah ini. Akhiri dengan Ctrl+D (Linux/macOS) atau Ctrl+Z lalu Enter (Windows).")
    return _normalize_whitespace(sys.stdin.read())


def normalize_meta(meta: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(meta)
    normalized["short_name"] = str(normalized.get("short_name", "")).strip().upper()
    normalized["full_name"] = str(normalized.get("full_name", "")).strip()
    normalized["law_type"] = str(normalized.get("law_type", "")).strip().upper()
    normalized["number"] = str(normalized.get("number", "")).strip()
    year_value = normalized.get("year")
    if year_value not in (None, ""):
        try:
            normalized["year"] = int(year_value)
        except (TypeError, ValueError):
            _fail(f"Field `year` harus angka 4 digit. Nilai sekarang: {year_value!r}")
    normalized["category"] = str(normalized.get("category", "")).strip()
    normalized["jurisdiction"] = str(normalized.get("jurisdiction") or "Indonesia").strip()

    for key in ("effective_date", "promulgation_date"):
        if normalized.get(key):
            normalized[key] = str(normalized[key]).strip()
            date.fromisoformat(normalized[key])

    if normalized["law_type"] not in LAW_TYPES:
        allowed = ", ".join(LAW_TYPES)
        _fail(f"law_type `{normalized['law_type']}` tidak dikenal. Gunakan salah satu: {allowed}")

    if normalized["category"] not in CATEGORIES:
        allowed = ", ".join(sorted(CATEGORIES))
        _warn(f"category `{normalized['category']}` tidak ada di daftar default. Tetap dilanjutkan. Rekomendasi: {allowed}")

    return normalized


def validate_meta(meta: dict[str, Any]) -> None:
    required = ["short_name", "full_name", "law_type", "number", "year", "category"]
    missing = [field for field in required if not meta.get(field)]
    if missing:
        _fail(f"Field metadata yang kurang: {', '.join(missing)}")


def _default_effective_from(meta: dict[str, Any], version_data: dict[str, Any] | None = None) -> str:
    if version_data and version_data.get("effective_from"):
        return str(version_data["effective_from"])
    if meta.get("effective_date"):
        return str(meta["effective_date"])
    if meta.get("promulgation_date"):
        return str(meta["promulgation_date"])
    fallback = f"{int(meta['year']):04d}-01-01"
    _warn(f"`effective_date` tidak diisi. `effective_from` versi akan memakai fallback {fallback}.")
    return fallback


def _build_law_row(meta: dict[str, Any]) -> dict[str, Any]:
    law_id = stable_uuid("law", meta["law_type"], meta["number"], meta["year"])
    now = utcnow().isoformat()
    return {
        "id": law_id,
        "short_name": meta["short_name"],
        "full_name": meta["full_name"],
        "law_type": meta["law_type"],
        "number": meta["number"],
        "year": meta["year"],
        "category": meta["category"],
        "jurisdiction": meta.get("jurisdiction", "Indonesia"),
        "promulgation_date": meta.get("promulgation_date") or meta.get("effective_date"),
        "effective_date": meta.get("effective_date"),
        "legal_status": meta.get("legal_status", "berlaku"),
        "official_source_url": meta.get("official_source_url"),
        "updated_at": now,
    }


def _build_version_row(meta: dict[str, Any], law_row: dict[str, Any], version_data: dict[str, Any] | None = None) -> dict[str, Any]:
    version_data = version_data or {}
    version_number = int(version_data.get("version_number") or DEFAULT_VERSION_NUMBER)
    return {
        "id": stable_uuid("law-version", law_row["id"], version_number),
        "law_id": law_row["id"],
        "version_number": version_number,
        "effective_from": _default_effective_from(meta, version_data),
        "effective_to": version_data.get("effective_to"),
        "amendment_notes": version_data.get("amendment_notes") or "Seeded from scripts/laws/add_law.py",
    }


def _find_bab_headers(raw_text: str) -> list[dict[str, Any]]:
    pattern = re.compile(r"(?im)^BAB\s+([IVXLCDM]+)(?:\s*[-.:]?\s*(.*))?$")
    matches = list(pattern.finditer(raw_text))
    headers: list[dict[str, Any]] = []
    for index, match in enumerate(matches):
        title = (match.group(2) or "").strip()
        if not title:
            window_end = matches[index + 1].start() if index + 1 < len(matches) else min(len(raw_text), match.end() + 400)
            window = raw_text[match.end() : window_end]
            for line in window.splitlines():
                candidate = line.strip()
                if not candidate:
                    continue
                if re.match(r"^(Pasal|BAB|Bagian|Paragraf)\b", candidate, re.IGNORECASE):
                    break
                title = candidate
                break
        headers.append(
            {
                "start": match.start(),
                "identifier": f"Bab {match.group(1).upper()}",
                "heading": title or None,
            }
        )
    return headers


def _current_bab_for_position(position: int, bab_headers: list[dict[str, Any]]) -> dict[str, Any] | None:
    current = None
    for header in bab_headers:
        if header["start"] <= position:
            current = header
        else:
            break
    return current


def parse_text_to_structure(raw_text: str) -> list[dict[str, Any]]:
    text = _normalize_whitespace(raw_text)
    bab_headers = _find_bab_headers(text)
    pasal_matches = list(re.finditer(r"(?im)^Pasal\s+(\d+[A-Z]?)\b", text))

    if not pasal_matches:
        return []

    structure: list[dict[str, Any]] = []
    bab_nodes: dict[str, dict[str, Any]] = {}

    for index, match in enumerate(pasal_matches):
        start = match.start()
        end = pasal_matches[index + 1].start() if index + 1 < len(pasal_matches) else len(text)
        chunk = text[start:end].strip()
        if not chunk:
            continue

        pasal_identifier = f"Pasal {match.group(1)}"
        bab = _current_bab_for_position(start, bab_headers)
        pasal_node = {
            "type": "pasal",
            "identifier": pasal_identifier,
            "body": chunk,
            "legal_status": "berlaku",
            "contract_relevance": "medium",
            "contract_types": [],
            "topic_tags": [],
            "extraction_method": "rule_based",
            "extraction_confidence": 0.85,
            "verification_status": "unreviewed",
            "source_document_position": {"char_start": start, "char_end": end},
        }

        if not bab:
            pasal_node["sequence"] = len(structure) + 1
            structure.append(pasal_node)
            continue

        key = bab["identifier"]
        if key not in bab_nodes:
            bab_node = {
                "type": "bab",
                "identifier": bab["identifier"],
                "heading": bab.get("heading"),
                "sequence": len(structure) + 1,
                "children": [],
            }
            bab_nodes[key] = bab_node
            structure.append(bab_node)

        parent = bab_nodes[key]
        pasal_node["sequence"] = len(parent["children"]) + 1
        parent["children"].append(pasal_node)

    return structure


def _build_node_rows(
    *,
    law_version_id: str,
    version_effective_from: str,
    version_effective_to: str | None,
    nodes: list[dict[str, Any]],
    parent_id: str | None = None,
    path_tokens: list[str] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    current_path = list(path_tokens or [])
    now = utcnow().isoformat()

    for item in nodes:
        identifier = str(item.get("identifier") or item.get("heading") or f"{item.get('type', 'node')}_{item.get('sequence', 0)}")
        identifier_normalized = normalize_identifier(item.get("identifier_normalized") or identifier)
        node_path = [*current_path, identifier_normalized]
        node_id = stable_uuid("structural-node", law_version_id, *node_path)

        row = {
            "id": node_id,
            "law_version_id": law_version_id,
            "node_type": item.get("type", "pasal"),
            "parent_id": parent_id,
            "identifier": identifier,
            "identifier_normalized": identifier_normalized,
            "sequence_order": int(item.get("sequence") or len(rows) + 1),
            "heading": item.get("heading"),
            "body": item.get("body"),
            "body_en": item.get("body_en"),
            "legal_status": item.get("legal_status", "berlaku"),
            "legal_status_notes": item.get("legal_status_notes"),
            "legal_status_source_url": item.get("legal_status_source_url"),
            "effective_from": item.get("effective_from") or version_effective_from,
            "effective_to": item.get("effective_to") or version_effective_to,
            "topic_tags": item.get("topic_tags", []),
            "contract_relevance": item.get("contract_relevance", "medium"),
            "contract_types": item.get("contract_types", []),
            "compliance_trigger": item.get("compliance_trigger"),
            "source_document_position": item.get("source_document_position"),
            "extraction_method": item.get("extraction_method", "rule_based"),
            "extraction_confidence": item.get("extraction_confidence", 0.85),
            "seeded_at": now,
            "seeded_by": "scripts/laws/add_law.py",
            "verification_status": item.get("verification_status", "unreviewed"),
            "human_verified_by": item.get("human_verified_by"),
            "human_verified_at": item.get("human_verified_at"),
            "verification_notes": item.get("verification_notes"),
            "updated_at": now,
        }
        rows.append(row)

        children = item.get("children") or []
        if children:
            rows.extend(
                _build_node_rows(
                    law_version_id=law_version_id,
                    version_effective_from=version_effective_from,
                    version_effective_to=version_effective_to,
                    nodes=children,
                    parent_id=node_id,
                    path_tokens=node_path,
                )
            )

    return rows


def _get_parent_chain(row: dict[str, Any], rows_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[str] = set()
    while current.get("parent_id"):
        parent_id = str(current["parent_id"])
        if parent_id in seen:
            break
        parent = rows_by_id.get(parent_id)
        if not parent:
            break
        seen.add(parent_id)
        chain.append(parent)
        current = parent
    chain.reverse()
    return chain


def _build_preview_nodes(node_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows_by_id = {str(row["id"]): row for row in node_rows}
    previews: list[dict[str, Any]] = []
    for row in node_rows:
        if not row.get("body"):
            continue
        hierarchy = _get_parent_chain(row, rows_by_id) + [row]
        identifier_full = " ".join(
            str(item.get("identifier") or item.get("heading") or "").strip()
            for item in hierarchy
            if item.get("identifier") or item.get("heading")
        ).strip()
        previews.append(
            {
                "identifier": row["identifier"],
                "identifier_full": identifier_full or row["identifier"],
                "body": row["body"],
                "bab": next((item.get("heading") for item in hierarchy if item.get("node_type") == "bab"), None),
                "node_id": str(row["id"]),
            }
        )
    return previews


def prepare_from_raw_text(meta: dict[str, Any], raw_text: str, *, source_label: str) -> PreparedLaw:
    structure = parse_text_to_structure(raw_text)
    if not structure:
        _fail("Tidak ada pasal yang berhasil di-parse. Pastikan teks mengandung penanda `Pasal N`.")

    law_row = _build_law_row(meta)
    version_row = _build_version_row(meta, law_row)
    node_rows = _build_node_rows(
        law_version_id=version_row["id"],
        version_effective_from=version_row["effective_from"],
        version_effective_to=version_row.get("effective_to"),
        nodes=structure,
    )
    preview_nodes = _build_preview_nodes(node_rows)
    return PreparedLaw(
        law=law_row,
        version=version_row,
        structure=structure,
        node_rows=node_rows,
        preview_nodes=preview_nodes,
        source_label=source_label,
    )


def prepare_from_canonical_json(payload: dict[str, Any], *, source_label: str) -> PreparedLaw:
    if not payload.get("law") or not payload.get("structure"):
        _fail("JSON canonical harus memiliki key `law` dan `structure`.")

    meta = normalize_meta(payload["law"])
    validate_meta(meta)
    law_row = _build_law_row(meta)
    version_row = _build_version_row(meta, law_row, payload.get("version"))
    structure = payload["structure"]
    node_rows = _build_node_rows(
        law_version_id=version_row["id"],
        version_effective_from=version_row["effective_from"],
        version_effective_to=version_row.get("effective_to"),
        nodes=structure,
    )
    preview_nodes = _build_preview_nodes(node_rows)
    return PreparedLaw(
        law=law_row,
        version=version_row,
        structure=structure,
        node_rows=node_rows,
        preview_nodes=preview_nodes,
        source_label=source_label,
    )


def prepare_from_json_file(json_path: Path) -> PreparedLaw:
    with json_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if payload.get("law") and payload.get("structure"):
        return prepare_from_canonical_json(payload, source_label=json_path.name)

    if payload.get("meta") and payload.get("raw_text"):
        meta = normalize_meta(payload["meta"])
        validate_meta(meta)
        return prepare_from_raw_text(meta, str(payload.get("raw_text") or ""), source_label=json_path.name)

    meta = normalize_meta({key: value for key, value in payload.items() if key != "raw_text"})
    validate_meta(meta)
    raw_text = str(payload.get("raw_text") or "")
    if not raw_text.strip():
        _fail(f"File JSON `{json_path}` tidak punya `raw_text`.")
    return prepare_from_raw_text(meta, raw_text, source_label=json_path.name)


def discover_json_files(directory: Path) -> list[Path]:
    files = [
        path
        for path in sorted(directory.glob("*.json"))
        if path.is_file() and path.name not in DISCOVER_EXCLUDED
    ]
    if not files:
        _fail(f"Tidak ada file JSON siap ingest di {directory}")
    return files


def build_openai_client():
    openai = _require_package("openai", "pip install -r requirements.txt")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        _fail("OPENAI_API_KEY tidak ditemukan di environment.")
    return openai.OpenAI(api_key=api_key)


def _build_qdrant_base_url() -> str:
    qdrant_url = os.getenv("QDRANT_URL")
    if qdrant_url:
        return qdrant_url.rstrip("/")
    qdrant_host = "qdrant" if os.getenv("RUNNING_IN_DOCKER") else "localhost"
    qdrant_port = os.getenv("QDRANT_PORT", "6333")
    return f"http://{qdrant_host}:{qdrant_port}"


def build_qdrant_client():
    qdrant_client = _require_package("qdrant_client", "pip install -r requirements.txt")
    qdrant_url = os.getenv("QDRANT_URL")
    if qdrant_url:
        return qdrant_client.QdrantClient(url=qdrant_url)
    qdrant_host = "qdrant" if os.getenv("RUNNING_IN_DOCKER") else "localhost"
    qdrant_port = int(os.getenv("QDRANT_PORT", "6333"))
    return qdrant_client.QdrantClient(host=qdrant_host, port=qdrant_port)


def _qdrant_http_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url=f"{_build_qdrant_base_url()}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # pragma: no cover - depends on local qdrant
        return json.loads(response.read().decode("utf-8"))


def get_alias_target(client: Any, alias_name: str) -> str | None:
    getter = getattr(client, "get_aliases", None)
    if not callable(getter):
        return None
    try:
        response = getter()
    except Exception:
        return None

    aliases = getattr(response, "aliases", None)
    if aliases is None and isinstance(response, dict):
        aliases = response.get("aliases", [])

    for alias in aliases or []:
        alias_name_value = getattr(alias, "alias_name", None) or alias.get("alias_name")
        collection_name = getattr(alias, "collection_name", None) or alias.get("collection_name")
        if alias_name_value == alias_name:
            return collection_name
    return None


def ensure_v2_collection(client: Any, collection_name: str) -> None:
    http_models = _require_package("qdrant_client.http.models", "pip install -r requirements.txt")

    existing = {collection.name for collection in client.get_collections().collections}
    if collection_name in existing:
        return

    client.create_collection(
        collection_name=collection_name,
        vectors_config=http_models.VectorParams(size=1536, distance=http_models.Distance.COSINE),
    )
    for field_name, field_schema in [
        ("schema_version", http_models.PayloadSchemaType.INTEGER),
        ("law_short", http_models.PayloadSchemaType.KEYWORD),
        ("category", http_models.PayloadSchemaType.KEYWORD),
        ("legal_status", http_models.PayloadSchemaType.KEYWORD),
        ("verification_status", http_models.PayloadSchemaType.KEYWORD),
        ("contract_relevance", http_models.PayloadSchemaType.KEYWORD),
        ("structural_node_id", http_models.PayloadSchemaType.KEYWORD),
    ]:
        client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=field_schema,
        )


def ensure_active_alias(client: Any, target_collection: str) -> None:
    if get_alias_target(client, LAW_QDRANT_ACTIVE_ALIAS):
        return
    payload = {
        "actions": [
            {
                "create_alias": {
                    "collection_name": target_collection,
                    "alias_name": LAW_QDRANT_ACTIVE_ALIAS,
                }
            }
        ]
    }
    try:
        _qdrant_http_request("POST", "/collections/aliases", payload)
    except Exception as exc:  # pragma: no cover - depends on local qdrant
        _warn(f"Gagal membuat alias `{LAW_QDRANT_ACTIVE_ALIAS}` → `{target_collection}`: {exc}")


def resolve_v2_collection(client: Any) -> str:
    alias_target = get_alias_target(client, LAW_QDRANT_ACTIVE_ALIAS)
    if alias_target:
        return alias_target
    ensure_v2_collection(client, LAW_QDRANT_V2_COLLECTION)
    ensure_active_alias(client, LAW_QDRANT_V2_COLLECTION)
    return get_alias_target(client, LAW_QDRANT_ACTIVE_ALIAS) or LAW_QDRANT_V2_COLLECTION


def build_admin_supabase():
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        return None
    supabase = _require_package("supabase", "pip install -r requirements.txt")
    return supabase.create_client(url, service_key)


def build_identifier_full(row: dict[str, Any], rows_by_id: dict[str, dict[str, Any]]) -> str:
    hierarchy = _get_parent_chain(row, rows_by_id) + [row]
    return " ".join(
        str(item.get("identifier") or item.get("heading") or "").strip()
        for item in hierarchy
        if item.get("identifier") or item.get("heading")
    ).strip()


def build_v2_payload(
    row: dict[str, Any],
    *,
    law_row: dict[str, Any],
    version_row: dict[str, Any],
    rows_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    hierarchy = _get_parent_chain(row, rows_by_id) + [row]
    bab_heading = next((item.get("heading") for item in hierarchy if item.get("node_type") == "bab"), None)
    return {
        "schema_version": LAW_PAYLOAD_SCHEMA_VERSION,
        "structural_node_id": str(row["id"]),
        "law_id": str(law_row["id"]),
        "law_version_id": str(version_row["id"]),
        "law_short": law_row["short_name"],
        "law_type": law_row["law_type"],
        "category": law_row["category"],
        "identifier": row["identifier"],
        "identifier_full": build_identifier_full(row, rows_by_id) or row["identifier"],
        "bab": bab_heading,
        "body": row.get("body"),
        "legal_status": row.get("legal_status"),
        "effective_from": str(row.get("effective_from") or version_row.get("effective_from")),
        "effective_to": str(row.get("effective_to")) if row.get("effective_to") else None,
        "contract_relevance": row.get("contract_relevance"),
        "contract_types": row.get("contract_types") or [],
        "topic_tags": row.get("topic_tags") or [],
        "extraction_method": row.get("extraction_method"),
        "verification_status": row.get("verification_status"),
        "human_verified_at": str(row.get("human_verified_at")) if row.get("human_verified_at") else None,
    }


def build_legacy_payload(
    row: dict[str, Any],
    *,
    law_row: dict[str, Any],
    version_row: dict[str, Any],
    rows_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    hierarchy = _get_parent_chain(row, rows_by_id) + [row]
    bab_node = next((item for item in hierarchy if item.get("node_type") == "bab"), None)
    pasal_value = str(row["identifier"]).replace("Pasal ", "")
    legal_status = str(row.get("legal_status") or law_row.get("legal_status") or "").strip().lower()
    return {
        "source_law": law_row["full_name"],
        "source_law_short": law_row["short_name"],
        "category": law_row["category"],
        "bab": bab_node.get("identifier") if bab_node else None,
        "bab_title": bab_node.get("heading") if bab_node else None,
        "pasal": pasal_value,
        "text": row.get("body"),
        "effective_date": version_row.get("effective_from"),
        "is_active": legal_status != "dicabut",
    }


def embed_contexts(openai_client: Any, contexts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(contexts), EMBED_BATCH_SIZE):
        batch = contexts[start : start + EMBED_BATCH_SIZE]
        response = openai_client.embeddings.create(
            model=EMBED_MODEL,
            input=[text[:8000] for text in batch],
        )
        data = sorted(response.data, key=lambda item: item.index)
        vectors.extend(item.embedding for item in data)
        end = start + len(batch)
        _info(f"  📡 Embedded {end}/{len(contexts)} nodes")
    return vectors


def upsert_supabase(prepared: PreparedLaw) -> tuple[bool, str]:
    try:
        client = build_admin_supabase()
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - depends on local env
        return False, f"Supabase client gagal dibuat: {exc}"

    if client is None:
        return False, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak tersedia. Lewati update Supabase."

    try:
        client.table("laws").upsert(prepared.law).execute()
        client.table("law_versions").upsert(prepared.version).execute()
        client.table("structural_nodes").upsert(prepared.node_rows).execute()
        return True, f"{len(prepared.node_rows)} rows canonical di-upsert"
    except Exception as exc:  # pragma: no cover - depends on network/env
        return False, str(exc)


def upsert_qdrant(prepared: PreparedLaw) -> tuple[list[str], str]:
    client = build_qdrant_client()
    openai_client = build_openai_client()
    http_models = _require_package("qdrant_client.http.models", "pip install -r requirements.txt")

    target_collection = resolve_v2_collection(client)
    ensure_v2_collection(client, target_collection)
    ensure_v2_collection(client, LAW_QDRANT_V2_COLLECTION)

    rows_by_id = {str(row["id"]): row for row in prepared.node_rows}
    content_rows = [row for row in prepared.node_rows if row.get("body")]
    if not content_rows:
        _fail("Tidak ada node ber-body untuk di-embed.")

    v2_payloads = [
        build_v2_payload(
            row,
            law_row=prepared.law,
            version_row=prepared.version,
            rows_by_id=rows_by_id,
        )
        for row in content_rows
    ]
    contexts = [
        " ".join(filter(None, [payload.get("bab"), payload.get("identifier_full"), payload.get("body")]))
        for payload in v2_payloads
    ]
    vectors = embed_contexts(openai_client, contexts)

    legacy_payloads = [
        build_legacy_payload(
            row,
            law_row=prepared.law,
            version_row=prepared.version,
            rows_by_id=rows_by_id,
        )
        for row in content_rows
    ]

    existing_collections = {collection.name for collection in client.get_collections().collections}
    write_targets: dict[str, str] = {}

    if target_collection == NATIONAL_LAWS_COLLECTION:
        write_targets[NATIONAL_LAWS_COLLECTION] = "hybrid"
        write_targets[LAW_QDRANT_V2_COLLECTION] = "v2"
    else:
        write_targets[target_collection] = "v2"
        write_targets[LAW_QDRANT_V2_COLLECTION] = "v2"
        if NATIONAL_LAWS_COLLECTION in existing_collections:
            write_targets[NATIONAL_LAWS_COLLECTION] = "legacy"

    written_collections: list[str] = []
    for collection_name, payload_mode in write_targets.items():
        points = []
        for row, v2_payload, legacy_payload, vector in zip(content_rows, v2_payloads, legacy_payloads, vectors, strict=True):
            if payload_mode == "legacy":
                point_id = stable_uuid("legacy-qdrant-point", row["id"])
                payload = legacy_payload
            elif payload_mode == "hybrid":
                point_id = stable_uuid("legacy-qdrant-point", row["id"])
                payload = {**legacy_payload, **v2_payload}
            else:
                point_id = stable_uuid("qdrant-point", row["id"])
                payload = v2_payload

            points.append(
                http_models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=payload,
                )
            )
        client.upsert(collection_name=collection_name, points=points)
        written_collections.append(collection_name)

    return written_collections, f"{len(content_rows)} vector di-upsert"


def list_ingested_laws() -> int:
    try:
        client = build_qdrant_client()
    except SystemExit:
        raise
    except Exception as exc:
        _fail(str(exc))

    try:
        existing = {collection.name for collection in client.get_collections().collections}
        alias_target = get_alias_target(client, LAW_QDRANT_ACTIVE_ALIAS)
        collections_to_report = [LAW_QDRANT_V2_COLLECTION, NATIONAL_LAWS_COLLECTION]
        if alias_target:
            collections_to_report.insert(0, f"{LAW_QDRANT_ACTIVE_ALIAS} -> {alias_target}")

        _info("📚 Collection status:")
        for name in collections_to_report:
            collection_name = name.split(" -> ", 1)[1] if " -> " in name else name
            if collection_name not in existing:
                print(f"  - {name}: belum ada")
                continue
            info = client.get_collection(collection_name)
            points_count = getattr(info, "points_count", 0) or 0
            print(f"  - {name}: {points_count} vectors")

        aggregate_collection = alias_target or (LAW_QDRANT_V2_COLLECTION if LAW_QDRANT_V2_COLLECTION in existing else NATIONAL_LAWS_COLLECTION)
        if aggregate_collection not in existing:
            return 0

        offset = None
        per_law: dict[str, int] = {}
        while True:
            scroll_kwargs = {
                "collection_name": aggregate_collection,
                "limit": 128,
                "with_payload": True,
                "with_vectors": False,
            }
            if offset is not None:
                scroll_kwargs["offset"] = offset
            points, next_offset = client.scroll(**scroll_kwargs)
            for point in points:
                payload = getattr(point, "payload", {}) or {}
                law_short = payload.get("law_short") or payload.get("source_law_short") or "UNKNOWN"
                per_law[law_short] = per_law.get(law_short, 0) + 1
            if next_offset is None:
                break
            offset = next_offset

        if per_law:
            _info("\n📖 Ringkasan per law:")
            for law_short, count in sorted(per_law.items()):
                print(f"  - {law_short}: {count} nodes")
        return 0
    except Exception as exc:  # pragma: no cover - depends on running qdrant
        _fail(f"Gagal membaca Qdrant: {exc}")


def print_preview(prepared: PreparedLaw) -> None:
    preview_nodes = prepared.preview_nodes
    _info(f"\n🔍 Parsing `{prepared.law['short_name']}` dari {prepared.source_label}")
    _info(f"✅ Terdeteksi {len(preview_nodes)} node ber-body / pasal")
    for node in preview_nodes[:5]:
        snippet = " ".join(str(node["body"]).split())[:90]
        print(f"  - {node['identifier_full']}: {snippet}...")
    if len(preview_nodes) > 5:
        print(f"  - ... dan {len(preview_nodes) - 5} node lainnya")


def process_prepared_law(prepared: PreparedLaw, *, dry_run: bool) -> dict[str, Any]:
    print_preview(prepared)
    if dry_run:
        _info("\n🧪 DRY RUN — tidak ada data yang di-ingest")
        return {
            "short_name": prepared.law["short_name"],
            "law_id": prepared.law["id"],
            "nodes_ingested": len(prepared.preview_nodes),
            "qdrant_collections": [],
            "supabase_written": False,
        }

    _info(f"\n🚀 Ingesting `{prepared.law['short_name']}` ...")
    supabase_written, supabase_message = upsert_supabase(prepared)
    if supabase_written:
        _info(f"  ✅ Supabase: {supabase_message}")
    else:
        _warn(f"Supabase: {supabase_message}")

    qdrant_collections, qdrant_message = upsert_qdrant(prepared)
    _info(f"  ✅ Qdrant: {qdrant_message} → {', '.join(qdrant_collections)}")

    return {
        "short_name": prepared.law["short_name"],
        "law_id": prepared.law["id"],
        "nodes_ingested": len(prepared.preview_nodes),
        "qdrant_collections": qdrant_collections,
        "supabase_written": supabase_written,
    }


def prepare_single_input(args: argparse.Namespace) -> PreparedLaw:
    if args.json:
        return prepare_from_json_file(args.json)

    if not args.meta:
        _fail("--meta diperlukan kecuali pada mode --json / --discover / --list")

    with args.meta.open("r", encoding="utf-8") as handle:
        meta = normalize_meta(json.load(handle))
    validate_meta(meta)

    if args.file:
        raw_text = _read_text_file(args.file)
        source_label = args.file.name
    elif args.pdf:
        raw_text = extract_text_from_pdf(args.pdf)
        source_label = args.pdf.name
    elif args.paste:
        raw_text = read_paste_input()
        source_label = "stdin/editor"
    else:
        _fail("Pilih salah satu: --file, --pdf, --paste, --json, --discover, atau --list")

    if not raw_text.strip():
        _fail("Teks hukum kosong.")
    return prepare_from_raw_text(meta, raw_text, source_label=source_label)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="clause.id — Law Ingestion CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument("--file", type=Path, help="TXT / MD file dengan teks UU")
    parser.add_argument("--pdf", type=Path, help="PDF file UU")
    parser.add_argument("--json", type=Path, help="JSON lengkap: flat template atau canonical JSON")
    parser.add_argument("--paste", action="store_true", help="Paste teks langsung / buka $EDITOR")
    parser.add_argument("--meta", type=Path, help="JSON metadata saat memakai --file / --pdf / --paste")
    parser.add_argument(
        "--discover",
        nargs="?",
        type=Path,
        const=SCRIPT_DIR,
        help="Ingest semua JSON siap pakai di folder. Default: scripts/laws/",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview parsing tanpa ingest")
    parser.add_argument("--list", action="store_true", help="List law yang sudah ada di Qdrant")

    args = parser.parse_args()

    active_modes = [
        bool(args.file),
        bool(args.pdf),
        bool(args.json),
        bool(args.paste),
        bool(args.discover),
        bool(args.list),
    ]
    if sum(active_modes) > 1:
        _fail("Gunakan hanya satu mode input pada satu waktu.")

    if not any(active_modes):
        parser.print_help()
        raise SystemExit(1)

    return args


def main() -> int:
    args = parse_args()

    if args.list:
        return list_ingested_laws()

    if args.discover:
        results: list[dict[str, Any]] = []
        for json_path in discover_json_files(args.discover):
            _info(f"\n📂 Processing {json_path}")
            prepared = prepare_from_json_file(json_path)
            results.append(process_prepared_law(prepared, dry_run=args.dry_run))
    else:
        prepared = prepare_single_input(args)
        results = [process_prepared_law(prepared, dry_run=args.dry_run)]

    _info("\n✅ SELESAI")
    for result in results:
        collections = ", ".join(result["qdrant_collections"]) if result["qdrant_collections"] else "-"
        print(
            f"  - {result['short_name']}: law_id={result['law_id']} | "
            f"nodes={result['nodes_ingested']} | qdrant={collections}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
