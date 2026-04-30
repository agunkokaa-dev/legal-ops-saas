from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any


CLAUSE_MARKER_PATTERN = re.compile(
    r"(?im)^\s*(?:"
    r"(?P<pasal>pasal\s+\d+[a-z]?)|"
    r"(?P<section>section\s+\d+(?:\.\d+)*)|"
    r"(?P<article>article\s+\d+(?:\.\d+)*)|"
    r"(?P<numbered>\d+(?:\.\d+)*\s+[A-Z][^\n]{3,80})"
    r")\b"
)


def _normalize_identifier(marker: str, fallback_index: int) -> str:
    clean = re.sub(r"\s+", " ", marker.strip())
    if not clean:
        return f"Section_{fallback_index}"
    if re.match(r"^\d", clean):
        return clean.split()[0]
    parts = clean.split()
    return " ".join(parts[:2]).title()


def split_into_clauses(text: str) -> list[dict[str, Any]]:
    """Split contract text into coarse logical clauses with source offsets."""
    if not text or not text.strip():
        return []

    matches = list(CLAUSE_MARKER_PATTERN.finditer(text))
    clauses: list[dict[str, Any]] = []

    if not matches:
        stripped = text.strip()
        start = text.find(stripped)
        return [{
            "identifier": "Section_1",
            "text": stripped,
            "start_char": max(0, start),
            "end_char": max(0, start) + len(stripped),
        }] if len(stripped) >= 30 else []

    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        chunk = text[start:end].strip()
        if len(chunk) < 30:
            continue
        chunk_start = text.find(chunk, start, end)
        if chunk_start < 0:
            chunk_start = start
        clauses.append({
            "identifier": _normalize_identifier(match.group(0), len(clauses) + 1),
            "text": chunk,
            "start_char": chunk_start,
            "end_char": chunk_start + len(chunk),
        })

    return clauses


def find_changed_clauses(
    v1_text: str,
    v2_text: str,
    *,
    similarity_threshold: float = 0.95,
) -> list[dict[str, Any]]:
    """
    Identify clauses that materially changed between V1 and V2.
    Returns dicts with identifier, v1/v2 text, offsets, similarity, and change_type.
    """
    v1_clauses = split_into_clauses(v1_text)
    v2_clauses = split_into_clauses(v2_text)

    v1_by_id = {clause["identifier"]: clause for clause in v1_clauses}
    v2_by_id = {clause["identifier"]: clause for clause in v2_clauses}

    changed: list[dict[str, Any]] = []
    for clause_id in sorted(set(v1_by_id) | set(v2_by_id)):
        v1 = v1_by_id.get(clause_id)
        v2 = v2_by_id.get(clause_id)

        if v1 is None and v2 is not None:
            changed.append({
                "identifier": clause_id,
                "v1_text": "",
                "v2_text": v2["text"],
                "v1_start_char": None,
                "v1_end_char": None,
                "v2_start_char": v2["start_char"],
                "v2_end_char": v2["end_char"],
                "similarity": 0.0,
                "change_type": "added",
            })
            continue

        if v1 is not None and v2 is None:
            changed.append({
                "identifier": clause_id,
                "v1_text": v1["text"],
                "v2_text": "",
                "v1_start_char": v1["start_char"],
                "v1_end_char": v1["end_char"],
                "v2_start_char": None,
                "v2_end_char": None,
                "similarity": 0.0,
                "change_type": "removed",
            })
            continue

        if v1 is None or v2 is None:
            continue

        similarity = SequenceMatcher(None, v1["text"], v2["text"]).ratio()
        if similarity < similarity_threshold:
            changed.append({
                "identifier": clause_id,
                "v1_text": v1["text"],
                "v2_text": v2["text"],
                "v1_start_char": v1["start_char"],
                "v1_end_char": v1["end_char"],
                "v2_start_char": v2["start_char"],
                "v2_end_char": v2["end_char"],
                "similarity": round(similarity, 3),
                "change_type": "modified",
            })

    return changed


def changed_clause_payload_size(changed_clauses: list[dict[str, Any]]) -> int:
    return sum(len(item.get("v1_text") or "") + len(item.get("v2_text") or "") for item in changed_clauses)
