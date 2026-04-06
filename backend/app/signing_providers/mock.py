"""
Pariana Backend — Mock PSrE Provider

Simulates the full signing flow without calling any external API.
Use this for local development and automated testing.

Features:
  - Full signing workflow: upload → notify → sign → complete
  - e-Meterai simulation with fake serial numbers
  - In-memory state storage per process lifetime
  - simulate_signer_action() helper for testing webhooks
"""

import uuid
import json
from datetime import datetime, timezone
from app.signing_providers.base import (
    SigningProvider, SignerConfig, UploadResult, DocumentStatus,
    SignerStatus, EmeteraiResult, SignatureType
)


class MockSigningProvider(SigningProvider):
    """
    Mock provider for local testing. Simulates all PSrE flows without
    making any network calls. State is stored in-memory.
    """

    # Shared in-memory document store across all instances
    _documents: dict = {}

    async def upload_document(
        self,
        pdf_bytes: bytes,
        filename: str,
        signers: list,
        signing_order: str,
        signature_type: SignatureType,
        callback_url: str,
    ) -> UploadResult:
        doc_id = f"mock-{uuid.uuid4().hex[:12]}"

        signer_urls = {
            s.email: f"http://localhost:3000/mock-sign/{doc_id}/{s.email}"
            for s in signers
        }
        signer_ids = {
            s.email: f"mock-signer-{uuid.uuid4().hex[:8]}"
            for s in signers
        }

        self._documents[doc_id] = {
            "status": "pending_signatures",
            "filename": filename,
            "signing_order": signing_order,
            "signature_type": signature_type.value,
            "callback_url": callback_url,
            "signers": {s.email: "pending" for s in signers},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        return UploadResult(
            provider_document_id=doc_id,
            provider_document_url=f"http://localhost:3000/mock-doc/{doc_id}",
            signer_urls=signer_urls,
            signer_ids=signer_ids,
            metadata={"mock": True, "doc_id": doc_id},
        )

    async def get_document_status(self, provider_document_id: str) -> DocumentStatus:
        doc = self._documents.get(provider_document_id, {})

        signers = [
            SignerStatus(
                email=email,
                status=status,
                signed_at=datetime.now(timezone.utc).isoformat() if status == "signed" else None,
                certificate_serial=f"MOCK-CERT-{uuid.uuid4().hex[:8].upper()}" if status == "signed" else None,
                certificate_issuer="Mock PSrE Provider" if status == "signed" else None,
            )
            for email, status in doc.get("signers", {}).items()
        ]

        return DocumentStatus(
            provider_document_id=provider_document_id,
            status=doc.get("status", "unknown"),
            signers=signers,
            signed_document_url=f"http://localhost:3000/mock-signed/{provider_document_id}.pdf"
                if doc.get("status") == "completed" else None,
        )

    async def download_signed_document(self, provider_document_id: str) -> bytes:
        return b"%PDF-1.4 1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj mock-signed-document"

    async def cancel_signing(self, provider_document_id: str, reason: str) -> bool:
        if provider_document_id in self._documents:
            self._documents[provider_document_id]["status"] = "cancelled"
            self._documents[provider_document_id]["cancellation_reason"] = reason
            return True
        return False

    async def send_reminder(self, provider_document_id: str, signer_email: str) -> bool:
        return provider_document_id in self._documents

    async def affix_emeterai(self, pdf_bytes: bytes, page_number: int) -> EmeteraiResult:
        serial = f"EM-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
        return EmeteraiResult(
            serial_number=serial,
            affixed_at=datetime.now(timezone.utc).isoformat(),
            page_number=page_number,
            verification_url=f"http://localhost:3000/mock-emeterai/verify/{serial}",
        )

    def parse_webhook(self, headers: dict, body: bytes) -> dict:
        """Mock webhook parser — no HMAC verification required for testing."""
        return json.loads(body)

    async def simulate_signer_action(
        self,
        doc_id: str,
        email: str,
        action: str = "signed",
    ) -> dict:
        """
        Test helper: simulate a signer completing or rejecting.
        Returns the updated document state so callers can assert on it.

        Usage:
            mock = MockSigningProvider()
            await mock.simulate_signer_action("mock-abc123", "user@example.com", "signed")
        """
        if doc_id not in self._documents:
            return {"error": "Document not found"}

        self._documents[doc_id]["signers"][email] = action

        all_statuses = list(self._documents[doc_id]["signers"].values())
        all_signed = all(s == "signed" for s in all_statuses)
        any_signed = any(s == "signed" for s in all_statuses)

        if all_signed:
            self._documents[doc_id]["status"] = "completed"
        elif any_signed:
            self._documents[doc_id]["status"] = "partially_signed"

        return {
            "doc_id": doc_id,
            "signer_email": email,
            "action": action,
            "session_status": self._documents[doc_id]["status"],
        }
