'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { getPublicApiBase } from '@/lib/public-api-base'
import GenealogyGraph from './GenealogyGraph'

type GenealogyPayload = {
    documents?: any[]
    relationships?: any[]
    data?: {
        documents?: any[]
        relationships?: any[]
    }
}

export default function MatterGenealogyPanel({ matterId }: { matterId: string }) {
    const { getToken } = useAuth()
    const [documents, setDocuments] = useState<any[]>([])
    const [relationships, setRelationships] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        const fetchGenealogy = async () => {
            try {
                setIsLoading(true)
                setError(null)

                const token = await getToken()
                const apiUrl = getPublicApiBase()
                const res = await fetch(`${apiUrl}/api/v1/matters/${matterId}/genealogy`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    cache: 'no-store',
                })

                if (!res.ok) {
                    let detail = `HTTP ${res.status}`
                    try {
                        const body = await res.json()
                        detail = body.detail || detail
                    } catch {
                        // Ignore parse failures.
                    }
                    throw new Error(detail)
                }

                const payload: GenealogyPayload = await res.json()
                const nextDocuments = Array.isArray(payload?.documents)
                    ? payload.documents
                    : Array.isArray(payload?.data?.documents)
                        ? payload.data!.documents!
                        : []
                const nextRelationships = Array.isArray(payload?.relationships)
                    ? payload.relationships
                    : Array.isArray(payload?.data?.relationships)
                        ? payload.data!.relationships!
                        : []

                if (!cancelled) {
                    setDocuments(nextDocuments)
                    setRelationships(nextRelationships)
                }
            } catch (err: any) {
                console.error('Matter genealogy fetch failed:', err)
                if (!cancelled) {
                    setDocuments([])
                    setRelationships([])
                    setError(err?.message || 'Failed to load matter genealogy.')
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        fetchGenealogy()

        return () => {
            cancelled = true
        }
    }, [getToken, matterId])

    if (isLoading) {
        return (
            <div className="w-full h-full min-h-[500px] bg-lux-black border border-lux-border rounded-lg relative overflow-hidden flex items-center justify-center text-lux-text-muted">
                Loading genealogy...
            </div>
        )
    }

    if (error) {
        return (
            <div className="w-full h-full min-h-[500px] bg-lux-black border border-lux-border rounded-lg relative overflow-hidden flex items-center justify-center text-red-400 px-6 text-center">
                {error}
            </div>
        )
    }

    return <GenealogyGraph documents={documents} relationships={relationships} />
}
