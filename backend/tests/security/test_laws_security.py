from __future__ import annotations

from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.dependencies import verify_clerk_token
from app.laws.authz import extract_namespaced_roles
from app.laws.repository import LawCorpusRepository
from app.routers import laws as laws_router


def test_laws_repository_rejects_non_corpus_table_access():
    repo = LawCorpusRepository(
        supabase=type("Supabase", (), {"table": lambda self, name: None})(),
        qdrant=object(),
        active_collection="id_national_laws_active",
        v2_collection="id_national_laws_v2",
        legacy_collection="id_national_laws",
    )

    with pytest.raises(ValueError):
        repo.read_table("contracts")


def test_laws_admin_accepts_valid_namespaced_role():
    roles = extract_namespaced_roles({"https://clause.id/roles": ["laws_admin"]})
    assert "laws_admin" in roles


def test_laws_admin_rejects_legacy_role_claim_without_namespace():
    with pytest.raises(Exception):
        extract_namespaced_roles({"role": "admin"})


def test_laws_admin_rejects_missing_namespaced_roles_claim():
    app = FastAPI()
    app.include_router(laws_router.router)
    fake_service = type(
        "FakeService",
        (),
        {
            "repository": type(
                "Repo",
                (),
                {
                    "active_collection": "id_national_laws_active",
                    "v2_collection": "id_national_laws_v2",
                    "get_sync_status": staticmethod(lambda **kwargs: {"sync_status": "in_sync"}),
                },
            )(),
        },
    )()

    app.dependency_overrides[laws_router.get_law_service] = lambda: fake_service
    app.dependency_overrides[verify_clerk_token] = lambda: {"sub": "user-1", "verified_tenant_id": "tenant-1"}

    client = TestClient(app)
    response = client.get("/laws/admin/sync-status")
    assert response.status_code == 403


def test_pasal_endpoint_rejects_malformed_uuid():
    app = FastAPI()
    app.include_router(laws_router.router)
    fake_service = type("FakeService", (), {"get_pasal_detail": staticmethod(lambda node_id, effective_as_of=None: None)})()

    app.dependency_overrides[laws_router.get_law_service] = lambda: fake_service
    app.dependency_overrides[verify_clerk_token] = lambda: {
        "sub": "user-1",
        "verified_tenant_id": "tenant-1",
        "https://clause.id/roles": ["laws_admin"],
    }

    client = TestClient(app)
    response = client.get("/laws/pasal/not-a-uuid")
    assert response.status_code == 422
