import asyncio
import os
from supabase import create_client

supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not supabase_url or not supabase_key:
    # Quick fallback read from .env
    from dotenv import load_dotenv
    load_dotenv(dotenv_path="/root/workspace-saas/backend/.env")
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

print(f"Connecting to {supabase_url}...")
admin_supabase = create_client(supabase_url, supabase_key)

# 1. Find all contracts matching the title
contracts_res = admin_supabase.table("contracts").select("id").ilike("title", "%sow_aplikasi_kasir%").execute()
contract_ids = [c["id"] for c in contracts_res.data]

if not contract_ids:
    print("No ghost contracts found.")
else:
    print(f"Found {len(contract_ids)} contracts to delete: {contract_ids}")
    
    # 2. Delete from dependent tables
    tables = [
        "contract_reviews",
        "contract_clauses",
        "contract_obligations",
        "contract_versions",
        "negotiation_issues",
        "task_execution_logs",
    ]
    
    for t in tables:
        print(f"Deleting from {t}...")
        try:
            admin_supabase.table(t).delete().in_("contract_id", contract_ids).execute()
        except Exception as e:
            print(f"Failed to delete from {t}: {e}")

    # For relationships (parent_id or child_id)
    try:
        admin_supabase.table("document_relationships").delete().in_("parent_id", contract_ids).execute()
        admin_supabase.table("document_relationships").delete().in_("child_id", contract_ids).execute()
    except Exception as e:
        print(f"Failed to delete relationships: {e}")

    # 3. Delete from actual contracts table
    print("Deleting from contracts table...")
    admin_supabase.table("contracts").delete().in_("id", contract_ids).execute()
    
    print("✨ Successfully deleted ghosts and their dependencies!")

