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
    message 
}: { 
    contractId: string, 
    matterId?: string, 
    message: string 
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
                userId: userId || null
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
