'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { getServerApiBase } from '@/lib/server-api-base'

const INTERNAL_API_URL = getServerApiBase()

// 1. Chat Action
export async function chatWithClause(question: string) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        throw new Error("Unauthorized: No tenant or user ID found.")
    }

    try {
        const token = await getToken()
        
        const response = await fetch(`${INTERNAL_API_URL}/api/v1/ai/task-assistant`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({
                message: question,
                tenant_id: tenantId,
                source_page: "dashboard", // 🚨 CRITICAL: Explicitly set the context!
                matter_id: "general", // Required by Pydantic model
                task_id: "dashboard_chat" // Required by Pydantic model
            }),
        });

        // 2. Fix the error handling to prevent [object Object] crash:
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("🔥 FASTAPI ERROR in Server Action:", errorData);
            
            // Safely extract the Pydantic error array
            const errorMessage = Array.isArray(errorData.detail)
                ? errorData.detail.map((e: any) => e.loc ? `${e.loc.join('.')}: ${e.msg}` : e.msg).join(" | ")
                : (errorData.detail || `HTTP error! status: ${response.status}`);
                
            throw new Error(errorMessage);
        }

        return await response.json()
    } catch (error: any) {
        console.error("Chat Action Error:", error)
        throw new Error(error.message || "Internal server error")
    }
}

// 1.b Clause Assistant RAG Action (Document Detail)
export async function chatWithClauseRAG({ 
    contractId, 
    matterId, 
    message,
    context,
}: { 
    contractId: string;
    matterId?: string;
    message: string;
    context?: {
        deviationId?: string;
        title?: string;
        impactAnalysis?: string;
        v1Text?: string;
        v2Text?: string;
        severity?: string;
        playbookViolation?: string;
    };
}) {
    const { userId, orgId, getToken } = await auth();
    const tenantId = orgId || userId;

    if (!tenantId) {
        throw new Error("Unauthorized: No tenant or user ID found.");
    }

    try {
        const token = await getToken();
        if (!token) {
            throw new Error("Authentication failed: Could not retrieve Supabase JWT");
        }
        
        const targetEndpoint = `${INTERNAL_API_URL}/api/chat/clause-assistant`;
        
        console.log(`📡 [SERVER ACTION] Sending RAG request to: ${targetEndpoint}`);

        const response = await fetch(targetEndpoint, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({
                message: message,
                contractId: contractId,
                matterId: matterId || "general",
                userId: userId || null,
                context: context || null,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("🔥 FASTAPI ERROR in chatWithClauseRAG:", response.status, errorData);
            
            const errorMessage = Array.isArray(errorData.detail)
                ? errorData.detail.map((e: any) => e.loc ? `${e.loc.join('.')}: ${e.msg}` : e.msg).join(" | ")
                : (errorData.detail || `HTTP error! status: ${response.status}`);
                
            throw new Error(errorMessage);
        }

        return await response.json();
    } catch (error: any) {
        console.error("🚨 chatWithClauseRAG Error:", error);
        throw new Error(error.message || "Internal server error");
    }
}

// 2. Upload Action
export async function uploadDocument(formData: FormData) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        return { success: false, error: "Unauthorized: No tenant or user ID found." }
    }

    const file = formData.get('file') as File
    if (!file) {
        return { success: false, error: "No file provided." }
    }

    try {
        const token = await getToken()
        const backendFormData = new FormData()
        backendFormData.append('file', file)
        backendFormData.append('tenant_id', tenantId)

        const response = await fetch(`${INTERNAL_API_URL}/api/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: backendFormData,
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            return { success: false, error: errorData.detail || 'Failed to upload document' }
        }

        const data = await response.json()
        revalidatePath('/dashboard')
        return { success: true, data }
    } catch (error: any) {
        console.error("Upload Action Error:", error)
        return { success: false, error: error.message || "Internal server error" }
    }
}

// 3. Smart Ingestion Background Action
// contractId is no longer passed — the backend generates and owns it for fresh uploads.
export async function triggerSmartIngestion(formData: FormData, matterId: string, contractId?: string, parentContractId?: string) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        return { success: false, error: "Unauthorized: No tenant or user ID found." }
    }

    const file = formData.get('file') as File
    if (!file) {
        return { success: false, error: "No file provided." }
    }

    try {
        const token = await getToken()
        const backendFormData = new FormData()
        backendFormData.append('file', file)
        backendFormData.append('matter_id', matterId)
        // Only append contract_id when explicitly provided (e.g. legacy callers)
        if (contractId) backendFormData.append('contract_id', contractId)
        if (parentContractId) backendFormData.append('parent_contract_id', parentContractId)

        // Pass through any extra metadata fields from the original formData
        const documentCategory = formData.get('document_category')
        const parentId = formData.get('parent_id')
        const relationshipType = formData.get('relationship_type')
        if (documentCategory) backendFormData.append('document_category', documentCategory as string)
        if (parentId) backendFormData.append('parent_id', parentId as string)
        if (relationshipType) backendFormData.append('relationship_type', relationshipType as string)

        const response = await fetch(`${INTERNAL_API_URL}/api/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: backendFormData,
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            console.error("Smart Ingestion API Error:", errorData.detail)
            return { success: false, error: errorData.detail || 'Failed to upload document' }
        }

        const data = await response.json()
        console.log("✅ Smart Ingestion completed:", data)
        return { success: true, data }
    } catch (error: any) {
        console.error("Smart Ingestion Action Error:", error)
        return { success: false, error: error.message || "Internal server error" }
    }
}

