'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import Link from 'next/link'
import UploadDocModal from './UploadDocModal'
import DeleteDocButton from './DeleteDocButton'
import { getPublicApiBase } from '@/lib/public-api-base'

function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    })
}

type MatterDocument = {
    id: string
    title: string
    document_category?: string | null
    risk_level?: string | null
    end_date?: string | null
    created_at: string
    file_url?: string | null
}

export default function DocumentsTab({ matterId }: { matterId: string }) {
    const { getToken } = useAuth()
    const [docs, setDocs] = useState<MatterDocument[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        const fetchDocuments = async () => {
            try {
                setIsLoading(true)
                setError(null)

                const token = await getToken()
                const apiUrl = getPublicApiBase()
                const res = await fetch(`${apiUrl}/api/v1/matters/${matterId}/contracts`, {
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

                const payload = await res.json()
                const data = Array.isArray(payload)
                    ? payload
                    : Array.isArray(payload?.data)
                        ? payload.data
                        : []

                if (!cancelled) {
                    setDocs(data)
                }
            } catch (err: any) {
                console.error('Matter documents fetch failed:', err)
                if (!cancelled) {
                    setDocs([])
                    setError(err?.message || 'Failed to load matter documents.')
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        fetchDocuments()

        return () => {
            cancelled = true
        }
    }, [getToken, matterId])

    return (
        <div className="bg-surface border border-surface-border rounded-lg overflow-hidden mt-6">
            <div className="p-6 border-b border-surface-border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-background-dark/30">
                <div>
                    <h2 className="text-lg font-display text-white">Documents</h2>
                    <p className="text-sm text-text-muted mt-1">Manage files associated with this matter</p>
                </div>
                <UploadDocModal matterId={matterId} existingDocs={docs.map(doc => ({ id: doc.id, title: doc.title }))} />
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                    <thead className="bg-transparent text-text-muted text-[10px] uppercase tracking-widest border-b border-surface-border">
                        <tr>
                            <th className="px-6 py-4 font-semibold">Name</th>
                            <th className="px-6 py-4 font-semibold">Category</th>
                            <th className="px-6 py-4 font-semibold">Risk Level</th>
                            <th className="px-6 py-4 font-semibold">End Date</th>
                            <th className="px-6 py-4 font-semibold">Date Uploaded</th>
                            <th className="px-6 py-4 font-semibold text-right">Delete</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border/50 text-sm">
                        {isLoading ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-text-muted">
                                    Loading documents...
                                </td>
                            </tr>
                        ) : error ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-red-400">
                                    {error}
                                </td>
                            </tr>
                        ) : docs.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-text-muted">
                                    No documents uploaded yet.
                                </td>
                            </tr>
                        ) : (
                            docs.map((doc) => (
                                <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <span className="material-symbols-outlined text-primary text-[20px]">
                                                description
                                            </span>
                                            <Link
                                                href={`/dashboard/contracts/${doc.id}`}
                                                className="font-medium text-white hover:text-[#B8B8B8] transition-colors hover:underline cursor-pointer"
                                                title={doc.title}
                                            >
                                                {doc.title.length > 40 ? doc.title.substring(0, 40) + '...' : doc.title}
                                            </Link>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-surface-border text-text-muted border border-white/5">
                                            {doc.document_category || 'Uncategorized'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`font-medium ${doc.risk_level === 'High' ? 'text-red-400' :
                                            doc.risk_level === 'Medium' ? 'text-yellow-400' :
                                                doc.risk_level === 'Low' ? 'text-green-400' :
                                                    'text-text-muted'
                                            }`}>
                                            {doc.risk_level || 'Pending'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-text-muted">
                                        {doc.end_date || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-text-muted">
                                        {formatDate(doc.created_at)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                            <DeleteDocButton documentId={doc.id} fileUrl={doc.file_url || ''} matterId={matterId} />
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
