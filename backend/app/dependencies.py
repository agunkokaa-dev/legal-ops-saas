"""
Pariana Backend - FastAPI Dependencies
Reusable auth and database dependencies injected into all routers.
"""
import os
import jwt
from fastapi import Header, HTTPException, Depends
from supabase import create_client, Client
from app.config import CLERK_PEM_KEY, SUPABASE_URL, SUPABASE_ANON_KEY


async def verify_clerk_token(authorization: str = Header(None)) -> dict:
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
        # Always verify signature strictly
        claims = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])
        
        # Consistent tenant extraction
        tenant_id = claims.get("org_id") or claims.get("sub")
        if not tenant_id:
            raise HTTPException(status_code=401, detail="No valid tenant identity found in token")
            
        claims["verified_tenant_id"] = tenant_id
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def get_tenant_supabase(authorization: str = Header(...)) -> Client:
    """
    Creates a per-request Supabase client using the Anon Key + user JWT.
    This activates Row Level Security (RLS) in the database automatically.
    """
    token = authorization.replace("Bearer ", "")
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    
    try:
        client.postgrest.auth(token) # Inject JWT for RLS
    except Exception as e:
        print(f"Supabase Auth Injection Error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed: PostgREST rejected the JWT token.")
        
    return client
