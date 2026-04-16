'use client'

import React, { useMemo, useState } from 'react'

export interface DebateEvidenceReference {
    type: string
    reference: string
    relevance: string
}

export interface DebateTurn {
    turn_number: number
    role: 'prosecutor' | 'defender' | 'judge'
    agent_name: string
    model: string
    argument: string
    key_points: string[]
    evidence_cited: DebateEvidenceReference[]
    responding_to?: string | null
    concession?: string | null
    confidence: number
    tokens_used?: { input: number; output: number }
    duration_ms?: number
    timestamp: string
}

interface DebateTurnCardProps {
    turn: DebateTurn
    isLatest?: boolean
    isLoading?: boolean
}

function getRoleClasses(role: DebateTurn['role']) {
    switch (role) {
        case 'prosecutor':
            return {
                badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
                dot: 'bg-rose-400',
                icon: 'gavel',
                label: 'Prosecutor',
            }
        case 'defender':
            return {
                badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                dot: 'bg-emerald-400',
                icon: 'balance',
                label: 'Defender',
            }
        default:
            return {
                badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                dot: 'bg-amber-400',
                icon: 'account_balance',
                label: 'Judge',
            }
    }
}

export default function DebateTurnCard({
    turn,
    isLatest = false,
    isLoading = false,
}: DebateTurnCardProps) {
    const [expanded, setExpanded] = useState(false)
    const roleClasses = getRoleClasses(turn.role)
    const confidenceLabel = `${Math.round((turn.confidence || 0) * 100)}%`
    const hasLongArgument = (turn.argument || '').length > 360
    const previewArgument = useMemo(() => {
        if (expanded || !hasLongArgument) return turn.argument
        return `${turn.argument.slice(0, 360).trimEnd()}...`
    }, [expanded, hasLongArgument, turn.argument])

    if (isLoading) {
        return (
            <div className="rounded-2xl border border-zinc-800/70 bg-[#111] p-4 animate-pulse">
                <div className="mb-4 flex items-center justify-between">
                    <div className="h-6 w-28 rounded-full bg-zinc-800/80" />
                    <div className="h-4 w-16 rounded bg-zinc-800/60" />
                </div>
                <div className="space-y-2">
                    <div className="h-3 w-full rounded bg-zinc-800/60" />
                    <div className="h-3 w-11/12 rounded bg-zinc-800/60" />
                    <div className="h-3 w-9/12 rounded bg-zinc-800/60" />
                </div>
            </div>
        )
    }

    return (
        <div className={`rounded-2xl border bg-[#111] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.18)] transition-all ${
            isLatest ? 'border-[#D4AF37]/40 ring-1 ring-[#D4AF37]/20' : 'border-zinc-800/70'
        }`}>
            <div className="mb-3 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <span className={`mt-1 h-2.5 w-2.5 rounded-full ${roleClasses.dot}`} />
                    <div>
                        <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${roleClasses.badge}`}>
                            <span className="material-symbols-outlined text-[12px]">{roleClasses.icon}</span>
                            {roleClasses.label}
                        </div>
                        <div className="mt-2">
                            <p className="text-sm font-semibold text-zinc-100">{turn.agent_name}</p>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">{turn.model}</p>
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Turn {turn.turn_number}</p>
                    <p className="mt-1 text-xs text-zinc-400">{confidenceLabel}</p>
                </div>
            </div>

            <p className="text-[13px] leading-6 text-zinc-300 whitespace-pre-wrap">{previewArgument}</p>
            {hasLongArgument && (
                <button
                    type="button"
                    onClick={() => setExpanded(prev => !prev)}
                    className="mt-2 text-[10px] uppercase tracking-[0.22em] text-[#D4AF37] hover:text-[#f2ca50]"
                >
                    {expanded ? 'Show Less' : 'Show More'}
                </button>
            )}

            {turn.concession && (
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Concession</p>
                    <p className="mt-1 text-[12px] italic text-zinc-400">{turn.concession}</p>
                </div>
            )}

            {turn.key_points?.length > 0 && (
                <div className="mt-4">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Key Points</p>
                    <ul className="mt-2 space-y-1.5">
                        {turn.key_points.map((point, idx) => (
                            <li key={`${turn.turn_number}-kp-${idx}`} className="flex gap-2 text-[12px] leading-5 text-zinc-300">
                                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-zinc-500" />
                                <span>{point}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {turn.evidence_cited?.length > 0 && (
                <div className="mt-4">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Evidence</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {turn.evidence_cited.map((evidence, idx) => (
                            <span
                                key={`${turn.turn_number}-evidence-${idx}`}
                                className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[10px] text-zinc-300"
                                title={evidence.relevance}
                            >
                                {evidence.reference}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                    <span>Confidence</span>
                    <span>{confidenceLabel}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                    <div
                        className={`h-full rounded-full ${
                            turn.role === 'prosecutor'
                                ? 'bg-rose-400/80'
                                : turn.role === 'defender'
                                  ? 'bg-emerald-400/80'
                                  : 'bg-amber-400/80'
                        }`}
                        style={{ width: `${Math.max(5, Math.round((turn.confidence || 0) * 100))}%` }}
                    />
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{turn.duration_ms ? `${(turn.duration_ms / 1000).toFixed(1)}s` : 'n/a'}</span>
                <span>{turn.timestamp ? new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
        </div>
    )
}
