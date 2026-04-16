import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.debate.schemas import (  # noqa: E402
    DebateRole,
    DebateSessionResponse,
    DebateTurn,
    JudgeVerdict,
)
from pydantic import ValidationError


class DebateSchemaTests(unittest.TestCase):
    def test_debate_turn_serialization(self):
        turn = DebateTurn(
            turn_number=1,
            role=DebateRole.PROSECUTOR,
            agent_name="Legal Risk Prosecutor",
            model="gpt-4o",
            argument="This clause creates non-trivial liability exposure.",
            key_points=[
                "Unlimited liability remains uncapped.",
                "Playbook deviation is material.",
                "Counterparty language weakens dispute protection.",
            ],
            confidence=0.82,
        )

        payload = turn.model_dump(mode="json")
        restored = DebateTurn.model_validate(payload)
        self.assertEqual(restored.turn_number, 1)
        self.assertEqual(restored.role, DebateRole.PROSECUTOR)

    def test_judge_verdict_validation(self):
        with self.assertRaises(ValidationError):
            JudgeVerdict(
                recommendation="reject_with_counter",
                confidence=0.81,
                reasoning="The legal obligation outweighs the business preference.",
                risk_assessment={
                    "legal_risk": "high",
                    "business_risk": "medium",
                    "compliance_risk": "critical",
                },
                suggested_action="counter",
                key_factors=[
                    {"factor": "Mandatory law", "weight": 0.7, "favors": "prosecutor"},
                    {"factor": "Commercial urgency", "weight": 0.7, "favors": "defender"},
                    {"factor": "Fallback clause", "weight": 0.2, "favors": "defender"},
                ],
            )

    def test_prosecutor_output_min_key_points(self):
        from app.debate.schemas import ProsecutorOutput

        with self.assertRaises(ValidationError):
            ProsecutorOutput(
                argument="Too short on structure.",
                key_points=["Only one", "Only two"],
                confidence=0.5,
            )

    def test_debate_session_response_format(self):
        turn = DebateTurn(
            turn_number=2,
            role=DebateRole.DEFENDER,
            agent_name="Business Value Defender",
            model="gpt-4o",
            argument="The clause can be managed with safeguards.",
            key_points=[
                "The clause is commercially standard.",
                "The customer expects this flexibility.",
                "A counter-proposal remains available.",
            ],
            confidence=0.74,
        )
        response = DebateSessionResponse(
            id="debate-123",
            contract_id="contract-123",
            deviation_id="issue-123",
            status="running",
            current_turn=2,
            turns=[turn],
            created_at=turn.timestamp,
        )

        payload = response.model_dump(mode="json")
        self.assertEqual(payload["status"], "running")
        self.assertEqual(len(payload["turns"]), 1)


if __name__ == "__main__":
    unittest.main()
