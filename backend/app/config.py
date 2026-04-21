"""
Pariana Backend - Application Configuration
Centralized environment variable loading and client initialization.
"""
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PayloadSchemaType
from openai import OpenAI

load_dotenv(override=False)

ENVIRONMENT = (os.getenv("ENVIRONMENT") or "development").strip().lower() or "development"


def _default_public_app_url() -> str:
    return "https://clause.id" if ENVIRONMENT == "production" else "http://localhost:3000"


PUBLIC_APP_URL = (os.getenv("PUBLIC_APP_URL") or _default_public_app_url()).strip().rstrip("/")
SIGNING_WEBHOOK_BASE_URL = (
    os.getenv("SIGNING_WEBHOOK_BASE_URL")
    or f"{PUBLIC_APP_URL}/api/v1/signing/webhook"
).strip().rstrip("/")


def _build_allowed_origins() -> list[str]:
    configured_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
    if configured_origins:
        return [origin.strip().rstrip("/") for origin in configured_origins.split(",") if origin.strip()]

    origins = ["https://clause.id", "https://www.clause.id"]
    if ENVIRONMENT != "production":
        origins.extend([
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
        ])
    return origins


# --- CORS ---
ALLOWED_ORIGINS = _build_allowed_origins()

# --- Auth ---
import re as _re
import textwrap as _textwrap

def _load_pem_key() -> str:
    """Bulletproof PEM key loader. Reconstructs a valid RSA public key
    from any mangled .env input (literal \\n, \\v, vertical tabs, quotes, etc.)."""
    raw = os.getenv("CLERK_PEM_KEY", "")
    if not raw:
        return ""
    # Step 1: Normalize all escape sequences and control characters to spaces
    cleaned = raw.replace("\\n", " ").replace("\\v", " ").replace("\n", " ").replace("\r", " ").replace("\x0b", " ").replace("\t", " ").strip('"').strip("'")
    # Step 2: Strip PEM headers/footers and extract pure base64 body
    cleaned = cleaned.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "")
    # Step 3: Remove ALL remaining whitespace to get a single base64 string
    b64_body = _re.sub(r'\s+', '', cleaned)
    if not b64_body:
        return ""
    # Step 4: Rebuild proper PEM with 64-char lines (RFC 7468)
    wrapped = "\n".join(_textwrap.wrap(b64_body, 64))
    return f"-----BEGIN PUBLIC KEY-----\n{wrapped}\n-----END PUBLIC KEY-----"

CLERK_PEM_KEY = _load_pem_key()

# --- Supabase ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")

# Strict startup validation (Fail Hard)
if not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("CRITICAL SECURITY ERROR: SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is missing. Halting startup to prevent RLS bypass.")

admin_supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# --- Qdrant ---
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
qdrant = QdrantClient(url=QDRANT_URL)
COLLECTION_NAME = "contracts_vectors"
NATIONAL_LAWS_COLLECTION = "id_national_laws"
LAW_QDRANT_ACTIVE_ALIAS = "id_national_laws_active"
LAW_QDRANT_V2_COLLECTION = "id_national_laws_v2"

# Ensure collections exist on startup
def init_qdrant_collections():
    existing = [col.name for col in qdrant.get_collections().collections]
    if COLLECTION_NAME not in existing:
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
        )
    if "company_rules" not in existing:
        qdrant.create_collection(
            collection_name="company_rules",
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
        )
    if "clause_library_vectors" not in existing:
        print("Creating 'clause_library_vectors' collection...")
        qdrant.create_collection(
            collection_name="clause_library_vectors",
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
        )
    # National law collections are provisioned explicitly by the sync/cutover scripts.

# --- OpenAI ---
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# --- Anthropic ---
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
