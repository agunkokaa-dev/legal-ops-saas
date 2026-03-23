'use server'

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

export async function createTask(data: {
    title: string;
    description: string;
    status: string;
    matterId: string;
    sourceNoteId?: string;
}) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { data: newTask, error } = await supabaseAdmin
            .from('tasks')
            .insert({
                tenant_id: tenantId,
                title: data.title,
                description: data.description,
                status: data.status,
                matter_id: data.matterId,
                source_note_id: data.sourceNoteId || null
            })
            .select('*')
            .single()

        if (error) {
            console.error("🔥 ERROR SUPABASE ASLI:", error);
            throw error;
        }

        revalidatePath('/dashboard/tasks')
        // We also might want to revalidate the matter details page
        if (data.matterId) {
            revalidatePath(`/dashboard/matters/${data.matterId}`)
        }

        return { success: true, data: newTask }
    } catch (e: any) {
        return { error: e.message || "Unknown database error. Check terminal." }
    }
}
