'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000'

// 1. Chat Action
export async function chatWithClause(question: string) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        throw new Error("Unauthorized: No tenant or user ID found.")
    }

    try {
        const token = await getToken()
        
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://173.212.240.143:8000'}/api/v1/ai/task-assistant`, {
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
        
        const backendUrl = process.env.NEXT_PUBLIC_API_URL || process.env.FASTAPI_URL || 'http://173.212.240.143:8000';
        const targetEndpoint = `${backendUrl}/api/chat/clause-assistant`;
        
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

        const response = await fetch(`${FASTAPI_URL}/api/upload`, {
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
export async function triggerSmartIngestion(formData: FormData, matterId: string, contractId: string) {
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
        backendFormData.append('matter_id', matterId)
        backendFormData.append('contract_id', contractId)

        const response = await fetch(`${FASTAPI_URL}/api/upload`, {
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

// 4. Confirm War Room Version Link
export async function confirmVersionLink(newContractId: string, parentContractId: string) {
    const { userId, orgId, getToken } = await auth()
    const tenantId = orgId || userId

    if (!tenantId) {
        return { success: false, error: "Unauthorized: No tenant or user ID found." }
    }

    try {
        const token = await getToken()
        
        const response = await fetch(`${FASTAPI_URL}/api/upload/confirm-version`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_contract_id: newContractId,
                parent_contract_id: parentContractId
            }),
        })

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
