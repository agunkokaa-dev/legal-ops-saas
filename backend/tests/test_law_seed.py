from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.ingest_uu_pdp import _build_nodes


def test_ingest_seeded_nodes_are_unreviewed_by_default():
    nodes = _build_nodes(
        law_version_id="version-1",
        version_effective_from="2022-10-17",
        version_effective_to=None,
        nodes=[
            {
                "type": "pasal",
                "identifier": "Pasal 1",
                "sequence": 1,
                "body": "Test body",
            }
        ],
    )

    assert nodes[0]["seeded_by"] == "system_seed"
    assert nodes[0]["verification_status"] == "unreviewed"
    assert nodes[0]["human_verified_at"] is None
    assert nodes[0]["human_verified_by"] is None
