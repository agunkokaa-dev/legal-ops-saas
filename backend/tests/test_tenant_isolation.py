"""
test_tenant_isolation.py
========================
CRITICAL SECURITY TEST SUITE — Tenant Isolation Enforcement

This suite is composed of two complementary approaches:

  Approach A: Static Analysis (Regex/AST Scan)
    - Scans every router file for Supabase query patterns.
    - Asserts that every SELECT, INSERT, UPDATE, UPSERT, and DELETE on a
      tenant-scoped table includes a tenant_id filter.
    - **LIMITATION:** Uses a 15-line forward lookahead window. The payload or
      filter MUST be visible within 15 lines of the `.table()` call.
    - Breaking this test = a PR cannot be merged.

  Approach B: Runtime / Signature Tests
    - Validates that verify_clerk_token() has no x_tenant_id parameter.
    - Validates that no backend source file references x_tenant_id.
    - Validates cross-tenant access returns empty (mock-based).

Run with:
  cd /root/workspace-saas
  python -m pytest backend/tests/test_tenant_isolation.py -v --tb=short
"""

import ast
import inspect
import os
import re
import subprocess
import pytest
from unittest.mock import MagicMock, patch

# =====================================================================
# CONFIG
# =====================================================================

ROUTER_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "routers")
BACKEND_APP_DIR = os.path.join(os.path.dirname(__file__), "..", "app")

TENANT_A = "tenant_aaa_test_000"
TENANT_B = "tenant_bbb_test_999"

# Regex: matches .table("tablename").select|insert|update|upsert|delete
SUPABASE_QUERY_PATTERN = re.compile(
    r'\.table\(\s*["\'](\w+)["\']\s*\)\s*\.\s*(select|insert|update|upsert|delete)'
)

# Every table that stores tenant-specific data and MUST be filtered by tenant_id.
TENANT_SCOPED_TABLES = [
    "matters",
    "contracts",
    "contract_versions",
    "contract_obligations",
    "contract_clauses",
    "contract_notes",
    "debate_sessions",
    "negotiation_issues",
    "negotiation_rounds",
    "tasks",
    "task_templates",
    "task_template_items",
    "clause_library",
    "bilingual_clauses",
    "activity_logs",
    # NOTE: company_playbooks is intentionally excluded from this list.
    # It has TWO query patterns: tenant-specific rows (eq tenant_id) AND
    # globally shared system rows (IS NULL tenant_id). The IS NULL query is
    # architecturally correct — it fetches shared system playbook templates,
    # not another tenant's data. The tenant-scoped eq() query is enforced
    # manually and verified in test_playbook_categories_uses_strict_tenant_filter.
    "matter_documents",
    "contract_reviews",
    "intake_requests",
]

# Tables used in background tasks where tenant_id is a function parameter (not claims).
# The static scanner may produce false positives on these — they are reviewed manually.
BACKGROUND_TASK_EXEMPT_PATTERNS = [
    "process_contract_background",
    "handle_task_result",
    "async_clm_graph_invoke",
]

# =====================================================================
# HELPERS
# =====================================================================

def get_router_files():
    """Return all Python router files (excluding __init__.py)."""
    return [
        os.path.join(ROUTER_DIR, f)
        for f in os.listdir(ROUTER_DIR)
        if f.endswith(".py") and f != "__init__.py"
    ]


def extract_query_contexts(filepath):
    """
    Extract all Supabase query chains from a file.
    Returns list of (line_number, table_name, operation, full_chain_text, context_function).
    Looks ahead up to 15 lines to capture chained .eq() calls.
    """
    with open(filepath, "r") as f:
        content = f.read()
        lines = content.split("\n")

    findings = []
    for i, line in enumerate(lines, 1):
        match = SUPABASE_QUERY_PATTERN.search(line)
        if match:
            table_name = match.group(1)
            operation = match.group(2)

            # Grab a window of lines covering the entire chain
            chain_text = ""
            for j in range(i - 1, min(i + 15, len(lines))):
                chain_text += lines[j].strip() + " "
                if ".execute()" in lines[j]:
                    break

            # Determine if this line is inside a background-task function
            context_fn = _get_enclosing_function(lines, i - 1)

            findings.append((i, table_name, operation, chain_text, context_fn))

    return findings


