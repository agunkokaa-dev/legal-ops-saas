"""
Pariana Backend - FastAPI Dependencies
Reusable auth and database dependencies injected into all routers.
"""
import os
import jwt
from fastapi import Header, HTTPException, Depends
from supabase import create_client, Client
from app.config import CLERK_PEM_KEY, SUPABASE_URL, SUPABASE_ANON_KEY


async def verify_clerk_token(authorization: str = Header(...)) -> dict:
    """
    Validates the Clerk JWT from the Authorization header.
    Returns the decoded payload with `verified_tenant_id` injected.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    try:
        token = authorization.replace("Bearer ", "")
        if CLERK_PEM_KEY:
            payload = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])
        else:
            # Fallback UNSECURE decode if env var missing (DO NOT USE IN PROD)
            payload = jwt.decode(token, options={"verify_signature": False})

        tenant_id = payload.get("org_id") or payload.get("sub")
        if not tenant_id:
            raise HTTPException(status_code=403, detail="No tenant context found in token.")

        payload["verified_tenant_id"] = tenant_id
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


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
