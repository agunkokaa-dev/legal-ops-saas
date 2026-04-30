'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { getServerApiBase } from '@/lib/server-api-base'

const INTERNAL_API_URL = getServerApiBase()

type ActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string }

async function onboardingRequest<T>(path: string, init: RequestInit = {}): Promise<ActionResult<T>> {
    const { userId, getToken } = await auth()
    if (!userId) {
        return { success: false, error: 'Unauthorized' }
    }

    const token = await getToken()
    if (!token) {
        return { success: false, error: 'Authentication token unavailable' }
    }

    try {
        const headers = init.headers as Record<string, string> | undefined
        const response = await fetch(`${INTERNAL_API_URL}${path}`, {
            ...init,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                ...(headers || {}),
            },
            cache: 'no-store',
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
            return {
                success: false,
                error: payload?.detail || payload?.message || `Request failed (HTTP ${response.status})`,
            }
        }

        return { success: true, data: payload as T }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Onboarding request failed'
        return { success: false, error: message }
    }
}

export async function getOnboardingStatus() {
    return onboardingRequest<{
        has_samples: boolean
        sample_count: number
        total_contracts: number
    }>('/api/v1/onboarding/status')
}

export async function loadSampleContracts() {
    const result = await onboardingRequest<{
        loaded_count: number
        contract_ids: string[]
        already_loaded?: boolean
        skipped?: boolean
        detail?: string
    }>('/api/v1/onboarding/load-samples', { method: 'POST' })

    if (result.success) {
        revalidatePath('/dashboard')
        revalidatePath('/dashboard/documents')
    }

    return result
}

export async function clearSampleContracts() {
    const result = await onboardingRequest<{
        status: string
        deleted_count: number
    }>('/api/v1/onboarding/clear-samples', { method: 'DELETE' })

    if (result.success) {
        revalidatePath('/dashboard')
        revalidatePath('/dashboard/documents')
    }

    return result
}