type ConfirmPendingVersionPayload = {
    pendingVersionId: string
    matchedContractId: string
    action: 'confirm' | 'reject'
    matterId?: string
}

type LegacyConfirmVersionPayload = {
    newContractId: string
    parentContractId: string
}

// 4. Confirm War Room Version Link
export async function confirmVersionLink(
    payload: ConfirmPendingVersionPayload | LegacyConfirmVersionPayload
) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        return { success: false, error: "Unauthorized: No tenant or user ID found." }
    }

    try {
        const token = await getToken()

        let response: Response
        if ('pendingVersionId' in payload) {
            const formData = new FormData()
            formData.append('pending_version_id', payload.pendingVersionId)
            formData.append('matched_contract_id', payload.matchedContractId)
            formData.append('action', payload.action)
            if (payload.matterId) formData.append('matter_id', payload.matterId)

            response = await fetch(`${INTERNAL_API_URL}/api/upload/confirm-version`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                body: formData,
            })
        } else {
            response = await fetch(`${INTERNAL_API_URL}/api/upload/confirm-version`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    new_contract_id: payload.newContractId,
                    parent_contract_id: payload.parentContractId
                }),
            })
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            console.error("Confirm Version API Error:", errorData.detail)
            return { success: false, error: errorData.detail || 'Failed to confirm version link' }
        }

        const data = await response.json()
        return { success: true, data }
    } catch (error: any) {
        console.error("Confirm Version Action Error:", error)
        return { success: false, error: error.message || "Internal server error" }
    }
}

export async function triggerSmartDiff(contractId: string, enableDebate: boolean = true) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        return { success: false, error: "Unauthorized: No tenant or user ID found." }
    }

    try {
        const token = await getToken()
        const response = await fetch(
            `${INTERNAL_API_URL}/api/v1/negotiation/${contractId}/diff?enable_debate=${enableDebate}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({}),
            }
        )

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            return { success: false, error: data.detail || 'Failed to trigger Smart Diff' }
        }

        return { success: true, data }
    } catch (error: any) {
        console.error("Trigger Smart Diff Action Error:", error)
        return { success: false, error: error.message || "Internal server error" }
    }
}

export async function sendCounselMessage(
    contractId: string,
    message: string,
    sessionType: "deviation" | "general_strategy",
    sessionId?: string,
    deviationId?: string,
): Promise<Response> {
    const { getToken } = await auth();
    const token = await getToken();
    
    // Return raw response for streaming — frontend handles SSE parsing
    return fetch(`${INTERNAL_API_URL}/api/v1/negotiation/${contractId}/counsel`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message,
            session_id: sessionId,
            deviation_id: deviationId,
            session_type: sessionType,
        }),
    });
}

export async function getCounselSessions(contractId: string) {
    const { getToken } = await auth();
    const token = await getToken();
    
    const res = await fetch(`${INTERNAL_API_URL}/api/v1/negotiation/${contractId}/counsel/sessions`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    
    if (!res.ok) return { sessions: [] };
    return res.json();
}

function normalizeLawsError(status: number, payload: any): string {
    if (status === 429) {
        return payload?.detail?.message || payload?.message || 'Rate limit reached. Please wait before trying again.'
    }
    if (status === 422) {
        return payload?.detail || 'The request is invalid. Check the query or filters and try again.'
    }
    if (status === 400) {
        return payload?.detail || 'The laws request was rejected for safety or validation reasons.'
    }
    return payload?.detail || payload?.message || `Request failed (HTTP ${status})`
}

async function fetchLawsApi(path: string, init?: RequestInit) {
    const { getToken } = await auth()
    const token = await getToken()

    const response = await fetch(`${INTERNAL_API_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...(init?.headers || {}),
        },
        cache: 'no-store',
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
        return {
            success: false as const,
            error: normalizeLawsError(response.status, payload),
            statusCode: response.status,
            data: null,
        }
    }

    return {
        success: true as const,
        error: null,
        statusCode: response.status,
        data: payload,
    }
}

type ActionResult<T> =
    | {
        success: true
        data: T
        error: null
        statusCode: number
    }
    | {
        success: false
        data: null
        error: string
        statusCode: number
    }

