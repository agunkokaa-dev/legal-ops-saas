'use server'

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

export async function getObligationsByMatter(matterId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }

    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contract_obligations')
            .select('*, contracts!inner(matter_id, title, status)')
            .eq('contracts.matter_id', matterId)
            .neq('contracts.status', 'ARCHIVED')
            .eq('tenant_id', tenantId)
            .order('due_date', { ascending: true, nullsFirst: false })

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch obligations." }
    }
}

// ==========================================
// AI Agent Stubs for Contract Intelligence
// ==========================================

export async function getPrevailingTerms(matterId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }
    const tenantId = orgId || userId

    try {
        // 1. Fetch all contracts for this matter to establish hierarchy
        const { data: contracts, error: contractError } = await supabaseAdmin
            .from('contracts')
            .select('id, title, document_category')
            .eq('matter_id', matterId)
            .eq('tenant_id', tenantId)
            .neq('status', 'ARCHIVED')

        if (contractError) throw contractError
        if (!contracts || contracts.length < 2) return { data: null } // Need at least 2 docs for a conflict

        // 2. We need to know who the Parent is. 
        // We'll fetch relationships to make absolute sure, or fallback to the oldest MSA.
        const { data: rels } = await supabaseAdmin
            .from('document_relationships')
            .select('*')
            .eq('tenant_id', tenantId)

        const childIds = new Set((rels || []).map((r: any) => r.child_id))
        const parentDocs = contracts.filter(c => !childIds.has(c.id))
        const childDocs = contracts.filter(c => childIds.has(c.id))

        if (parentDocs.length === 0 || childDocs.length === 0) return { data: null }

        // Let's pick the first real parent
        const parentDoc = parentDocs[0]

        // Let's pick the most recent child (assuming array order or just grabbing one)
        const childDoc = childDocs[childDocs.length - 1]

        // 3. Query all clauses for these exact two documents
        const { data: parentClauses, error: pError } = await supabaseAdmin
            .from('contract_clauses')
            .select('*')
            .eq('contract_id', parentDoc.id)

        const { data: childClauses, error: cError } = await supabaseAdmin
            .from('contract_clauses')
            .select('*')
            .eq('contract_id', childDoc.id)

        if (pError || cError) throw pError || cError

        // 4. Find an overlap based on Clause Type
        // We look for a clause type that exists in BOTH the child and the parent
        let conflictDetected = null

        for (const childClause of (childClauses || [])) {
            const matchingParentClause = (parentClauses || []).find(pc => pc.clause_type === childClause.clause_type)

            if (matchingParentClause && childClause.original_text !== matchingParentClause.original_text) {
                // We found a direct override!
                conflictDetected = {
                    clauseType: childClause.clause_type,
                    parentText: matchingParentClause.ai_summary || matchingParentClause.original_text.substring(0, 100) + '...',
                    childText: childClause.ai_summary || childClause.original_text.substring(0, 100) + '...'
                }
                break; // Just grab the first conflict for the UI
            }
        }

        if (!conflictDetected) {
            return { data: null } // Completely Harmonized
        }

        return {
            data: {
                conflictDetected: true,
                issue: `${conflictDetected.clauseType} Terms`,
                description: `Specific terms in ${childDoc.title} override general terms in ${parentDoc.title}.`,
                parentName: parentDoc.title,
                parentTerm: conflictDetected.parentText,
                childName: childDoc.title,
                childTerm: conflictDetected.childText,
                prevailingName: childDoc.title
            }
        }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch prevailing terms." }
    }
}

export async function getClauseEvolution(matterId: string, clauseType: string = 'Indemnity') {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }
    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contract_clauses')
            .select('original_text, clause_type, extracted_at, contracts!inner(matter_id, title, created_at, status)')
            .eq('contracts.matter_id', matterId)
            .neq('contracts.status', 'ARCHIVED')
            .eq('tenant_id', tenantId)
            .ilike('clause_type', `%${clauseType}%`)
            .order('contracts(created_at)', { ascending: true }) // Oldest to newest timeline

        if (error) throw error

        if (!data || data.length === 0) return { data: [] }

        // Map to our UI format
        const history = data.map((row: any, index: number) => {
            const isLatest = index === data.length - 1;
            const docDate = new Date(row.contracts.created_at)
            const yearStr = docDate.getFullYear().toString()

            let label = `${yearStr} Version`
            if (index === 0) label = `${yearStr} Original`
            if (isLatest) label = `${yearStr} Update (Current)`

            // Extract a short badge from the contract title
            const contractTitle = row.contracts.title || 'Contract'
            const badge = contractTitle.length > 12 ? contractTitle.substring(0, 12) + '…' : contractTitle

            return {
                year: label,
                docId: badge,
                text: row.original_text,
                isCurrent: isLatest
            }
        });

        // The UI maps them from top to bottom, usually we want newest at the top
        return { data: history.reverse() }

    } catch (e: any) {
        return { error: e.message || "Failed to fetch clause evolution." }
    }
}

export async function getObligations(contractId: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }
    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contract_obligations')
            .select('*')
            .eq('contract_id', contractId)
            .eq('tenant_id', tenantId) // Tenant isolation check implicitly applied, though contract_id is also checked.
            .order('created_at', { ascending: false })

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to fetch obligations." }
    }
}

export async function toggleObligation(id: string, newStatus: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }
    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contract_obligations')
            .update({ status: newStatus })
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .select()
            .single()

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to update obligation." }
    }
}

export async function addObligation(contractId: string, description: string) {
    const { userId, orgId } = await auth()
    if (!userId) return { error: "Unauthorized" }
    const tenantId = orgId || userId

    try {
        const { data, error } = await supabaseAdmin
            .from('contract_obligations')
            .insert([{
                contract_id: contractId,
                tenant_id: tenantId,
                description: description,
                source: 'MANUAL',
                compliance_flag: 'SAFE',
                status: 'pending'
            }])
            .select()
            .single()

        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message || "Failed to insert obligation." }
    }
}
