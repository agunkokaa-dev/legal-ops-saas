"""
Pariana Backend — Application Entry Point (Refactored)

This is the new modular entry point. It imports routers from
the `app/routers/` package, applies middleware, and starts the app.

Run with: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.rate_limiter import limiter, rate_limit_exceeded_handler

from app.config import ALLOWED_ORIGINS, init_qdrant_collections
from app.routers import matters, contracts, chat, templates, tasks, playbook, intake, drafting, clauses, review, negotiation, bilingual, national_laws, signing

# --- App Initialization ---
app = FastAPI(title="CLAUSE Intelligent Engine", version="2.0.0")

# --- Rate Limiting Setup ---
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Initialize Vector DB Collections ---
init_qdrant_collections()

# --- Register Routers ---
# Each router file owns its own set of endpoints and dependencies.
app.include_router(matters.router,    prefix="/api",           tags=["Matters"])
app.include_router(contracts.router,  prefix="/api",           tags=["Contracts"])
app.include_router(chat.router,       prefix="/api",           tags=["Chat & RAG"])
app.include_router(playbook.router,   prefix="/api/playbook",  tags=["Playbook"])
app.include_router(templates.router,  prefix="/api/v1",        tags=["SOP Templates"])
app.include_router(tasks.router,      prefix="/api/v1",        tags=["Tasks & AI Assistant"])
app.include_router(intake.router,     prefix="/api/v1",        tags=["Intake Portal"])
app.include_router(drafting.router,   prefix="/api/v1/drafting", tags=["Drafting"])
app.include_router(clauses.router,    prefix="/api/v1",          tags=["Clause Library"])
app.include_router(review.router,     prefix="/api/v1/review",       tags=["Contract Review"])
app.include_router(negotiation.router, prefix="/api/v1/negotiation",  tags=["Negotiation War Room"])
app.include_router(bilingual.router,  prefix="/api/v1/bilingual",    tags=["Bilingual Editor"])
app.include_router(national_laws.router, prefix="/api/v1/admin",       tags=["National Law Admin"])
app.include_router(signing.router,       prefix="/api/v1/signing",       tags=["E-Signature & E-Meterai"])



@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "2.0.0"}
