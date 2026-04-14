import asyncio
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv(dotenv_path="/root/workspace-saas/backend/.env")

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(url, key)

res = supabase.table("contracts").select("id, matter_id").limit(1).execute()
print(res.data)
