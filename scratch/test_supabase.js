const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/root/workspace-saas/frontend/.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function testInsert() {
    console.log("Testing insert...");
    const { data, error } = await supabaseAdmin.from('tasks').insert({
        tenant_id: 'test-tenant',
        title: 'Test Task',
        description: 'Test description',
        status: 'backlog',
        matter_id: null,
        source_note_id: 'test-note-123'
    });
    console.log("Result data:", data);
    console.log("Error:", error);
}

testInsert();
