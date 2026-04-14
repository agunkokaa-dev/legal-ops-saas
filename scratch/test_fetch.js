const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/root/workspace-saas/frontend/.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data, error } = await supabase.from('contracts').select('id, title, matter_id').limit(1);
    console.log(data);
}
check();