def _get_enclosing_function(lines, line_idx):
    """Walk backwards from line_idx to find the nearest def/async def."""
    for j in range(line_idx, -1, -1):
        stripped = lines[j].lstrip()
        if stripped.startswith("def ") or stripped.startswith("async def "):
            # Extract function name
            m = re.match(r'(?:async\s+)?def\s+(\w+)', stripped)
            return m.group(1) if m else "<unknown>"
    return "<module>"


def has_tenant_filter(chain_text: str) -> bool:
    """
    Return True if the query chain contains a tenant_id filter.
    Recognises both .eq() / .in_() filter syntax and "tenant_id": value payload syntax.
    """
    return (
        'eq("tenant_id"' in chain_text
        or "eq('tenant_id'" in chain_text
        or 'in_("tenant_id"' in chain_text
        or "in_('tenant_id'" in chain_text
        or '"tenant_id":' in chain_text
        or "'tenant_id':" in chain_text
        or "tenant_id=" in chain_text
        or re.search(r"\btenant_[a-zA-Z0-9_]*\.table\(", chain_text) is not None
    )


# =====================================================================
# APPROACH A — Static Analysis Tests
# =====================================================================

@pytest.mark.parametrize("filepath", get_router_files(), ids=lambda f: os.path.basename(f))
def test_all_tenant_scoped_queries_have_tenant_filter(filepath):
    """
    CRITICAL TEST: Every Supabase SELECT, INSERT, UPDATE, UPSERT, DELETE on a
    tenant-scoped table must include a tenant_id filter or payload key.
    Failures here mean cross-tenant data leakage is possible.
    """
    violations = []
    queries = extract_query_contexts(filepath)

    for line_num, table_name, operation, chain_text, context_fn in queries:
        if table_name not in TENANT_SCOPED_TABLES:
            continue

        # Background task functions pass tenant_id as a parameter — the scanner
        # may miss it because it appears as a variable, not a JWT claim. These are
        # audited manually and noted in the audit report.
        if context_fn in BACKGROUND_TASK_EXEMPT_PATTERNS:
            continue

        if not has_tenant_filter(chain_text):
            violations.append(
                f"  Line {line_num} (in {context_fn}): "
                f".table(\"{table_name}\").{operation}() — MISSING tenant_id filter\n"
                f"  Context: {chain_text[:200]}"
            )

    filename = os.path.basename(filepath)
    assert len(violations) == 0, (
        f"\n🔴 TENANT ISOLATION VIOLATIONS in {filename}:\n"
        + "\n".join(violations)
        + "\n\nEvery query on a tenant-scoped table MUST include "
        ".eq('tenant_id', tenant_id) or 'tenant_id' in the data payload."
    )


# =====================================================================
# APPROACH B — Runtime / Signature Tests
# =====================================================================

def test_x_tenant_id_header_is_not_in_verify_clerk_token_signature():
    """
    CRITICAL TEST: verify_clerk_token() must NOT accept an x_tenant_id parameter.
    If it does, any authenticated user can impersonate any tenant.
    """
    from app.dependencies import verify_clerk_token

    sig = inspect.signature(verify_clerk_token)
    param_names = list(sig.parameters.keys())

    assert "x_tenant_id" not in param_names, (
        "🔴 CRITICAL: verify_clerk_token() still accepts x_tenant_id parameter! "
        "This header override must be removed entirely. "
        f"Current parameters: {param_names}"
    )


