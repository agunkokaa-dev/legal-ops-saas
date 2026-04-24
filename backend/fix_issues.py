import asyncio
from app.dependencies import get_admin_supabase

async def fix():
    sb = await get_admin_supabase()
    # Hapus issues dengan finding_id angka (stale/legacy)
    result = sb.table('negotiation_issues') \
        .delete() \
        .eq('contract_id', 'feafe65a-d1c7-40b7-b528-912101c941f5') \
        .in_('id', ['2d90a464-b8d4-4455-8633-4c31cb63a8b4', 'da19a00c-b5d3-4b8a-9c1e-8f2d3e4a5b6c']) \
        .execute()
    print('Deleted:', result.data)
    
    # Verify sisa issues
    remaining = sb.table('negotiation_issues') \
        .select('id, finding_id, status, title') \
        .eq('contract_id', 'feafe65a-d1c7-40b7-b528-912101c941f5') \
        .execute()
    print('Remaining:')
    for i in remaining.data:
        print(f'  {i["id"][:8]} finding={str(i.get("finding_id",""))[:8]} status={i["status"]}')

asyncio.run(fix())
