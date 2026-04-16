import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.dependencies import get_admin_supabase
from app.routers.negotiation import _ensure_negotiation_issues


async def main() -> None:
    admin_supabase = await get_admin_supabase()
    versions_res = admin_supabase.table("contract_versions") \
        .select("id, contract_id, tenant_id, pipeline_output") \
        .not_.is_("pipeline_output", "null") \
        .order("created_at", desc=True) \
        .execute()

    processed_versions = 0
    updated_versions = 0
    created_issues = 0
    rewritten_references = 0

    for version in versions_res.data or []:
        pipeline_output = version.get("pipeline_output") or {}
        diff_result = pipeline_output.get("diff_result") or {}
        deviations = diff_result.get("deviations") or []
        if not deviations:
            continue

        processed_versions += 1
        sync_stats = _ensure_negotiation_issues(
            tenant_supabase_client=admin_supabase,
            contract_id=version["contract_id"],
            tenant_id=version["tenant_id"],
            version_id=version["id"],
            diff_result=diff_result,
        )

        created_issues += sync_stats["created_count"]
        rewritten_references += sync_stats["rewritten_count"]

        if sync_stats["created_count"] or sync_stats["rewritten_count"]:
            pipeline_output["diff_result"] = diff_result
            admin_supabase.table("contract_versions").update({
                "pipeline_output": pipeline_output,
            }).eq("id", version["id"]).eq("tenant_id", version["tenant_id"]).execute()

            admin_supabase.table("negotiation_rounds").update({
                "diff_snapshot": diff_result,
            }).eq("contract_id", version["contract_id"]).eq("tenant_id", version["tenant_id"]).eq("to_version_id", version["id"]).execute()

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
