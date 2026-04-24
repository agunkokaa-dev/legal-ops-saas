import asyncio
from app.dependencies import get_admin_supabase

async def check():
    sb = await get_admin_supabase()
    issues = sb.table('negotiation_issues').select('id, finding_id, status').eq('contract_id', 'feafe65a-d1c7-40b7-b528-912101c941f5').eq('version_id', 'fe48a993-f5f1-4690-adbe-365708d821d6').order('created_at').execute()
    for i in issues.data:
        print(i['id'][:8], i.get('finding_id','')[:8], i['status'])

asyncio.run(check())
