import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.dependencies import get_tenant_admin_supabase
from app.pipeline_output_schema import parse_pipeline_output, serialize_pipeline_output
from app.routers.negotiation import _ensure_negotiation_issues


def _list_versions_for_backfill() -> list[dict]:
    # CROSS-TENANT: backfill must enumerate historical versions across tenants before switching to tenant wrappers for writes.
    from app.config import admin_supabase

    # CROSS-TENANT: enumeration intentionally scans historical versions across tenants before narrowing writes per tenant.
    versions_res = admin_supabase.table("contract_versions") \
        .select("id, contract_id, tenant_id, pipeline_output") \
        .not_.is_("pipeline_output", "null") \
        .order("created_at", desc=True) \
        .execute()
    return versions_res.data or []


async def main() -> None:
    versions = _list_versions_for_backfill()

    processed_versions = 0
    updated_versions = 0
    created_issues = 0
    rewritten_references = 0

    for version in versions:
        po = parse_pipeline_output(version.get("pipeline_output"))
        diff = po.diff_result
        deviations = diff.deviations if diff else []
        if not deviations:
            continue

        processed_versions += 1
        tenant_sb = get_tenant_admin_supabase(version["tenant_id"])
        diff_result = diff.model_dump() if diff else {}
        sync_stats = _ensure_negotiation_issues(
            tenant_supabase_client=tenant_sb,
            contract_id=version["contract_id"],
            tenant_id=version["tenant_id"],
            version_id=version["id"],
            diff_result=diff_result,
        )

        created_issues += sync_stats["created_count"]
        rewritten_references += sync_stats["rewritten_count"]

        if sync_stats["created_count"] or sync_stats["rewritten_count"]:
            po.diff_result = diff_result
            tenant_sb.table("contract_versions").update({
                "pipeline_output": serialize_pipeline_output(po),
            }).eq("id", version["id"]).execute()

            tenant_sb.table("negotiation_rounds").update({
                "diff_snapshot": diff_result,
            }).eq("contract_id", version["contract_id"]).eq("to_version_id", version["id"]).execute()

            updated_versions += 1
            print(
                "[backfill] contract=%s version=%s created=%s rewritten=%s"
                % (
                    version["contract_id"][:8],
                    version["id"][:8],
                    sync_stats["created_count"],
                    sync_stats["rewritten_count"],
                )
            )

    print("")
    print(f"processed_versions={processed_versions}")
    print(f"updated_versions={updated_versions}")
    print(f"created_issues={created_issues}")
    print(f"rewritten_references={rewritten_references}")


if __name__ == "__main__":
    asyncio.run(main())