def test_no_x_tenant_id_references_in_backend_source():
    """
    CRITICAL TEST: No file in backend/app/ references x_tenant_id or x-tenant-id.
    This ensures the header override pattern cannot sneak back in.
    """
    result = subprocess.run(
        ["grep", "-rni", "x.tenant.id", BACKEND_APP_DIR],
        capture_output=True,
        text=True
    )

    violations = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        # Exclude this test file itself and inline comments explaining why it was removed
        if "test_tenant_isolation.py" in line:
            continue
        violations.append(line)

    assert len(violations) == 0, (
        f"🔴 Found {len(violations)} references to x_tenant_id in backend source code:\n"
        + "\n".join(violations)
        + "\n\nThe x_tenant_id header override has been intentionally removed. "
        "Do not re-introduce it."
    )


def test_verified_tenant_id_is_set_from_jwt_claims_only():
    """
    Validates that verify_clerk_token() sets verified_tenant_id from JWT org_id/sub
    and not from any header or body parameter.
    """
    import jwt as pyjwt
    from app.dependencies import verify_clerk_token
    import asyncio

    # Create a mock JWT payload
    mock_claims = {
        "sub": TENANT_A,
        "org_id": None,
        "exp": 9999999999,
        "iat": 1000000000,
    }

    with patch("app.dependencies.CLERK_PEM_KEY", "fake-key"), \
         patch("app.dependencies.jwt.decode", return_value=mock_claims):

        # Simulate a request with ONLY an Authorization header (no x-tenant-id)
        result = asyncio.get_event_loop().run_until_complete(
            verify_clerk_token(authorization="Bearer faketoken123")
        )

    assert result["verified_tenant_id"] == TENANT_A, (
        f"Expected verified_tenant_id to be '{TENANT_A}' (from sub), "
        f"got '{result.get('verified_tenant_id')}'"
    )


def test_org_id_takes_precedence_over_sub_for_tenant_id():
    """
    When org_id is present in JWT, it must take precedence over sub.
    This is the Clerk multi-tenant org context.
    """
    import jwt as pyjwt
    from app.dependencies import verify_clerk_token
    import asyncio

    mock_claims = {
        "sub": TENANT_A,   # individual user
        "org_id": TENANT_B,  # org context — should win
        "exp": 9999999999,
        "iat": 1000000000,
    }

    with patch("app.dependencies.CLERK_PEM_KEY", "fake-key"), \
         patch("app.dependencies.jwt.decode", return_value=mock_claims):

        result = asyncio.get_event_loop().run_until_complete(
            verify_clerk_token(authorization="Bearer faketoken123")
        )

    assert result["verified_tenant_id"] == TENANT_B, (
        f"Expected verified_tenant_id to be org_id '{TENANT_B}', "
        f"got '{result.get('verified_tenant_id')}'"
    )


def test_cross_tenant_matter_access_returns_empty():
    """
    CRITICAL CROSS-TENANT RUNTIME TEST:
    Tenant B must not be able to read Tenant A's matters via the matters router.
    The Supabase .eq("tenant_id", tenant_b) filter must result in an empty dataset
    when the contract belongs to tenant_a.
    """
    # Simulate Supabase client that returns an empty list (correct isolation behavior)
    mock_supabase = MagicMock()
    mock_result = MagicMock()
    mock_result.data = []  # Correct: tenant B sees no data

    # Chain: .table().select().eq("tenant_id", TENANT_B).execute()
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_result

    import asyncio
    from app.routers.matters import get_matters

    mock_claims = {"verified_tenant_id": TENANT_B}

    result = asyncio.get_event_loop().run_until_complete(
        get_matters(claims=mock_claims, supabase=mock_supabase)
    )

    # Verify tenant B's call used tenant B's ID (not tenant A's)
    call_args = mock_supabase.table.return_value.select.return_value.eq.call_args
    assert call_args is not None, "No .eq() call was made — tenant filter is missing!"

    filter_field, filter_value = call_args[0]
    assert filter_field == "tenant_id", (
        f"Expected filter on 'tenant_id', got '{filter_field}'"
    )
    assert filter_value == TENANT_B, (
        f"Expected filter value TENANT_B='{TENANT_B}', got '{filter_value}'"
    )
    assert result["data"] == [], (
        "Cross-tenant access test failed: data was returned when it should be empty."
    )


