'use client'

import React, { useEffect, useMemo, useState } from 'react'

type DebatePerspective = 'client_advocate' | 'counterparty_advocate' | 'neutral_arbiter'
type DebatePosition = 'upgrade_severity' | 'downgrade_severity' | 'maintain_severity'
type DebateSeverity = 'critical' | 'warning' | 'info'

interface DebateArgument {
    perspective: DebatePerspective
    position: DebatePosition
    recommended_severity: DebateSeverity
    reasoning: string
    key_points: string[]
    legal_basis?: string | null
    risk_quantification?: string | null
    confidence: number
}

interface DebateVerdict {
    original_severity: string
    final_severity: string
    severity_changed: boolean
    consensus_level: 'unanimous' | 'majority' | 'split'
    verdict_reasoning: string
    adjusted_impact_analysis: string
    adjusted_batna?: string | null
    confidence_score: number
}

interface DeviationDebateResult {
    deviation_id: string
    debate_triggered: boolean
    arguments: DebateArgument[]
    verdict?: DebateVerdict | null
    debate_duration_ms: number
    tokens_used: number
}

interface SelectedDeviation {
    deviation_id: string
    title: string
    severity: DebateSeverity
    impact_analysis: string
    pre_debate_severity?: string
    debate_verdict?: DebateVerdict
}

interface DebatePanelProps {
    debateResult?: DeviationDebateResult | null
    selectedDeviation: SelectedDeviation
}

const perspectiveOrder: DebatePerspective[] = [
    'client_advocate',
    'counterparty_advocate',
    'neutral_arbiter',
]

function severityTone(severity: string) {
    switch (severity) {
        case 'critical':
            return 'text-rose-300 bg-rose-500/10 border-rose-500/30'
        case 'warning':
            return 'text-amber-300 bg-amber-500/10 border-amber-500/30'
        default:
            return 'text-sky-300 bg-sky-500/10 border-sky-500/30'
    }
}

function severityEmoji(severity: string) {
    switch (severity) {
        case 'critical':
            return '🔴'
        case 'warning':
            return '⚠️'
        default:
            return '🔵'
    }
}

function confidenceBarTone(confidence: number) {
    if (confidence >= 0.8) return 'bg-emerald-400'
    if (confidence >= 0.6) return 'bg-amber-400'
    return 'bg-rose-400'
}

function positionBadge(position: DebatePosition, severity: DebateSeverity) {
    if (position === 'upgrade_severity') {
        return {
            label: `📈 Upgrade to ${severity}`,
            classes: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
        }
    }
    if (position === 'downgrade_severity') {
        return {
            label: `📉 Downgrade to ${severity}`,
            classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
        }
    }
    return {
        label: `📊 Maintain ${severity}`,
        classes: 'bg-zinc-800/80 border-zinc-700 text-zinc-300',
    }
}

function perspectiveMeta(perspective: DebatePerspective) {
    switch (perspective) {
        case 'client_advocate':
            return {
                title: 'Client Advocate',
                icon: '💼',
                model: 'Sonnet',
                border: 'border-blue-500',
                badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
            }
        case 'counterparty_advocate':
            return {
                title: 'Counterparty Advocate',
                icon: '🎭',
                model: 'Sonnet',
                border: 'border-amber-500',
                badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
            }
        default:
            return {
                title: 'Neutral Arbiter',
                icon: '⚖️',
                model: 'Opus',
                border: 'border-purple-500',
                badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
            }
    }
}

function formatMs(durationMs: number) {
    if (!durationMs) return 'n/a'
    return `${(durationMs / 1000).toFixed(1)}s`
}

