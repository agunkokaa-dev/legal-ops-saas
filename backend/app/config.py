"""
Pariana Backend - Application Configuration
Centralized environment variable loading and client initialization.
"""
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams
from openai import OpenAI

load_dotenv()

# --- CORS ---
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://173.212.240.143:3000").split(",")

# --- Auth ---
CLERK_PEM_KEY = os.getenv("CLERK_PEM_PUBLIC_KEY", "").replace("\\n", "\n")

# --- Supabase ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    print("🚨 WARNING: SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables! API calls to Supabase will fail.")

_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or SUPABASE_ANON_KEY
admin_supabase: Client = create_client(SUPABASE_URL or "https://placeholder.supabase.co", _service_key or "placeholder")

# --- Qdrant ---
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
qdrant = QdrantClient(url=QDRANT_URL)
COLLECTION_NAME = "contracts_vectors"

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

# --- OpenAI ---
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
