from __future__ import annotations

import html
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

LEGAL_STATUS_VALUES = {
    "berlaku",
    "diubah",
    "dicabut",
    "diuji_mk",
    "sebagian_dicabut",
}

VERIFICATION_STATUS_VALUES = {
    "unreviewed",
    "human_verified",
    "human_rejected",
}

UUID_NAMESPACE = uuid.UUID("b02a47d9-632f-46f8-aacf-8ef8900fd8f7")

QUERY_DENY_LIST = [
    "ignore previous",
    "system:",
    "assistant:",
    "\n\nHuman:",
    "{{",
    "}}",
]

LAW_CATEGORY_ALIASES = {
    "data protection": "data_protection",
    "data_protection": "data_protection",
    "privacy": "data_protection",
    "pdp": "data_protection",
    "labor": "labor",
    "employment": "labor",
    "financial services": "financial_services",
    "financial_services": "financial_services",
    "finance": "financial_services",
    "fintech": "financial_services",
    "language": "language",
    "bahasa": "language",
    "general business": "general_business",
    "general_business": "general_business",
    "corporate": "general_business",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def stable_uuid(*parts: Any) -> str:
    key = "::".join(str(part).strip() for part in parts)
    return str(uuid.uuid5(UUID_NAMESPACE, key))


def strip_html_tags(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", value or "")
    return html.unescape(cleaned).strip()


def sanitize_query_text(value: str) -> str:
    cleaned = strip_html_tags(value)
    for denied in QUERY_DENY_LIST:
        if denied.lower() in cleaned.lower():
            raise ValueError("Query contains a disallowed pattern")
    return cleaned


def normalize_identifier(value: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9]+", "_", (value or "").strip().lower()).strip("_")
    return token


def normalize_article_path(pasal: str | None, ayat: str | None = None, huruf: str | None = None) -> list[str]:
    parts: list[str] = []
    if pasal:
        pasal_digits = re.sub(r"[^0-9A-Za-z]+", "", pasal)
        parts.append(f"pasal_{pasal_digits.lower()}")
    if ayat:
        ayat_digits = re.sub(r"[^0-9A-Za-z]+", "", ayat)
        parts.append(f"ayat_{ayat_digits.lower()}")
    if huruf:
        huruf_token = re.sub(r"[^A-Za-z]+", "", huruf).lower()
        parts.append(f"huruf_{huruf_token}")
    return parts


def parse_iso_date(value: Any) -> date | None:
    if value in (None, "", "null"):
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def compute_is_currently_citable(
    *,
    legal_status: str,
    effective_from: date | str | None,
    effective_to: date | str | None,
    effective_as_of: date | None,
) -> bool:
    as_of = effective_as_of or date.today()
    start = parse_iso_date(effective_from)
    end = parse_iso_date(effective_to)
    if start and as_of < start:
        return False
    if end and as_of >= end:
        return False

    normalized_status = (legal_status or "").strip().lower()
    if normalized_status == "dicabut":
        return end is not None and as_of < end
    return normalized_status in {
        "berlaku",
        "diubah",
        "sebagian_dicabut",
        "diuji_mk",
    }


def build_status_warning(node: dict[str, Any], *, effective_as_of: date | None) -> str | None:
    status = (node.get("legal_status") or "").strip().lower()
    notes = (node.get("legal_status_notes") or "").strip()
    as_of = effective_as_of or date.today()
    effective_to = parse_iso_date(node.get("effective_to"))

    if status == "sebagian_dicabut":
        return notes or "This provision is partially revoked. Review the source note before relying on it."
    if status == "diuji_mk":
        return notes or "This provision is under Constitutional Court review. Confirm the current position before relying on it."
    if status == "dicabut":
        if effective_to and as_of < effective_to:
            return notes or "This provision was later revoked, but it was still citable on the requested historical date."
        return notes or "This provision is no longer currently citable."
    if status == "diubah":
        return notes or "This provision has been amended. Confirm whether a newer version affects your use case."
    return None


def normalize_category_hint(value: str | None) -> str | None:
    if not value:
        return None
    normalized = re.sub(r"\s+", " ", value.strip().lower())
    return LAW_CATEGORY_ALIASES.get(normalized)

