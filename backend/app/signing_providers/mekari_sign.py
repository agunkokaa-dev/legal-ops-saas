"""
Pariana Backend — Mekari Sign PSrE Provider

Mekari Sign is an official PSrE (Penyelenggara Sertifikasi Elektronik) certified
by Komdigi RI. It bundles:
  - Certified Digital Signatures (PSrE-certified, QES)
  - e-Meterai via Peruri
  - Identity Verification (e-KYC / liveness check)

API Docs:   https://mekarisign.com/en/features/esignature-api/
Sandbox:    https://sandbox-api.mekarisign.com/v2
Production: https://api.mekarisign.com/v2

Set env vars:
  MEKARI_SIGN_API_KEY
  MEKARI_SIGN_API_SECRET
  MEKARI_SIGN_WEBHOOK_SECRET
  MEKARI_SIGN_API_BASE  (optional, defaults to sandbox)
"""

import hmac
import hashlib
import json
import logging

import httpx

from app.signing_providers.base import (
    SigningProvider, SignerConfig, UploadResult, DocumentStatus,
    SignerStatus, EmeteraiResult, SignatureType
)

logger = logging.getLogger("pariana.mekari_sign")

MEKARI_SIGN_SANDBOX_BASE = "https://sandbox-api.mekarisign.com/v2"
MEKARI_SIGN_PROD_BASE    = "https://api.mekarisign.com/v2"


