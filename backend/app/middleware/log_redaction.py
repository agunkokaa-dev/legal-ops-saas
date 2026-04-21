from __future__ import annotations

import hashlib
import re

PII_PATTERNS = [
    (r"\b[\w.+-]+@[\w.-]+\.\w+\b", "[EMAIL]"),
    (r"\b\+?62\d{8,13}\b", "[PHONE_ID]"),
    (r"\b\d{16}\b", "[CC_OR_ID]"),
]


def redact_pii(text: str) -> str:
    redacted = text or ""
    for pattern, replacement in PII_PATTERNS:
        redacted = re.sub(pattern, replacement, redacted)
    return redacted


def sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()

