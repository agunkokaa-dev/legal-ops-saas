'use client'

import { useMemo, useState } from 'react'
import type { AssistantSource } from '@/lib/assistantSources'

interface CitationPanelProps {
    citations: AssistantSource[]
    messageIndex: number
}

const SOURCE_TYPE_CONFIG = {
    law: {
        badge: 'bg-[#1C1C1C] text-[#D4D4D4] border-[#2A2A2A]',
        label: 'UU',
        longLabel: 'UU / Peraturan',
    },
    playbook: {
        badge: 'bg-[#1C1C1C] text-[#B8B8B8] border-[#3A3A3A]',
        label: 'Playbook',
        longLabel: 'Playbook',
    },
    document: {
        badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/20',
        label: 'Kontrak',
        longLabel: 'Kontrak',
    },
} as const

function buildFootnoteText(citations: AssistantSource[]): string {
    const lines = ['Catatan Kaki — Sumber Clause Assistant (clause.id)', '']

    citations.forEach((citation, index) => {
        const number = index + 1
        if (citation.type === 'law') {
            lines.push(`[${number}] ${citation.identifier_full || citation.identifier}`)
            if (citation.law_type && citation.number && citation.year) {
                lines.push(`    ${citation.law_type} No. ${citation.number} Tahun ${citation.year}`)
            } else if (citation.short_name) {
                lines.push(`    ${citation.short_name}`)
            }
        } else if (citation.type === 'playbook') {
            lines.push(`[${number}] Playbook Perusahaan — ${citation.identifier}`)
        } else {
            lines.push(`[${number}] ${citation.identifier} (Dokumen Kontrak)`)
        }

        if (citation.body) {
            const quote = citation.body.slice(0, 150).trim()
            lines.push(`    "${quote}${citation.body.length > 150 ? '...' : ''}"`)
        }
        if (citation.official_source_url) {
            lines.push(`    Sumber: ${citation.official_source_url}`)
        }
        lines.push('')
    })

    lines.push('Dihasilkan oleh: clause.id — AI-Powered Contract Intelligence')
    lines.push(
        `Tanggal: ${new Date().toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        })}`
    )

    return lines.join('\n')
}

export function CitationPanel({ citations, messageIndex }: CitationPanelProps) {
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)

    const panelId = `citation-panel-${messageIndex}`
    const counts = useMemo(
        () => ({
            law: citations.filter((citation) => citation.type === 'law').length,
            playbook: citations.filter((citation) => citation.type === 'playbook').length,
            document: citations.filter((citation) => citation.type === 'document').length,
        }),
        [citations]
    )

    if (!citations.length) return null

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(buildFootnoteText(citations))
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            setCopied(false)
        }
    }

    return (
        <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/15">
            <div
                className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-white/[0.03]"
                onClick={() => setExpanded((current) => !current)}
                aria-controls={panelId}
                aria-expanded={expanded}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-neutral-500">format_quote</span>
                    <span className="text-xs font-medium text-neutral-300">
                        {citations.length} Sumber
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                        {(['law', 'playbook', 'document'] as const).map((type) => {
                            const count = counts[type]
                            if (!count) return null
                            const config = SOURCE_TYPE_CONFIG[type]
                            return (
                                <span
                                    key={type}
                                    className={`rounded-full border px-1.5 py-0.5 text-[10px] ${config.badge}`}
                                >
                                    {count} {config.label}
                                </span>
                            )
                        })}
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <button
                        onClick={(event) => {
                            event.stopPropagation()
                            void handleCopy()
                        }}
                        className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[10px] text-neutral-400 transition-colors hover:border-white/20 hover:text-white"
                        title="Copy dalam format footnote dokumen hukum"
                        type="button"
                    >
                        <span className="material-symbols-outlined text-xs">
                            {copied ? 'check' : 'content_copy'}
                        </span>
                        {copied ? 'Tersalin!' : 'Copy Citation'}
                    </button>
                    <span className="material-symbols-outlined text-sm text-neutral-600">
                        {expanded ? 'expand_less' : 'expand_more'}
                    </span>
                </div>
            </div>

            {expanded && (
                <div id={panelId} className="divide-y divide-white/5">
                    {citations.map((citation, index) => {
                        const config = SOURCE_TYPE_CONFIG[citation.type]
                        return (
                            <div key={`${citation.type}-${citation.identifier}-${index}`} className="bg-black/10 px-3 py-3">
                                <div className="flex items-start gap-2">
                                    <span className="mt-0.5 shrink-0 font-mono text-[10px] text-neutral-600">
                                        [{index + 1}]
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-1 flex flex-wrap items-center gap-2">
                                            <span className="text-xs font-semibold text-neutral-100">
                                                {citation.identifier_full || citation.identifier}
                                            </span>
                                            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${config.badge}`}>
                                                {citation.law_type && citation.number && citation.year
                                                    ? `${citation.law_type} ${citation.number}/${citation.year}`
                                                    : config.longLabel}
                                            </span>
                                            {citation.relevance_score != null && (
                                                <span className="text-[9px] text-neutral-500">
                                                    {Math.round(citation.relevance_score * 100)}% relevan
                                                </span>
                                            )}
                                        </div>

                                        {citation.body && (
                                            <p className="line-clamp-3 text-[11px] italic leading-relaxed text-neutral-400">
                                                "{citation.body.slice(0, 220)}{citation.body.length > 220 ? '...' : ''}"
                                            </p>
                                        )}

                                        {citation.official_source_url && (
                                            <a
                                                href={citation.official_source_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#888888]/80 transition-colors hover:text-[#D4D4D4]"
                                            >
                                                <span className="material-symbols-outlined text-xs">open_in_new</span>
                                                Sumber resmi
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
