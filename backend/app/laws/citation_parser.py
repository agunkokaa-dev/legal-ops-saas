from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


LAW_SHORT_PATTERN = re.compile(
    r"\b(?P<law_short>(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?!No\b)[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*)\b"
)
LAW_NUMBERED_PATTERN = re.compile(
    r"\b(?P<law_type>UU|PP|Perpres|Permen|POJK|Perda)\s*(?:No\.?\s*)?(?P<law_number>\d+)\s*(?:/|\s+Tahun\s+)(?P<law_year>\d{4})\b",
    re.IGNORECASE,
)
PASAL_PATTERN = re.compile(
    r"\bPasal\s+(?P<pasal>\d+[A-Za-z]?)"
    r"(?:\s+ayat\s*(?P<ayat>\(\d+[A-Za-z]?\)))?"
    r"(?:\s+huruf\s+(?P<huruf>[a-z]))?\b",
    re.IGNORECASE,
)


@dataclass(slots=True)
class ParsedCitation:
    law_short: Optional[str]
    law_type: Optional[str]
    law_number: Optional[str]
    law_year: Optional[int]
    pasal: Optional[str]
    ayat: Optional[str]
    huruf: Optional[str]
    is_complete_citation: bool
    raw_match: str


def parse_citation(text: str) -> ParsedCitation:
    query = (text or "").strip()
    if not query:
        return ParsedCitation(None, None, None, None, None, None, None, False, "")

    law_short_match = LAW_SHORT_PATTERN.search(query)
    numbered_match = LAW_NUMBERED_PATTERN.search(query)
    pasal_match = PASAL_PATTERN.search(query)

    law_short = law_short_match.group("law_short").strip().upper() if law_short_match else None
    law_type = None
    law_number = None
    law_year = None
    if numbered_match:
        law_type = numbered_match.group("law_type").upper()
        law_number = numbered_match.group("law_number")
        law_year = int(numbered_match.group("law_year"))
    elif law_short:
        law_type = law_short.split(" ", 1)[0].upper()

    pasal = None
    ayat = None
    huruf = None
    if pasal_match:
        pasal = f"Pasal {pasal_match.group('pasal')}"
        ayat_raw = pasal_match.group("ayat")
        huruf_raw = pasal_match.group("huruf")
        ayat = ayat_raw if ayat_raw else None
        huruf = huruf_raw.lower() if huruf_raw else None

    is_complete = bool(pasal and (law_short or (law_type and law_number and law_year)))
    spans = [
        match.span()
        for match in [law_short_match or numbered_match, pasal_match]
        if match is not None
    ]
    if spans:
        start = min(span[0] for span in spans)
        end = max(span[1] for span in spans)
        raw_match = query[start:end]
    else:
        raw_match = query

    return ParsedCitation(
        law_short=law_short,
        law_type=law_type,
        law_number=law_number,
        law_year=law_year,
        pasal=pasal,
        ayat=ayat,
        huruf=huruf,
        is_complete_citation=is_complete,
        raw_match=raw_match.strip(),
    )

