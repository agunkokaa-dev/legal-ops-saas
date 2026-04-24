'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPublicApiBase } from '@/lib/public-api-base'

const REFRESH_INTERVAL_MS = 4.5 * 60 * 1000

interface SSESession {
    token: string
    expiresAt: number
}

function getApiUrl() {
    return getPublicApiBase()
}

export function useSSESession(): {
    sseToken: string | null
    error: string | null
    refresh: () => Promise<string | null>
} {
    const { getToken } = useAuth()
    const [session, setSession] = useState<SSESession | null>(null)
    const [error, setError] = useState<string | null>(null)
    const timerRef = useRef<number | null>(null)

    const refresh = useCallback(async () => {
        try {
            const clerkToken = await getToken()
            if (!clerkToken) {
                setSession(null)
                return null
            }

            const response = await fetch(`${getApiUrl()}/api/v1/events/session`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${clerkToken}`,
                },
            })

            if (!response.ok) {
                throw new Error(`Exchange failed: ${response.status}`)
            }

            const data = await response.json()
            const expiresInSeconds =
                typeof data.expires_in === 'number' && data.expires_in > 0
                    ? data.expires_in
                    : REFRESH_INTERVAL_MS / 1000
            const nextSession = {
                token: String(data.sse_token),
                expiresAt: Date.now() + expiresInSeconds * 1000,
            }

            setSession(nextSession)
            setError(null)
            return nextSession.token
        } catch (err) {
            setError(err instanceof Error ? err.message : 'SSE session error')
            return null
        }
    }, [getToken])

    useEffect(() => {
        void refresh()
        timerRef.current = window.setInterval(() => {
            void refresh()
        }, REFRESH_INTERVAL_MS)

        return () => {
            if (timerRef.current !== null) {
                window.clearInterval(timerRef.current)
            }
        }
    }, [refresh])

    return {
        sseToken: session?.token ?? null,
        error,
        refresh,
    }
}
