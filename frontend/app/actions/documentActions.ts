'use server'

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { triggerSmartIngestion } from '@/app/actions/backend'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

// 1. Upload Document
// Single Writer: the backend (FastAPI) is the sole writer for contract rows and Storage.
// This action only forwards the file + metadata and reads back the contract_id.
export async function uploadDocument(matterId: string, formData: FormData, parentContractId?: string) {
    const { userId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    try {
        const file = formData.get('file') as File
        if (!file) return { error: "No file provided" }

        // Delegate the full upload lifecycle (Storage + DB insert/update + genealogy) to FastAPI.
        const ingestRes = await triggerSmartIngestion(formData, matterId, undefined, parentContractId)

        if (!ingestRes?.success) {
            return { error: ingestRes?.error || "Upload failed" }
        }

        const contractId: string | undefined = ingestRes.data?.contract_id

        revalidatePath(`/dashboard/matters/${matterId}`)
        if (parentContractId) {
            revalidatePath(`/dashboard/contracts/${parentContractId}`)
        } else if (contractId) {
            revalidatePath(`/dashboard/contracts/${contractId}`)
        }

        return {
            success: true,
            contractId,
            versionCandidate: ingestRes.data?.version_candidate || null,
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
export async function deleteDocument(documentId: string, _fileUrl: string, matterId: string) {
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
export async function getDocumentGenealogy(_matterId: string) {
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
            .neq('status', 'ARCHIVED')
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