export default function DebatePanel({
    debateResult,
    selectedDeviation,
}: DebatePanelProps) {
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        setExpanded(false)
    }, [selectedDeviation.deviation_id])

    const orderedArguments = useMemo(() => {
        const items = debateResult?.arguments || []
        return [...items].sort(
            (left, right) => perspectiveOrder.indexOf(left.perspective) - perspectiveOrder.indexOf(right.perspective)
        )
    }, [debateResult?.arguments])

    if (!debateResult) {
        return (
            <div className="rounded-2xl border border-zinc-800/70 bg-[#101010] p-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm">⚖️</span>
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">AI Debate</p>
                        <p className="text-sm text-zinc-300">Debate not available.</p>
                    </div>
                </div>
            </div>
        )
    }

    if (!debateResult.debate_triggered) {
        return (
            <div className="rounded-2xl border border-zinc-800/70 bg-[#101010] p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">AI Debate</p>
                        <p className="mt-1 text-sm text-zinc-200">Info-severity deviation. Debate skipped.</p>
                    </div>
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-zinc-400">
                        skipped
                    </span>
                </div>
            </div>
        )
    }

    const verdict = debateResult.verdict || selectedDeviation.debate_verdict || null
    const initialSeverity = verdict?.original_severity || selectedDeviation.pre_debate_severity || selectedDeviation.severity
    const finalSeverity = verdict?.final_severity || selectedDeviation.severity
    const confidence = verdict?.confidence_score || 0

    return (
        <div className="rounded-2xl border border-zinc-800/70 bg-[#101010] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
            <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
            >
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">⚖️</span>
                        <span className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">AI Debate</span>
                        {verdict && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${severityTone(finalSeverity)}`}>
                                {severityEmoji(finalSeverity)} {finalSeverity}
                            </span>
                        )}
                        {verdict?.severity_changed && (
                            <span className="rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[#f2ca50]">
                                Changed by Debate
                            </span>
                        )}
                    </div>
                    <p className="mt-2 text-sm text-zinc-100">{selectedDeviation.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                        <span>
                            Initial: {severityEmoji(initialSeverity)} {initialSeverity}
                        </span>
                        <span>→</span>
                        <span>
                            Final: {severityEmoji(finalSeverity)} {finalSeverity}
                        </span>
                        {verdict && (
                            <>
                                <span>•</span>
                                <span>Consensus: {verdict.consensus_level}</span>
                                <span>•</span>
                                <span>Confidence: {Math.round(confidence * 100)}%</span>
                            </>
                        )}
                    </div>
                </div>
                <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    {expanded ? 'Collapse' : 'Expand'}
                </span>
            </button>

            {!expanded && (
                <div className="px-4 pb-4">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                        <div
                            className={`h-full rounded-full ${confidenceBarTone(confidence)}`}
                            style={{ width: `${Math.max(6, Math.round(confidence * 100))}%` }}
                        />
                    </div>
                </div>
            )}

            {expanded && (
                <div className="border-t border-zinc-800/70 px-4 py-4">
                    {verdict ? (
                        <div className="mb-4 rounded-2xl border border-zinc-800 bg-[#151515] p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm">⚖️</span>
                                <span className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Verdict</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${severityTone(finalSeverity)}`}>
                                    {severityEmoji(finalSeverity)} {finalSeverity}
                                </span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-zinc-300">
                                <span>Initial: {severityEmoji(initialSeverity)} {initialSeverity}</span>
                                <span>→</span>
                                <span>Final: {severityEmoji(finalSeverity)} {finalSeverity}</span>
                                {verdict.severity_changed && (
                                    <span className="rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[#f2ca50]">
                                        Changed by Debate
                                    </span>
                                )}
                            </div>
                            <p className="mt-3 text-[13px] leading-6 text-zinc-300">{verdict.verdict_reasoning}</p>
                            <div className="mt-4 rounded-xl border border-zinc-800 bg-[#0d0d0d] p-3">
                                <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Adjusted Impact Analysis</p>
                                <p className="mt-2 text-[12px] leading-5 text-zinc-300">{verdict.adjusted_impact_analysis}</p>
                            </div>
                            {verdict.adjusted_batna && (
                                <div className="mt-3 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-3">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-[#D4AF37]">Adjusted BATNA</p>
                                    <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[#f2ca50]/90">{verdict.adjusted_batna}</p>
                                </div>
                            )}
                            <div className="mt-4">
                                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                    <span>Confidence</span>
                                    <span>{Math.round(confidence * 100)}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                                    <div
                                        className={`h-full rounded-full ${confidenceBarTone(confidence)}`}
                                        style={{ width: `${Math.max(6, Math.round(confidence * 100))}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
                            <p className="text-sm text-rose-200">Debate started but no final verdict was produced. The original Smart Diff severity remains in effect.</p>
                        </div>
                    )}

                    <div className="space-y-4">
                        {orderedArguments.map(argument => {
                            const meta = perspectiveMeta(argument.perspective)
                            const badge = positionBadge(argument.position, argument.recommended_severity)
                            return (
                                <div
                                    key={`${selectedDeviation.deviation_id}-${argument.perspective}`}
                                    className={`rounded-2xl border border-zinc-800 bg-[#141414] p-4 border-l-4 ${meta.border}`}
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-base">{meta.icon}</span>
                                                <span className="text-sm font-semibold text-zinc-100">{meta.title}</span>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${meta.badge}`}>
                                                    {meta.model}
                                                </span>
                                            </div>
                                            <div className="mt-2">
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${badge.classes}`}>
                                                    {badge.label}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                            {Math.round(argument.confidence * 100)}%
                                        </span>
                                    </div>

                                    <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-zinc-300">{argument.reasoning}</p>

                                    {argument.key_points?.length > 0 && (
                                        <ul className="mt-4 space-y-2">
                                            {argument.key_points.map((point, index) => (
                                                <li key={`${argument.perspective}-point-${index}`} className="flex gap-2 text-[12px] leading-5 text-zinc-300">
                                                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-zinc-500" />
                                                    <span>{point}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}

                                    {(argument.legal_basis || argument.risk_quantification) && (
                                        <div className="mt-4 grid gap-2 md:grid-cols-2">
                                            {argument.legal_basis && (
                                                <div className="rounded-xl border border-zinc-800 bg-[#101010] p-3">
                                                    <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Legal Basis</p>
                                                    <p className="mt-2 text-[12px] leading-5 text-zinc-300">{argument.legal_basis}</p>
                                                </div>
                                            )}
                                            {argument.risk_quantification && (
                                                <div className="rounded-xl border border-zinc-800 bg-[#101010] p-3">
                                                    <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Risk Quantification</p>
                                                    <p className="mt-2 text-[12px] leading-5 text-zinc-300">{argument.risk_quantification}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="mt-4">
                                        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                            <span>Confidence</span>
                                            <span>{Math.round(argument.confidence * 100)}%</span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                                            <div
                                                className={`h-full rounded-full ${confidenceBarTone(argument.confidence)}`}
                                                style={{ width: `${Math.max(6, Math.round(argument.confidence * 100))}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <span>Duration: {formatMs(debateResult.debate_duration_ms)}</span>
                        <span>Tokens: {debateResult.tokens_used.toLocaleString()}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
