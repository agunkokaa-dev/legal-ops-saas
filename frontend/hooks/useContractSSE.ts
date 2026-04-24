'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPublicApiBase } from '@/lib/public-api-base'
import { useSSESession } from '@/hooks/useSSESession'

export interface ContractSSEEvent {
    event_id: string
    event_type: string
    contract_id: string | null
    timestamp: string
    data: Record<string, unknown>
}

type EventHandler = (event: ContractSSEEvent) => void

interface UseContractSSEOptions {
    contractId: string
    enabled?: boolean
    onEvent?: EventHandler
    onConnected?: () => void
    onDisconnected?: () => void
    onPipelineProgress?: EventHandler
    onPipelineCompleted?: EventHandler
    onPipelineFailed?: EventHandler
    onDiffStarted?: EventHandler
    onDiffCompleted?: EventHandler
    onDiffFailed?: EventHandler
    onSigningUpdate?: EventHandler
    onStatusChanged?: EventHandler
    onNegotiationIssueUpdated?: EventHandler
    onRoundCreated?: EventHandler
    pollFallback?: () => void | Promise<void>
    fallbackIntervalMs?: number
}

const CONTRACT_EVENT_TYPES = [
    'connected',
    'pipeline.queued',
    'pipeline.started',
    'pipeline.agent_started',
    'pipeline.agent_completed',
    'pipeline.agent_failed',
    'pipeline.completed',
    'pipeline.failed',
    'diff.queued',
    'diff.started',
    'diff.completed',
    'diff.failed',
    'contract.status_changed',
    'contract.risk_updated',
    'signing.initiated',
    'signing.signer_notified',
    'signing.signer_viewed',
    'signing.signer_signed',
    'signing.signer_rejected',
    'signing.completed',
    'signing.expired',
    'signing.emeterai_affixed',
    'negotiation.issue_updated',
    'negotiation.round_created',
    'debate.started',
    'debate.turn_completed',
    'debate.verdict_ready',
    'debate.completed',
    'debate.failed',
    'obligation.activated',
    'task.created',
] as const

function getApiUrl() {
    return getPublicApiBase()
}