class MekariSignProvider(SigningProvider):
    """
    Mekari Sign integration implementing the SigningProvider interface.

    All methods raise httpx.HTTPStatusError on provider API errors,
    which the signing router converts to appropriate HTTP 502 responses.
    """

    def __init__(self, api_key: str, api_secret: str, webhook_secret: str, api_base: str = None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.webhook_secret = webhook_secret
        self.api_base = api_base or MEKARI_SIGN_SANDBOX_BASE

        self.client = httpx.AsyncClient(
            base_url=self.api_base,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=30.0,
        )

    async def upload_document(
        self,
        pdf_bytes: bytes,
        filename: str,
        signers: list,
        signing_order: str,
        signature_type: SignatureType,
        callback_url: str,
    ) -> UploadResult:
        """
        1. Upload PDF to Mekari Sign
        2. Configure each signer with their position and role
        3. Trigger sending (notifies signers via email)
        4. Return signing URLs per signer
        """
        # Step 1: Upload document
        upload_response = await self.client.post(
            "/documents",
            content=None,
            # multipart/form-data — override Content-Type header for this request
            files={"file": (filename, pdf_bytes, "application/pdf")},
            data={
                "signing_order": signing_order,
                "signature_type": signature_type.value,
                "callback_url": callback_url,
                "expiry_days": "7",
            },
            headers={"Content-Type": None},  # Let httpx set multipart boundary
        )
        upload_response.raise_for_status()
        doc_data = upload_response.json()
        document_id = doc_data["document_id"]

        logger.info("MekariSign | document uploaded | doc_id=%s | filename=%s", document_id, filename)

        # Step 2: Add signers
        signer_urls = {}
        signer_ids = {}

        for signer in signers:
            signer_payload = {
                "name": signer.full_name,
                "email": signer.email,
                "role": signer.role,
                "order": signer.signing_order_index,
                "signature_position": {
                    "page": signer.signing_page if signer.signing_page is not None else -1,
                    "x": signer.signing_position_x if signer.signing_position_x is not None else 0.3,
                    "y": signer.signing_position_y if signer.signing_position_y is not None else 0.8,
                },
            }
            if signer.phone:
                signer_payload["phone"] = signer.phone
            if signer.privy_id:
                signer_payload["privy_id"] = signer.privy_id
            if signer.organization:
                signer_payload["organization"] = signer.organization

            signer_response = await self.client.post(
                f"/documents/{document_id}/signers",
                json=signer_payload,
            )
            signer_response.raise_for_status()
            signer_data = signer_response.json()

            signer_urls[signer.email] = signer_data.get("signing_url", "")
            signer_ids[signer.email] = signer_data.get("signer_id", "")

            logger.info(
                "MekariSign | signer added | doc_id=%s | email=%s | signer_id=%s",
                document_id, signer.email, signer_ids[signer.email],
            )

        # Step 3: Send for signing (triggers email notifications)
        send_response = await self.client.post(f"/documents/{document_id}/send")
        send_response.raise_for_status()

        logger.info("MekariSign | document sent for signing | doc_id=%s", document_id)

        return UploadResult(
            provider_document_id=document_id,
            provider_document_url=doc_data.get("document_url", ""),
            signer_urls=signer_urls,
            signer_ids=signer_ids,
            metadata=doc_data,
        )

    async def get_document_status(self, provider_document_id: str) -> DocumentStatus:
        response = await self.client.get(f"/documents/{provider_document_id}")
        response.raise_for_status()
        data = response.json()

        signers = [
            SignerStatus(
                email=s["email"],
                status=s.get("status", "pending"),
                signed_at=s.get("signed_at"),
                certificate_serial=s.get("certificate_serial"),
                certificate_issuer=s.get("certificate_issuer"),
                signature_hash=s.get("signature_hash"),
            )
            for s in data.get("signers", [])
        ]

        return DocumentStatus(
            provider_document_id=provider_document_id,
            status=data.get("status", "pending"),
            signers=signers,
            signed_document_url=data.get("signed_document_url"),
            emeterai_serial=data.get("emeterai_serial"),
        )

    async def download_signed_document(self, provider_document_id: str) -> bytes:
        response = await self.client.get(
            f"/documents/{provider_document_id}/download",
            headers={"Accept": "application/pdf"},
        )
        response.raise_for_status()
        return response.content

    async def cancel_signing(self, provider_document_id: str, reason: str) -> bool:
        try:
            response = await self.client.post(
                f"/documents/{provider_document_id}/cancel",
                json={"reason": reason},
            )
            return response.status_code in (200, 204)
        except httpx.HTTPStatusError as e:
            logger.error("MekariSign | cancel failed | doc_id=%s | error=%s", provider_document_id, e)
            return False

    async def send_reminder(self, provider_document_id: str, signer_email: str) -> bool:
        try:
            response = await self.client.post(
                f"/documents/{provider_document_id}/remind",
                json={"email": signer_email},
            )
            return response.status_code in (200, 204)
        except httpx.HTTPStatusError as e:
            logger.error("MekariSign | remind failed | doc_id=%s | email=%s | error=%s",
                         provider_document_id, signer_email, e)
            return False

    async def affix_emeterai(self, pdf_bytes: bytes, page_number: int) -> EmeteraiResult:
        response = await self.client.post(
            "/emeterai/affix",
            files={"file": ("document.pdf", pdf_bytes, "application/pdf")},
            data={"page": str(page_number)},
            headers={"Content-Type": None},
        )
        response.raise_for_status()
        data = response.json()

        logger.info("MekariSign | e-Meterai affixed | serial=%s | page=%d",
                    data.get("serial_number"), page_number)

        return EmeteraiResult(
            serial_number=data["serial_number"],
            affixed_at=data["affixed_at"],
            page_number=page_number,
            verification_url=data["verification_url"],
        )

    def parse_webhook(self, headers: dict, body: bytes) -> dict:
        """
        Verify HMAC-SHA256 signature and parse the webhook payload.
        Raises ValueError if the signature does not match — prevents spoofed callbacks.
        """
        received_signature = headers.get("x-signature") or headers.get("X-Signature", "")
        expected_signature = hmac.new(
            self.webhook_secret.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(received_signature, expected_signature):
            logger.warning(
                "MekariSign | WEBHOOK SIGNATURE MISMATCH | received=%s | expected=%s",
                received_signature[:20], expected_signature[:20],
            )
            raise ValueError("Invalid webhook signature")

        return json.loads(body)
