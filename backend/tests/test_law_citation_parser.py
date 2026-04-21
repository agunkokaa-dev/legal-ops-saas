from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.laws.citation_parser import parse_citation


def _resolve_fixture_path() -> Path:
    current = Path(__file__).resolve()
    candidates = (
        current.parents[1] / "testdata" / "law_citation_cases.json",
        current.parents[2] / "testdata" / "law_citation_cases.json",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


FIXTURE_PATH = _resolve_fixture_path()


def test_shared_citation_fixture_backend_parser():
    cases = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for case in cases:
        parsed = parse_citation(case["text"])
        assert parsed.is_complete_citation is case["expect_complete"]
        assert parsed.law_short == case["law_short"]
        assert parsed.law_type == case["law_type"]
        assert parsed.law_number == case["law_number"]
        assert parsed.law_year == case["law_year"]
        assert parsed.pasal == case["pasal"]
        assert parsed.ayat == case["ayat"]
        assert parsed.huruf == case["huruf"]
