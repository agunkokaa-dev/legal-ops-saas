"""
Pariana Backend — PSrE Provider Factory

Returns the configured signing provider based on SIGNING_PROVIDER env var.

Supported values:
  mock         — MockSigningProvider (local dev/testing, no API calls)
  mekari_sign  — MekariSignProvider (PSrE certified, production)

Usage:
    from app.signing_providers import get_signing_provider
    provider = get_signing_provider()
    result = await provider.upload_document(...)
"""

import os
from app.signing_providers.base import SigningProvider


def get_signing_provider() -> SigningProvider:
    """
    Factory function — returns the active signing provider based on env config.
    Defaults to 'mock' if SIGNING_PROVIDER is not set.
    """
    provider_name = os.getenv("SIGNING_PROVIDER", "mock").lower().strip()

    if provider_name == "mekari_sign":
        from app.signing_providers.mekari_sign import MekariSignProvider

        api_key = os.getenv("MEKARI_SIGN_API_KEY")
        api_secret = os.getenv("MEKARI_SIGN_API_SECRET")
        webhook_secret = os.getenv("MEKARI_SIGN_WEBHOOK_SECRET")
        api_base = os.getenv("MEKARI_SIGN_API_BASE")  # None → defaults to sandbox

        if not api_key or not api_secret or not webhook_secret:
            raise EnvironmentError(
                "MEKARI_SIGN_API_KEY, MEKARI_SIGN_API_SECRET, and MEKARI_SIGN_WEBHOOK_SECRET "
                "must be set when SIGNING_PROVIDER=mekari_sign"
            )

        return MekariSignProvider(
            api_key=api_key,
            api_secret=api_secret,
            webhook_secret=webhook_secret,
            api_base=api_base,
        )

    elif provider_name == "mock":
        from app.signing_providers.mock import MockSigningProvider
        return MockSigningProvider()

    else:
        raise ValueError(
            f"Unknown SIGNING_PROVIDER='{provider_name}'. "
            f"Supported values: 'mock', 'mekari_sign'."
        )
