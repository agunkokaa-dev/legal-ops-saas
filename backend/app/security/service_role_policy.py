"""
Central policy definitions for privileged Supabase service-role access.

Definitions used in code review and AST policy enforcement:

- Tenant-scoped flow:
  A flow that reads or writes data for exactly one known tenant, even when it
  runs in a worker, background task, script callback, or outside the HTTP
  request lifecycle.
- Cross-tenant/system-level flow:
  A flow that legitimately spans multiple tenants, targets global/system-owned
  data, or cannot be scoped to one tenant by design.
- Bootstrap before tenant known:
  A flow that must inspect globally keyed metadata first in order to discover
  `tenant_id`; tenant wrapping is impossible until that lookup completes.
- Non-PostgREST storage access:
  A flow that uses Supabase storage/object APIs rather than PostgREST tables;
  tenant isolation is enforced by deterministic storage paths and explicit
  review, not by `.eq("tenant_id", ...)`.
- Maintenance/system repair operation:
  An operator-invoked repair, seed, or backfill flow that intentionally works
  across historical or system-owned data and is never the normal request path.
"""
from __future__ import annotations

from typing import Literal, TypedDict


ServiceRoleExceptionCategory = Literal[
    "cross_tenant_system_level",
    "bootstrap_before_tenant_known",
    "non_postgrest_storage_access",
    "maintenance_system_repair_operation",
]

ServiceRoleOperation = Literal[
    "raw_admin_import",
    "raw_admin_dependency",
    "direct_admin_table_access",
    "service_role_factory",
    "hazardous_raw_access",
    "raw_client_wrapper_bypass",
]


class ServiceRoleException(TypedDict):
    reason: str
    category: ServiceRoleExceptionCategory
    allowed_operations: tuple[ServiceRoleOperation, ...]
    required_comment_prefixes: tuple[str, ...]


ALLOWED_SERVICE_ROLE_EXCEPTIONS: dict[str, ServiceRoleException] = {
    "app.config:_build_admin_supabase": {
        "reason": "canonical privileged singleton bootstrap for explicit reviewed flows",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("service_role_factory",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.dependencies:get_admin_supabase": {
        "reason": "explicit reviewed dependency for cross-tenant or system-level privileged flows",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.dependencies:get_tenant_admin_supabase": {
        "reason": "central tenant-scoped privileged factory wraps the service-role client before tenant-scoped use",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.task_logger:_insert_task_log_row": {
        "reason": "cross-tenant task/logging infrastructure writes system-owned execution logs",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.task_logger:_update_task_log_row": {
        "reason": "cross-tenant task/logging infrastructure updates system-owned execution logs",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.job_queue:_insert_task_log": {
        "reason": "queue bootstrap persists system-level task logs before worker execution starts",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.job_queue:update_task_log": {
        "reason": "queue status reconciliation updates system-level task logs",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.routers.tasks:get_cross_tenant_tasks_admin_client": {
        "reason": "legacy personal-workspace task routes intentionally span multiple allowed tenant ids",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_dependency",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.routers.signing:_bootstrap_signing_session_by_provider_document_id": {
        "reason": "webhook bootstrap must resolve tenant_id from provider_document_id before a tenant wrapper can exist",
        "category": "bootstrap_before_tenant_known",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.routers.signing:_handle_signing_complete": {
        "reason": "signing completion uploads signed PDFs through the storage API, not PostgREST tables",
        "category": "non_postgrest_storage_access",
        "allowed_operations": ("hazardous_raw_access",),
        "required_comment_prefixes": ("# NON-POSTGREST:",),
    },
    "app.routers.contracts:upload_contract": {
        "reason": "contract upload stores raw files through Supabase storage before table-side processing continues",
        "category": "non_postgrest_storage_access",
        "allowed_operations": ("hazardous_raw_access",),
        "required_comment_prefixes": ("# NON-POSTGREST:",),
    },
    "app.routers.sse:get_worker_health": {
        "reason": "worker health aggregates system-level queue metrics from task execution logs",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "app.laws.repository:build_law_corpus_repository": {
        "reason": "law corpus repository operates on global system-owned legal corpus tables",
        "category": "cross_tenant_system_level",
        "allowed_operations": ("raw_admin_import",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "scripts.backfill_negotiation_issues:_list_versions_for_backfill": {
        "reason": "backfill enumerates historical versions across tenants before switching to tenant wrappers for writes",
        "category": "maintenance_system_repair_operation",
        "allowed_operations": ("raw_admin_import", "direct_admin_table_access"),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "scripts.repair_playbook_vectors:build_clients": {
        "reason": "repair script intentionally constructs a service-role client for operator-run global vector repair",
        "category": "maintenance_system_repair_operation",
        "allowed_operations": ("service_role_factory",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
    "scripts.ingest_uu_pdp:_repo": {
        "reason": "seed ingestion populates the global law corpus and is not tenant-scoped",
        "category": "maintenance_system_repair_operation",
        "allowed_operations": ("raw_admin_import",),
        "required_comment_prefixes": ("# CROSS-TENANT:",),
    },
}
