'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface TenantSSEEvent {
    event_id: string
    event_type: string
    contract_id: string | null
    timestamp: string
    data: Record<string, unknown>
}

interface UseTenantSSEOptions {
    enabled?: boolean
    onEvent?: (event: TenantSSEEvent) => void
    onConnected?: () => void
    onDisconnected?: () => void
    onContractCreated?: (event: TenantSSEEvent) => void
    onContractStatusChanged?: (event: TenantSSEEvent) => void
    onContractExecuted?: (event: TenantSSEEvent) => void
    onTaskCreated?: (event: TenantSSEEvent) => void
}

const TENANT_EVENT_TYPES = [
    'connected',
    'contract.created',
    'contract.status_changed',
    'contract.executed',
    'task.created',
] as const

function getApiUrl() {
    return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')
}

export function useTenantSSE({
    enabled = true,
    onEvent,
    onConnected,
    onDisconnected,
    onContractCreated,
    onContractStatusChanged,
    onContractExecuted,
    onTaskCreated,
}: UseTenantSSEOptions) {
    const { getToken } = useAuth()
    const eventSourceRef = useRef<EventSource | null>(null)
    const handlersRef = useRef({
        onEvent,
        onConnected,
        onDisconnected,
        onContractCreated,
        onContractStatusChanged,
        onContractExecuted,
        onTaskCreated,
    })

    const [isConnected, setIsConnected] = useState(false)

    useEffect(() => {
        handlersRef.current = {
            onEvent,
            onConnected,
            onDisconnected,
            onContractCreated,
            onContractStatusChanged,
            onContractExecuted,
            onTaskCreated,
        }
    }, [
        onEvent,
        onConnected,
        onDisconnected,
        onContractCreated,
        onContractStatusChanged,
        onContractExecuted,
        onTaskCreated,
    ])

    const routeEvent = useCallback((event: TenantSSEEvent) => {
        const handlers = handlersRef.current
        handlers.onEvent?.(event)

        switch (event.event_type) {
            case 'contract.created':
                handlers.onContractCreated?.(event)
                break
            case 'contract.status_changed':
                handlers.onContractStatusChanged?.(event)
                break
            case 'contract.executed':
                handlers.onContractExecuted?.(event)
                break
            case 'task.created':
                handlers.onTaskCreated?.(event)
                break
        }
    }, [])

    const connect = useCallback(async () => {
        if (!enabled) {
            return
        }

        const token = await getToken()
        if (!token) {
            return
        }

        eventSourceRef.current?.close()

        const source = new EventSource(
            `${getApiUrl()}/api/v1/events/tenant/stream?token=${encodeURIComponent(token)}`
        )
        eventSourceRef.current = source

        const handleMessage = (message: MessageEvent<string>) => {
            try {
                routeEvent(JSON.parse(message.data) as TenantSSEEvent)
            } catch (error) {
                console.error('[SSE] Failed to parse tenant event', error)
            }
        }

        for (const eventType of TENANT_EVENT_TYPES) {
            source.addEventListener(eventType, handleMessage as EventListener)
        }

        source.onmessage = handleMessage
        source.onopen = () => {
            setIsConnected(true)
            handlersRef.current.onConnected?.()
        }
        source.onerror = () => {
            setIsConnected(false)
            handlersRef.current.onDisconnected?.()
        }
    }, [enabled, getToken, routeEvent])

    useEffect(() => {
        if (!enabled) {
            eventSourceRef.current?.close()
            return
        }

        void connect()
        const refreshTimer = window.setInterval(() => {
            void connect()
        }, 50 * 60 * 1000)

        return () => {
            window.clearInterval(refreshTimer)
            eventSourceRef.current?.close()
            eventSourceRef.current = null
            setIsConnected(false)
        }
    }, [connect, enabled])

    return { isConnected: enabled && isConnected }
}
