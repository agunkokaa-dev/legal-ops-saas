"""
Pariana Backend — Application Entry Point (Refactored)

This is the new modular entry point. It imports routers from
the `app/routers/` package, applies middleware, and starts the app.

Run with: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from contextlib import asynccontextmanager
from datetime import datetime
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.rate_limiter import limiter, rate_limit_exceeded_handler

from app.config import ALLOWED_ORIGINS, init_qdrant_collections
from app.event_bus import event_bus
from app.routers import matters, contracts, chat, templates, tasks, playbook, intake, drafting, clauses, review, negotiation, bilingual, national_laws, signing, sse, laws, onboarding, calendar

SENTRY_DSN = os.getenv("SENTRY_DSN_BACKEND") or os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        send_default_pii=False,
        max_request_body_size="never",
        before_send=lambda event, hint: (
            None if event.get("request", {}).get("url", "").endswith("/health")
            else event
        ),
    )
    print("Sentry initialized for backend")

# --- Lifespan ---
@asynccontextmanager
async def lifespan(_: FastAPI):
    init_qdrant_collections()
    await event_bus.startup()
    try:
        yield
    finally:
        try:
            from app.job_queue import close_pool
            await close_pool()
        except Exception:
            pass
        await event_bus.close()

# --- App Initialization ---
app = FastAPI(title="CLAUSE Intelligent Engine", version="2.0.0", lifespan=lifespan)

# --- Rate Limiting Setup ---
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
)

# --- Register Routers ---
# Each router file owns its own set of endpoints and dependencies.
# Matters now live under /api/v1; keep /api as a backward-compatible alias.
app.include_router(matters.router,    prefix="/api/v1",        tags=["Matters"])
app.include_router(matters.router,    prefix="/api",           include_in_schema=False)
app.include_router(contracts.router,  prefix="/api/v1",        tags=["Contracts"])
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
app.include_router(laws.router, prefix="/api/v1", tags=["Laws"])
app.include_router(onboarding.router, prefix="/api/v1", tags=["Onboarding"])
app.include_router(calendar.router, prefix="/api/v1/calendar", tags=["Calendar"])
app.include_router(national_laws.router, prefix="/api/v1/admin",       tags=["National Law Admin"])
app.include_router(sse.admin_router,      prefix="/api/v1/admin",       tags=["Worker Admin"])
app.include_router(signing.router,       prefix="/api/v1/signing",       tags=["E-Signature & E-Meterai"])
app.include_router(sse.router,           prefix="/api/v1/events",        tags=["Real-Time Events"])



@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/api/health")
async def api_health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/admin/sentry-test")
async def test_sentry():
    """Test endpoint for verifying backend Sentry capture."""
    raise ValueError("Sentry test error dari clause.id backend")
