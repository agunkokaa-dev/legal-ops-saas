'use server'

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { triggerSmartIngestion } from '@/app/actions/backend'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

// 1. Upload Document
export async function uploadDocument(matterId: string, formData: FormData, parentContractId?: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const file = formData.get('file') as File;
        if (!file) {
            return { error: "No file provided" }
        }

        // Generate safe storage path
        const fileExt = file.name.split('.').pop()
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
        const filePath = `${tenantId}/${matterId}/${Date.now()}_${safeName}`

        const documentCategory = formData.get('document_category') as string
        const parentId = formData.get('parent_id') as string
        const relationshipType = formData.get('relationship_type') as string

        // Upload to Supabase Storage
        const { error: storageError } = await supabaseAdmin.storage
            .from('matter-files')
            .upload(filePath, file)

        if (storageError) throw storageError
        // --- EXPLICIT V2 UPLOAD TRACK ---
        if (parentContractId) {
            // Optimistically update the parent's version_count so the UI unlocks the War Room button instantly!
            const { data: parentDoc } = await supabaseAdmin
                .from('contracts')
                .select('version_count')
                .eq('id', parentContractId)
                .single()
                
            const currentVC = parentDoc?.version_count || 1;
            
            await supabaseAdmin
                .from('contracts')
                .update({ 
                    version_count: currentVC + 1,
                    title: file.name,
                    file_url: filePath,
                    file_type: file.type,
                    file_size: file.size
                })
                .eq('id', parentContractId)

            // Trigger FastAPI with parentContractId signal (NO new row created)
            let ingestRes = null;
            try {
                // Pass parent as contractId to be safe, plus parentContractId
                ingestRes = await triggerSmartIngestion(formData, matterId, parentContractId, parentContractId);
            } catch (err) {
                console.error("🔥 ERROR DURING AI EXTRACTION BACKGROUND TASK:", err)
            }
            
            revalidatePath(`/dashboard/matters/${matterId}`)
            revalidatePath(`/dashboard/contracts/${parentContractId}`)
            return { 
                success: true, 
                versionCandidate: ingestRes?.data?.version_candidate || null 
            }
        }

        // --- ORIGINAL V1 UPLOAD TRACK ---
        // Insert into DB
        const { data: newDoc, error: dbError } = await supabaseAdmin
            .from('contracts')
            .insert({
                matter_id: matterId,
                tenant_id: tenantId,
                title: file.name,
                file_url: filePath,
                file_type: file.type,
                file_size: file.size,
                document_category: documentCategory || 'Uncategorized'
            })
            .select('id')
            .single()

        if (dbError || !newDoc) {
            // Rollback storage upload if DB insert fails
            await supabaseAdmin.storage.from('matter-files').remove([filePath])
            throw dbError || new Error("Failed to return new document ID")
        }

        // --- NEW: GENEALOGY INTEGRATION ---
        if (parentId) {
            const { error: relError } = await supabaseAdmin
                .from('document_relationships')
                .insert({
                    tenant_id: tenantId,
                    parent_id: parentId,
                    child_id: newDoc.id,
                    relationship_type: relationshipType || 'related_to'
                })

            if (relError) {
                // Rollback both storage and document insert if relationship fails
                await supabaseAdmin.from('contracts').delete().eq('id', newDoc.id)
                await supabaseAdmin.storage.from('matter-files').remove([filePath])
                throw relError
            }
        }

        // --- NEW: AI EXTRACTION INTEGRATION ---
        // Block to get the immediate FastAPI response (which contains version_candidate)
        // Since LangGraph runs in a true BackgroundTask now, this await only takes ~1s.
        let ingestRes = null;
        try {
            ingestRes = await triggerSmartIngestion(formData, matterId, newDoc.id, parentContractId);
        } catch (err) {
            console.error("🔥 ERROR DURING AI EXTRACTION BACKGROUND TASK:", err)
        }

        revalidatePath(`/dashboard/matters/${matterId}`)
        return { 
            success: true, 
            versionCandidate: ingestRes?.data?.version_candidate || null 
        }
    } catch (e: any) {
        console.error("🔥 ERROR UPLOADING DOCUMENT:", e)
        return { error: e.message || "Failed to upload document." }
    }
}

// 2. Get Matter Documents
export async function getMatterDocuments(matterId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contracts')
            .select('*')
            .eq('matter_id', matterId)
            .eq('tenant_id', tenantId)
            .neq('status', 'ARCHIVED')
            .order('created_at', { ascending: false })

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch matter documents." }
    }
}

// 3. Delete Document
export async function deleteDocument(documentId: string, fileUrl: string, matterId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        // Soft delete record from DB to prevent foreign key constraint violations
        const { error: dbError } = await supabaseAdmin
            .from('contracts')
            .update({ status: 'ARCHIVED' })
            .eq('id', documentId)
            .eq('tenant_id', tenantId)

        if (dbError) throw dbError

        revalidatePath(`/dashboard/matters/${matterId}`)
        return { success: true }
    } catch (e: any) {
        console.error("🔥 ERROR DELETING DOCUMENT:", e)
        return { error: e.message || "Failed to delete document." }
    }
}

// 4. Get Document Genealogy
export async function getDocumentGenealogy(matterId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        // Query relationships and join with contracts to get names and categories
        const { data, error } = await supabaseAdmin
            .from('document_relationships')
            .select('*, parent:contracts!parent_id(title, document_category), child:contracts!child_id(title, document_category)')
            .eq('tenant_id', tenantId)

        // Note: The above query fetches all relationships for the tenant.
        // If we want to strictly filter by matterId, we can filter the resulting array
        // or apply an inner join condition on the Supabase query if supported.

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch document relationships." }
    }
}

// 5. Get Graph Data for React Flow
export async function getGraphData(matterId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        // 1. Fetch all explicit documents in this matter
        const { data: documents, error: docsError } = await supabaseAdmin
            .from('contracts')
            .select('id, title, document_category, contract_value, risk_level')
            .eq('matter_id', matterId)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: true })

        if (docsError) throw docsError

        // 2. Fetch all relationships for the tenant. 
        // We will filter in-memory to only include those where the parent OR child is in our documents array
        const docIds = documents?.map(d => d.id) || []

        let relationships: any[] = []
        if (docIds.length > 0) {
            const { data: rels, error: relError } = await supabaseAdmin
                .from('document_relationships')
                .select('*')
                .eq('tenant_id', tenantId)

            if (relError) throw relError

            // Filter relations that map to our exact documents
            relationships = rels?.filter(r => docIds.includes(r.parent_id) || docIds.includes(r.child_id)) || []
        }

        return {
            documents: documents || [],
            relationships
        }
    } catch (e: any) {
        console.error("🔥 ERROR FETCHING GRAPH DATA:", e)
        return { documents: [], relationships: [] }
    }
}

// 6. Get Contract By ID
export async function getContractById(contractId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contracts')
            .select('*')
            .eq('id', contractId)
            .eq('tenant_id', tenantId)
            .single()

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch contract." }
    }
}

// 7. Confirm Version Link
export async function confirmVersion(newContractId: string, parentContractId: string) {
    const { userId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const { confirmVersionLink } = await import('@/app/actions/backend')
    const res = await confirmVersionLink(newContractId, parentContractId)
    
    revalidatePath(`/dashboard`)
    return res
}
