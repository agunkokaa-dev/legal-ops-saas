'use server'

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

// 1. Fetch Notes
export async function getNotesByContract(contractId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contract_notes')
            .select('*')
            .eq('contract_id', contractId)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch contract notes." }
    }
}

// 2. Create Note
export async function createNote(data: { contractId: string, quote: string, comment: string, positionData: any, draftVersion?: string }) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { data: newNote, error } = await supabaseAdmin
            .from('contract_notes')
            .insert({
                tenant_id: tenantId,
                contract_id: data.contractId,
                quote: data.quote,
                comment: data.comment,
                position_data: { 
                    ...(data.positionData || { boundingRect: null, rects: [], pageNumber: 1 }),
                    draft_version: data.draftVersion 
                }
            })
            .select('*')
            .single()

        if (error) throw error
        return { data: newNote }
    } catch (e: any) {
        return { error: e.message || "Failed to create contract note." }
    }
}

// 3. Delete Note
export async function deleteNote(noteId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { error } = await supabaseAdmin
            .from('contract_notes')
            .delete()
            .eq('id', noteId)
            .eq('tenant_id', tenantId)

        if (error) throw error
        return { success: true }
    } catch (e: any) {
        return { error: e.message || "Failed to delete contract note." }
    }
}
