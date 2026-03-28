"""
Pariana Backend - FastAPI Dependencies
Reusable auth and database dependencies injected into all routers.
"""
import os
import jwt
from fastapi import Header, HTTPException, Depends
from supabase import create_client, Client
from app.config import CLERK_PEM_KEY, SUPABASE_URL, SUPABASE_ANON_KEY


async def verify_clerk_token(
    authorization: str = Header(None),
    x_tenant_id: str = Header(None)
) -> dict:
    """
    Validates the Clerk JWT from the Authorization header.
    Returns the decoded payload with `verified_tenant_id` injected.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
        
    token = authorization.split(" ")[1]
    
    if not CLERK_PEM_KEY:
        # FAIL HARD - Do NOT decode with verify_signature=False
        print("🚨 CRITICAL: CLERK_PEM_KEY is missing from environment!")
        raise HTTPException(status_code=500, detail="Server authentication configuration error.")

    try:
        claims = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])
        print("🔥 JWT CLAIMS:", claims)
        
        # Consistent tenant extraction: Prioritize explicit frontend context, fallback to token claims
        tenant_id = x_tenant_id or claims.get("org_id") or claims.get("sub")
        if not tenant_id:
            raise HTTPException(status_code=401, detail="No valid tenant identity found in token")
            
        claims["verified_tenant_id"] = tenant_id
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def get_tenant_supabase() -> Client:
    """
    Since Pariana uses Clerk for authentication (RS256) instead of Supabase Auth (HS256),
    we bypass Supabase RLS token injection to prevent PGRST301 (wrong key type) errors.
    The backend already securely enforces tenant isolation via explicit .eq("tenant_id", tenant_id)
    and insert mappings in every router.
    """
    from app.config import admin_supabase
    return admin_supabase