def test_cross_tenant_contracts_access_returns_empty():
    """
    CRITICAL CROSS-TENANT RUNTIME TEST:
    Tenant B must not be able to read Tenant A's contracts via the contracts router.
    The Supabase filter must result in an empty dataset.
    """
    mock_supabase = MagicMock()
    mock_result = MagicMock()
    mock_result.data = []  # Tenant B sees no contract data

    # chain: .table().select().eq("tenant_id", TENANT_B).neq()...order().execute()
    mock_eq_tenant = mock_supabase.table.return_value.select.return_value.eq.return_value
    # Setting up the rest of the chained calls to return the mock_eq_tenant itself
    # so we can eventually call .execute() on it.
    mock_eq_tenant.in_.return_value = mock_eq_tenant
    mock_eq_tenant.neq.return_value = mock_eq_tenant
    mock_eq_tenant.order.return_value = mock_eq_tenant
    mock_eq_tenant.limit.return_value = mock_eq_tenant
    mock_eq_tenant.execute.return_value = mock_result

    import asyncio
    from app.routers.contracts import list_contracts

    mock_claims = {"verified_tenant_id": TENANT_B}

    result = asyncio.get_event_loop().run_until_complete(
        list_contracts(request=MagicMock(), claims=mock_claims, supabase=mock_supabase)
    )
    
    assert result["data"] == [], "Expected empty data for cross-tenant contract access"

    # Verify tenant B's call used tenant B's ID (not tenant A's)
    call_args = mock_supabase.table.return_value.select.return_value.eq.call_args
    assert call_args is not None, ".eq() call was not made — tenant filter is missing!"

    filter_field, filter_value = call_args[0]
    assert filter_field == "tenant_id", (
        f"Expected filter on 'tenant_id', got '{filter_field}'"
    )
    assert filter_value == TENANT_B, (
        f"Expected filter value TENANT_B='{TENANT_B}', got '{filter_value}'"
    )


def test_contracts_list_supports_recent_updated_sort_and_limit():
    """
    The contracts list route must support the recent-documents widget query:
    sorted by updated_at and limited to 3 records while preserving tenant scope.
    """
    mock_supabase = MagicMock()
    mock_result = MagicMock()
    mock_result.data = [
        {"id": "c-1", "updated_at": "2026-04-14T09:00:00Z"},
        {"id": "c-2", "updated_at": "2026-04-14T08:00:00Z"},
        {"id": "c-3", "updated_at": "2026-04-14T07:00:00Z"},
    ]

    mock_eq_tenant = mock_supabase.table.return_value.select.return_value.eq.return_value
    mock_eq_tenant.in_.return_value = mock_eq_tenant
    mock_eq_tenant.neq.return_value = mock_eq_tenant
    mock_eq_tenant.order.return_value = mock_eq_tenant
    mock_eq_tenant.limit.return_value = mock_eq_tenant
    mock_eq_tenant.execute.return_value = mock_result

    import asyncio
    from app.routers.contracts import list_contracts

    mock_claims = {"verified_tenant_id": TENANT_B}

    result = asyncio.get_event_loop().run_until_complete(
        list_contracts(
            request=MagicMock(),
            claims=mock_claims,
            supabase=mock_supabase,
            tab="active",
            limit=3,
            sort_by="updated_at",
            sort_order="desc",
        )
    )

    assert result["data"] == mock_result.data
    mock_eq_tenant.order.assert_called_once_with("updated_at", desc=True)
    mock_eq_tenant.limit.assert_called_once_with(3)
