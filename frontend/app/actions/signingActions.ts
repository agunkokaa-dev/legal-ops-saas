'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { getPublicApiBase } from '@/lib/public-api-base'
import { getServerApiBase } from '@/lib/server-api-base'

const SERVER_API_URL = getServerApiBase()
const PUBLIC_API_URL = getPublicApiBase()

async function getAuthHeaders() {
    const { getToken } = await auth()
    const token = await getToken()
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    }
}

// ── Run Pre-Sign Compliance Checklist ──

export async function runPresignChecklist(contractId: string) {
    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SERVER_API_URL}/api/v1/signing/${contractId}/checklist`, {
            method: 'POST',
            headers,
        })
        const data = await res.json()
        if (!res.ok) return { error: data.detail || 'Checklist failed' }
        return { data }
    } catch (e: any) {
        return { error: e.message || 'Failed to run checklist' }
    }
}

// ── Initiate Signing Ceremony ──

export interface SignerInput {
    full_name: string
    email: string
    phone?: string
    privy_id?: string
    organization?: string
    role?: string
    title?: string
    signing_order_index?: number
    signing_page?: number
    signing_position_x?: number
    signing_position_y?: number
}

export interface InitiateSigningPayload {
    signers: SignerInput[]
    signing_order?: 'parallel' | 'sequential'
    signature_type?: 'certified' | 'simple'
    require_emeterai?: boolean
    emeterai_page?: number
    expires_in_days?: number
    message_to_signers?: string
}

export async function initiateSigning(contractId: string, payload: InitiateSigningPayload) {
    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SERVER_API_URL}/api/v1/signing/${contractId}/initiate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) return { error: data.detail || 'Failed to initiate signing' }
        revalidatePath(`/dashboard/contracts/${contractId}`)
        revalidatePath(`/dashboard/contracts/${contractId}/signing`)
        return { data }
    } catch (e: any) {
        return { error: e.message || 'Failed to initiate signing' }
    }
}

// ── Get Signing Status ──

export async function getSigningStatus(contractId: string) {
    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SERVER_API_URL}/api/v1/signing/${contractId}/status`, {
            method: 'GET',
            headers,
            cache: 'no-store',
        })
        const data = await res.json()
        if (!res.ok) return { error: data.detail || 'Failed to fetch signing status' }
        return { data }
    } catch (e: any) {
        return { error: e.message || 'Failed to fetch signing status' }
    }
}

// ── Cancel Signing Session ──

export async function cancelSigning(contractId: string, reason: string = '') {
    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SERVER_API_URL}/api/v1/signing/${contractId}/cancel`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ reason }),
        })
        const data = await res.json()
        if (!res.ok) return { error: data.detail || 'Failed to cancel signing' }
        revalidatePath(`/dashboard/contracts/${contractId}`)
        revalidatePath(`/dashboard/contracts/${contractId}/signing`)
        return { data }
    } catch (e: any) {
        return { error: e.message || 'Failed to cancel signing' }
    }
}

// ── Send Reminder to Signer ──

export async function sendSignerReminder(contractId: string, signerId: string) {
    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SERVER_API_URL}/api/v1/signing/${contractId}/remind/${signerId}`, {
            method: 'POST',
            headers,
        })
        const data = await res.json()
        if (!res.ok) return { error: data.detail || 'Failed to send reminder' }
        return { data }
    } catch (e: any) {
        return { error: e.message || 'Failed to send reminder' }
    }
}

// ── Finalize Contract for Signing (from War Room) ──

export async function finalizeContractForSigning(contractId: string) {
    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SERVER_API_URL}/api/v1/negotiation/${contractId}/finalize-for-signing`, {
            method: 'POST',
            headers,
        })
        const data = await res.json()
        if (!res.ok) return { error: data.detail || 'Failed to finalize contract' }
        revalidatePath(`/dashboard/contracts/${contractId}`)
        revalidatePath(`/dashboard/contracts/${contractId}/signing`)
        return { data }
    } catch (e: any) {
        return { error: e.message || 'Failed to finalize contract' }
    }
}

// ── Get Signed Document Download URL ──

export async function getSignedDocumentUrl(contractId: string): Promise<string> {
    const { getToken } = await auth()
    const token = await getToken()
    // Returns the direct download endpoint — caller uses as <a href>
    return `${PUBLIC_API_URL}/api/v1/signing/${contractId}/download?token=${token}`
}