type FinalizePreviewPayload = {
    can_finalize: boolean
    blocking_issues: Array<{
        issue_id: string
        deviation_id: string
        title: string
        severity: string
        status: string
    }>
    decisions_summary: Record<string, number>
    v3_text_preview: string
    v3_text_length: number
    v2_text_length: number
    estimated_changes: number
}

type FinalizeRoundPayload = {
    version_id: string
    version_number: number
    v3_text_preview: string
    decisions_summary: Record<string, number>
    next_action: string
}

function resolveActionError(payload: unknown, fallback: string) {
    if (payload && typeof payload === 'object') {
        const detail = (payload as { detail?: unknown }).detail
        if (typeof detail === 'string' && detail.trim()) {
            return detail
        }
        const message = (payload as { message?: unknown }).message
        if (typeof message === 'string' && message.trim()) {
            return message
        }
    }
    return fallback
}

export async function searchLaws(
    query: string,
    filters?: { category?: string; law_short?: string; contract_relevance?: 'high' | 'medium' | 'low'; contract_type?: string },
    effectiveAsOf?: string,
    limit: number = 10,
    context?: {
        source_type?: string;
        title?: string | null;
        impact_analysis?: string | null;
        v1_text?: string | null;
        v2_text?: string | null;
        severity?: string | null;
        playbook_violation?: string | null;
    },
) {
    return fetchLawsApi('/api/v1/laws/search', {
        method: 'POST',
        body: JSON.stringify({
            query,
            filters,
            context: context || null,
            effective_as_of: effectiveAsOf || null,
            limit,
        }),
    })
}

export async function citationLookup(text: string, effectiveAsOf?: string) {
    return fetchLawsApi('/api/v1/laws/citation', {
        method: 'POST',
        body: JSON.stringify({
            text,
            effective_as_of: effectiveAsOf || null,
        }),
    })
}

export async function getPasalDetail(nodeId: string, effectiveAsOf?: string) {
    const query = effectiveAsOf ? `?effective_as_of=${encodeURIComponent(effectiveAsOf)}` : ''
    return fetchLawsApi(`/api/v1/laws/pasal/${nodeId}${query}`, {
        method: 'GET',
    })
}

export async function getLawCoverage() {
    return fetchLawsApi('/api/v1/laws/coverage', {
        method: 'GET',
    })
}

export async function previewFinalizeRound(contractId: string): Promise<ActionResult<FinalizePreviewPayload>> {
    try {
        const { getToken } = await auth()
        const token = await getToken()
        if (!token) {
            return {
                success: false,
                data: null,
                error: 'Authentication required to preview finalize round.',
                statusCode: 401,
            }
        }

        const response = await fetch(`${INTERNAL_API_URL}/api/v1/negotiation/${contractId}/finalize-preview`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            cache: 'no-store',
            next: { revalidate: 0 },
        })

        const payload: unknown = await response.json().catch(() => ({}))
        if (!response.ok) {
            return {
                success: false,
                data: null,
                error: resolveActionError(payload, 'Failed to preview finalize round'),
                statusCode: response.status,
            }
        }

        return {
            success: true,
            data: payload as FinalizePreviewPayload,
            error: null,
            statusCode: response.status,
        }
    } catch (error: unknown) {
        console.error('Preview finalize round action error:', error)
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to preview finalize round',
            statusCode: 500,
        }
    }
}

export async function finalizeRound(
    contractId: string,
    allowPartial: boolean = false,
    confirmationNote?: string,
): Promise<ActionResult<FinalizeRoundPayload>> {
    try {
        const { getToken } = await auth()
        const token = await getToken()
        if (!token) {
            return {
                success: false,
                data: null,
                error: 'Authentication required to finalize this round.',
                statusCode: 401,
            }
        }

        const response = await fetch(`${INTERNAL_API_URL}/api/v1/negotiation/${contractId}/finalize-round`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                allow_partial: allowPartial,
                confirmation_note: confirmationNote || null,
            }),
            cache: 'no-store',
            next: { revalidate: 0 },
        })

        const payload: unknown = await response.json().catch(() => ({}))
        if (!response.ok) {
            return {
                success: false,
                data: null,
                error: resolveActionError(payload, 'Failed to finalize round'),
                statusCode: response.status,
            }
        }

        return {
            success: true,
            data: payload as FinalizeRoundPayload,
            error: null,
            statusCode: response.status,
        }
    } catch (error: unknown) {
        console.error('Finalize round action error:', error)
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to finalize round',
            statusCode: 500,
        }
    }
}

export async function exportContractVersion(
    contractId: string,
    versionId: string,
    format: 'docx' | 'pdf',
) {
    const { getToken } = await auth()
    const token = await getToken()

    const response = await fetch(
        `${INTERNAL_API_URL}/api/v1/contracts/${contractId}/versions/${versionId}/export?format=${format}`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            cache: 'no-store',
        }
    )

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.detail || 'Failed to export contract version')
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return {
        base64: buffer.toString('base64'),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        filename: response.headers.get('content-disposition') || '',
    }
}
