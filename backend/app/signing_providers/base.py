"""
Pariana Backend — PSrE Provider Abstraction Layer

Abstract base class for all PSrE (Penyelenggara Sertifikasi Elektronik)
provider integrations. Supports PrivyID, Peruri, Mekari Sign, and a
local mock for testing.

Regulatory context:
  - UU ITE (UU 11/2008 jo. UU 19/2016): Legal basis for e-signatures in Indonesia
  - PP 71/2019: Implementing regulation for electronic systems
  - UU Bea Meterai (UU 10/2020): e-Meterai required for documents > Rp 5.000.000
  - Certified PSrE (QES) required for BFSI/government contracts
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class SignatureType(Enum):
    SIMPLE = "simple"       # Standard e-signature (lower evidentiary weight)
    CERTIFIED = "certified" # QES — PSrE-certified with electronic certificate


@dataclass
class SignerConfig:
    full_name: str
    email: str
    phone: Optional[str] = None
    privy_id: Optional[str] = None
    organization: Optional[str] = None
    role: str = "pihak_pertama"
    title: Optional[str] = None
    signing_order_index: int = 0
    signing_page: Optional[int] = None         # None = last page
    signing_position_x: Optional[float] = None # 0.0–1.0 relative to page width
    signing_position_y: Optional[float] = None # 0.0–1.0 relative to page height


@dataclass
class UploadResult:
    provider_document_id: str
    provider_document_url: str
    signer_urls: dict   # email → signing_url
    signer_ids: dict    # email → provider_signer_id
    metadata: dict      # Provider-specific raw response data


@dataclass
class SignerStatus:
    email: str
    status: str                             # 'pending' | 'viewed' | 'signed' | 'rejected'
    signed_at: Optional[str] = None
    certificate_serial: Optional[str] = None
    certificate_issuer: Optional[str] = None
    signature_hash: Optional[str] = None


@dataclass
class DocumentStatus:
    provider_document_id: str
    status: str                             # 'pending' | 'partially_signed' | 'completed' | 'expired'
    signers: list = field(default_factory=list)  # list[SignerStatus]
    signed_document_url: Optional[str] = None
    emeterai_serial: Optional[str] = None


@dataclass
class EmeteraiResult:
    serial_number: str
    affixed_at: str                         # ISO 8601 timestamp
    page_number: int
    verification_url: str                   # Peruri QR verification URL


class SigningProvider(ABC):
    """
    Abstract base class for PSrE provider integrations.

    Implement one concrete subclass per provider:
      - MekariSignProvider  (primary — bundles PrivyID + Peruri e-Meterai)
      - MockSigningProvider  (local testing — no external API calls)

    The signing router calls these methods without knowledge of which
    provider is active. Switch providers by changing SIGNING_PROVIDER env var.
    """

    @abstractmethod
    async def upload_document(
        self,
        pdf_bytes: bytes,
        filename: str,
        signers: list,       # list[SignerConfig]
        signing_order: str,  # 'parallel' | 'sequential'
        signature_type: SignatureType,
        callback_url: str,   # Publicly accessible webhook URL
    ) -> UploadResult:
        """
        Upload a document to the PSrE provider and configure signers.
        Sends signing invitations to each signer.
        Returns signing URLs per signer.
        """

    @abstractmethod
    async def get_document_status(
        self, provider_document_id: str
    ) -> DocumentStatus:
        """Poll current signing status from the provider."""

    @abstractmethod
    async def download_signed_document(
        self, provider_document_id: str
    ) -> bytes:
        """Download the final signed PDF from the provider."""

    @abstractmethod
    async def cancel_signing(
        self, provider_document_id: str, reason: str
    ) -> bool:
        """Cancel a signing session. Returns True if successful."""

    @abstractmethod
    async def send_reminder(
        self, provider_document_id: str, signer_email: str
    ) -> bool:
        """Send a reminder notification to a specific signer."""

    @abstractmethod
    async def affix_emeterai(
        self,
        pdf_bytes: bytes,
        page_number: int,
    ) -> EmeteraiResult:
        """
        Affix e-Meterai (electronic stamp duty) to a document via Peruri.
        Required for documents valued > Rp 5.000.000 (UU Bea Meterai UU 10/2020).
        Returns the e-Meterai serial number and Peruri verification data.
        """

    @abstractmethod
    def parse_webhook(
        self, headers: dict, body: bytes
    ) -> dict:
        """
        Parse and verify an incoming webhook from the provider.
        MUST verify the HMAC signature to prevent spoofing.
        Raises ValueError if signature is invalid.
        Returns parsed event dict.
        """