export function useContractSSE({
    contractId,
    enabled = true,
    onEvent,
    onConnected,
    onDisconnected,
    onPipelineProgress,
    onPipelineCompleted,
    onPipelineFailed,
    onDiffStarted,
    onDiffCompleted,
    onDiffFailed,
    onSigningUpdate,
    onStatusChanged,
    onNegotiationIssueUpdated,
    onRoundCreated,
    pollFallback,
    fallbackIntervalMs = 5000,
}: UseContractSSEOptions) {
    const { sseToken, refresh: refreshSession } = useSSESession()
    const eventSourceRef = useRef<EventSource | null>(null)
    const failCountRef = useRef(0)
    const handlersRef = useRef({
        onEvent,
        onConnected,
        onDisconnected,
        onPipelineProgress,
        onPipelineCompleted,
        onPipelineFailed,
        onDiffStarted,
        onDiffCompleted,
        onDiffFailed,
        onSigningUpdate,
        onStatusChanged,
        onNegotiationIssueUpdated,
        onRoundCreated,
    })

    const [isConnected, setIsConnected] = useState(false)
    const [lastEvent, setLastEvent] = useState<ContractSSEEvent | null>(null)
    const [fallbackContractId, setFallbackContractId] = useState<string | null>(null)
    const isFallbackPolling = fallbackContractId === contractId

    useEffect(() => {
        handlersRef.current = {
            onEvent,
            onConnected,
            onDisconnected,
            onPipelineProgress,
            onPipelineCompleted,
            onPipelineFailed,
            onDiffStarted,
            onDiffCompleted,
            onDiffFailed,
            onSigningUpdate,
            onStatusChanged,
            onNegotiationIssueUpdated,
            onRoundCreated,
        }
    }, [
        onEvent,
        onConnected,
        onDisconnected,
        onPipelineProgress,
        onPipelineCompleted,
        onPipelineFailed,
        onDiffStarted,
        onDiffCompleted,
        onDiffFailed,
        onSigningUpdate,
        onStatusChanged,
        onNegotiationIssueUpdated,
        onRoundCreated,
    ])

    const routeEvent = useCallback((event: ContractSSEEvent) => {
        const handlers = handlersRef.current
        handlers.onEvent?.(event)

        switch (event.event_type) {
            case 'pipeline.queued':
            case 'pipeline.started':
            case 'pipeline.agent_started':
            case 'pipeline.agent_completed':
                handlers.onPipelineProgress?.(event)
                break
            case 'pipeline.completed':
                handlers.onPipelineCompleted?.(event)
                break
            case 'pipeline.failed':
                handlers.onPipelineFailed?.(event)
                break
            case 'diff.queued':
            case 'diff.started':
                handlers.onDiffStarted?.(event)
                break
            case 'diff.completed':
                handlers.onDiffCompleted?.(event)
                break
            case 'diff.failed':
                handlers.onDiffFailed?.(event)
                break
            case 'contract.status_changed':
                handlers.onStatusChanged?.(event)
                break
            case 'signing.initiated':
            case 'signing.signer_notified':
            case 'signing.signer_viewed':
            case 'signing.signer_signed':
            case 'signing.signer_rejected':
            case 'signing.completed':
            case 'signing.expired':
            case 'signing.emeterai_affixed':
            case 'obligation.activated':
                handlers.onSigningUpdate?.(event)
                break
            case 'negotiation.issue_updated':
                handlers.onNegotiationIssueUpdated?.(event)
                break
            case 'negotiation.round_created':
                handlers.onRoundCreated?.(event)
                break
        }
    }, [])

    const connect = useCallback(() => {
        if (!enabled || !contractId || isFallbackPolling || !sseToken) {
            return
        }

        eventSourceRef.current?.close()

        const source = new EventSource(
            `${getApiUrl()}/api/v1/events/contracts/${contractId}/stream?sse_token=${encodeURIComponent(sseToken)}`
        )
        eventSourceRef.current = source

        const handleMessage = (message: MessageEvent<string>) => {
            try {
                const parsed = JSON.parse(message.data) as ContractSSEEvent
                setLastEvent(parsed)
                routeEvent(parsed)
            } catch (error) {
                console.error('[SSE] Failed to parse contract event', error)
            }
        }

        for (const eventType of CONTRACT_EVENT_TYPES) {
            source.addEventListener(eventType, handleMessage as EventListener)
        }

        source.onmessage = handleMessage
        source.onopen = () => {
            failCountRef.current = 0
            setIsConnected(true)
            handlersRef.current.onConnected?.()
        }
        source.onerror = () => {
            if (eventSourceRef.current !== source) {
                return
            }

            failCountRef.current += 1
            setIsConnected(false)
            handlersRef.current.onDisconnected?.()
            source.close()
            eventSourceRef.current = null

            if (failCountRef.current > 3) {
                console.warn('[SSE] Falling back to polling for contract stream', contractId)
                setFallbackContractId(contractId)
                return
            }

            void refreshSession()
        }
    }, [contractId, enabled, isFallbackPolling, refreshSession, routeEvent, sseToken])

    useEffect(() => {
        failCountRef.current = 0
        if (!enabled || !contractId) {
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
    }, [connect, contractId, enabled, sseToken])

    useEffect(() => {
        if (!enabled || !isFallbackPolling || !pollFallback) {
            return
        }

        void pollFallback()
        const interval = window.setInterval(() => {
            console.warn('[SSE] Using polling fallback for contract stream', contractId)
            void pollFallback()
        }, fallbackIntervalMs)

        return () => window.clearInterval(interval)
    }, [contractId, enabled, fallbackIntervalMs, isFallbackPolling, pollFallback])

    return {
        isConnected: enabled && isConnected,
        isFallbackPolling,
        lastEvent,
    }
}
