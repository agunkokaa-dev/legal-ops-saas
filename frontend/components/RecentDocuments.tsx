'use client'

import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTenantSSE } from '@/hooks/useTenantSSE'
import { getPublicApiBase } from '@/lib/public-api-base'
import styles from './RecentDocuments.module.css'

interface ContractListItem {
    id: string
    title: string | null
    risk_level: string | null
    updated_at: string | null
    created_at: string | null
    status: string | null
}

interface ContractListResponse {
    data?: ContractListItem[]
}

const MAX_RECENT_DOCUMENTS = 3

function formatDocumentDate(dateValue: string | null | undefined) {
    if (!dateValue) {
        return 'N/A'
    }

    const parsedDate = new Date(dateValue)
    if (Number.isNaN(parsedDate.getTime())) {
        return 'Invalid Date'
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
    }).format(parsedDate)
}

function getRiskVariant(riskLevel: string | null | undefined) {
    const normalized = (riskLevel || '').toLowerCase().trim()

    switch (normalized) {
        case 'high':
            return { label: 'High', className: styles.riskHigh }
        case 'medium':
            return { label: 'Medium', className: styles.riskMedium }
        case 'low':
            return { label: 'Low', className: styles.riskLow }
        case 'safe':
            return { label: 'Safe', className: styles.riskSafe }
        default:
            return { label: 'Pending', className: styles.riskPending }
    }
}

export default function RecentDocuments() {
    const { userId, getToken } = useAuth()
    const [documents, setDocuments] = useState<ContractListItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    const mountedRef = useRef(true)

    useEffect(() => {
        return () => {
            mountedRef.current = false
            abortRef.current?.abort()
        }
    }, [])

    const fetchDocuments = useCallback(async () => {
        if (!mountedRef.current) {
            return
        }

        if (!userId) {
            setDocuments([])
            setError(null)
            setIsLoading(false)
            return
        }

        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        setError(null)

        try {
            const token = await getToken()
            if (!token) {
                throw new Error('Missing authentication token.')
            }

            const apiUrl = getPublicApiBase()
            const response = await fetch(
                `${apiUrl}/api/v1/contracts?tab=active&limit=${MAX_RECENT_DOCUMENTS}&sort_by=updated_at&sort_order=desc`,
                {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    cache: 'no-store',
                    signal: controller.signal,
                }
            )

            if (!response.ok) {
                let backendError = `HTTP ${response.status}`
                try {
                    const errorPayload = await response.json()
                    backendError = errorPayload.detail || backendError
                } catch {
                    // Ignore JSON parse failures and surface the HTTP status.
                }
                throw new Error(backendError)
            }

            const payload = (await response.json()) as ContractListResponse | ContractListItem[]
            const data = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.data)
                    ? payload.data
                    : []

            if (!controller.signal.aborted && mountedRef.current) {
                setDocuments(data.slice(0, MAX_RECENT_DOCUMENTS))
            }
        } catch (err) {
            if (controller.signal.aborted) {
                return
            }

            const message = err instanceof Error ? err.message : 'Failed to load recent documents.'
            if (mountedRef.current) {
                setDocuments([])
                setError(message)
            }
        } finally {
            if (!controller.signal.aborted && mountedRef.current) {
                setIsLoading(false)
            }
        }
    }, [getToken, userId])

    useEffect(() => {
        void fetchDocuments()
    }, [fetchDocuments])

    useTenantSSE({
        enabled: Boolean(userId),
        onContractCreated: () => {
            void fetchDocuments()
        },
        onContractStatusChanged: () => {
            void fetchDocuments()
        },
        onContractExecuted: () => {
            void fetchDocuments()
        },
    })

    const rows = useMemo(
        () =>
            documents.map((document) => {
                const risk = getRiskVariant(document.risk_level)
                return {
                    id: document.id,
                    title: (document.title || 'Untitled Document').trim() || 'Untitled Document',
                    dateLabel: formatDocumentDate(document.updated_at || document.created_at),
                    riskLabel: risk.label,
                    riskClassName: risk.className,
                }
            }),
        [documents]
    )

    return (
        <section className={styles.card}>
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>Recent Documents</h3>
                    <p className={styles.subtitle}>3 most recently updated contracts</p>
                </div>
                <Link href="/dashboard/documents" className={styles.viewAll}>
                    View All Documents
                </Link>
            </div>

            <div className={styles.tableWrap}>
                <div className={styles.list}>
                    <div className={styles.columnHeader} aria-hidden="true">
                        <span className={styles.columnTitle}>Title</span>
                        <span className={styles.columnDate}>Date</span>
                        <span className={styles.columnRisk}>Risk Status</span>
                        <span className={styles.columnActions}>Actions</span>
                    </div>

                    {isLoading ? (
                        <div className={styles.stateCell}>Loading recent documents...</div>
                    ) : error ? (
                        <div className={styles.stateCell}>
                            {error}
                            <button type="button" className={styles.retryButton} onClick={() => void fetchDocuments()}>
                                Retry
                            </button>
                        </div>
                    ) : rows.length === 0 ? (
                        <div className={styles.stateCell}>No recent documents found.</div>
                    ) : (
                        <div className={styles.rows}>
                            {rows.map((row) => (
                                <Link
                                    key={row.id}
                                    href={`/dashboard/contracts/${row.id}`}
                                    className={styles.rowLink}
                                >
                                    <span className={`${styles.cell} ${styles.titleCell}`}>
                                        <span className={styles.documentAccent} aria-hidden="true" />
                                        <span className={styles.documentTitle}>{row.title}</span>
                                    </span>
                                    <span className={`${styles.cell} ${styles.dateCell}`}>{row.dateLabel}</span>
                                    <span className={`${styles.cell} ${styles.riskCell}`}>
                                        <span className={`${styles.riskBadge} ${row.riskClassName}`}>{row.riskLabel}</span>
                                    </span>
                                    <span className={`${styles.cell} ${styles.actionsCell}`}>
                                        <span className={styles.actionChip}>Open</span>
                                    </span>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
