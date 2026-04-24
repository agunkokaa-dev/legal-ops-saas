'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPublicApiBase } from '@/lib/public-api-base'
import { useSSESession } from '@/hooks/useSSESession'

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
    return getPublicApiBase()
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
    const { sseToken, refresh: refreshSession } = useSSESession()
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

    const connect = useCallback(() => {
        if (!enabled || !sseToken) {
            return
        }

        eventSourceRef.current?.close()

        const source = new EventSource(
            `${getApiUrl()}/api/v1/events/tenant/stream?sse_token=${encodeURIComponent(sseToken)}`
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
            if (eventSourceRef.current !== source) {
                return
            }

            setIsConnected(false)
            handlersRef.current.onDisconnected?.()
            source.close()
            eventSourceRef.current = null
            void refreshSession()
        }
    }, [enabled, refreshSession, routeEvent, sseToken])

    useEffect(() => {
        if (!enabled) {
            eventSourceRef.current?.close()
            eventSourceRef.current = null
            setIsConnected(false)
            return
        }

        if (!sseToken) {
            return
        }

        connect()

        return () => {
            eventSourceRef.current?.close()
            eventSourceRef.current = null
            setIsConnected(false)
        }
    }, [connect, enabled, sseToken])

    return { isConnected: enabled && isConnected }
}
