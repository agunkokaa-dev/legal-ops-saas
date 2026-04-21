'use client'

import { useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import { getPublicApiBase } from '@/lib/public-api-base'

function readFilenameFromDisposition(disposition: string | null, fallback: string): string {
    if (!disposition) return fallback
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
        return decodeURIComponent(utf8Match[1])
    }
    const plainMatch = disposition.match(/filename="?([^"]+)"?/i)
    return plainMatch?.[1] || fallback
}

export default function DownloadButton({
    contractId,
    versionId,
    versionNumber,
    contractTitle,
    format,
    className = '',
}: {
    contractId: string
    versionId: string
    versionNumber?: number | null
    contractTitle?: string | null
    format: 'docx' | 'pdf'
    className?: string
}) {
    const { getToken } = useAuth()
    const [isLoading, setIsLoading] = useState(false)

    const handleClick = async () => {
        setIsLoading(true)
        try {
            const token = await getToken()
            if (!token) {
                throw new Error('Authentication required to download this version.')
            }

            const apiBase = getPublicApiBase()
            const response = await fetch(
                `${apiBase}/api/v1/contracts/${contractId}/versions/${versionId}/export?format=${format}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            )

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}))
                throw new Error(payload?.detail || 'Export failed')
            }

            const blob = await response.blob()
            const fallbackName = `${(contractTitle || 'contract').replace(/\s+/g, '_')}_V${versionNumber || 'X'}.${format}`
            const filename = readFilenameFromDisposition(
                response.headers.get('content-disposition'),
                fallbackName,
            )

            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)

            toast.success(`${format.toUpperCase()} downloaded`)
        } catch (error: any) {
            toast.error(error?.message || 'Download failed. Please try again.')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            className={className || 'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60'}
        >
            <span className="material-symbols-outlined text-sm">download</span>
            {isLoading ? 'Downloading...' : `Download ${format.toUpperCase()}`}
        </button>
    )
}
