'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

interface TextCoordinate {
    start_char: number
    end_char: number
    source_text: string
}

interface ReviewFinding {
    finding_id: string
    severity: 'critical' | 'warning' | 'info'
    category: string
    title: string
    description: string
    coordinates: TextCoordinate
    suggested_revision: string | null
    playbook_reference: string | null
    status: 'open' | 'accepted' | 'dismissed'
}

const SEVERITY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
    critical: { bg: 'bg-red-500/15 border-red-500/30', text: 'text-red-400', label: 'CRITICAL' },
    warning: { bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-400', label: 'WARNING' },
    info: { bg: 'bg-blue-500/15 border-blue-500/30', text: 'text-blue-400', label: 'INFO' },
}

export default function AdvancedRiskPanel({
    finding,
    onBack,
    onAcceptRedline,
    onConvertToTask,
}: {
    finding: ReviewFinding
    onBack: () => void
    onAcceptRedline: (finding: ReviewFinding) => Promise<void>
    onConvertToTask: (finding: ReviewFinding) => Promise<void>
}) {
    const [isAccepting, setIsAccepting] = useState(false)
    const [isConverting, setIsConverting] = useState(false)
    const badge = SEVERITY_BADGE[finding.severity] || SEVERITY_BADGE.info

    const handleAccept = async () => {
        setIsAccepting(true)
        try {
            await onAcceptRedline(finding)
        } finally {
            setIsAccepting(false)
        }
    }

    const handleConvert = async () => {
        setIsConverting(true)
        try {
            await onConvertToTask(finding)
        } finally {
            setIsConverting(false)
        }
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-5 py-4 border-b border-white/5 bg-[#0e0e0e]">
                <div className="flex items-center justify-between mb-3">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1 text-zinc-500 hover:text-white transition-colors text-xs"
                    >
                        <span className="material-symbols-outlined text-sm">arrow_back</span>
                        Quick Insights
                    </button>
                    <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border ${badge.bg} ${badge.text}`}>
                        {badge.label}
                    </span>
                </div>
                <h2 className="text-white font-serif font-semibold text-base leading-snug">
                    {finding.title}
                </h2>
                <p className="text-zinc-500 text-[10px] mt-1 tracking-wide">
                    {finding.category}
                </p>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* AI Analysis */}
                <div>
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-[#d4af37]">psychology</span>
                        AI Analysis
                    </h3>
                    <div className="bg-[#141414] border border-white/5 rounded-xl p-4">
                        <p className="text-zinc-300 text-[12px] leading-relaxed whitespace-pre-wrap">
                            {finding.description}
                        </p>
                    </div>
                </div>

                {/* Source Text */}
                <div>
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-zinc-400">format_quote</span>
                        Original Clause
                    </h3>
                    <div className="bg-[#141414] border-l-4 border-l-red-500/50 border border-white/5 rounded-r-xl p-4">
                        <p className="text-zinc-400 text-[12px] font-serif leading-relaxed italic whitespace-pre-wrap">
                            &ldquo;{finding.coordinates.source_text}&rdquo;
                        </p>
                        <p className="text-zinc-700 text-[9px] mt-2 tracking-wider">
                            Position: chars {finding.coordinates.start_char}–{finding.coordinates.end_char}
                        </p>
                    </div>
                </div>

                {/* AI Redline (if available) */}
                {finding.suggested_revision && finding.status !== 'accepted' && (
                    <div>
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-xs text-[#d4af37]">edit_note</span>
                            AI Suggested Revision
                        </h3>
                        <div className="bg-[#0d1a0d] border-l-4 border-l-green-500/50 border border-green-500/10 rounded-r-xl p-4">
                            <p className="text-green-300/90 text-[12px] font-serif leading-relaxed whitespace-pre-wrap">
                                {finding.suggested_revision}
                            </p>
                        </div>
                    </div>
                )}

                {/* Playbook Reference */}
                {finding.playbook_reference && (
                    <div className="bg-[#141414] border border-[#d4af37]/10 rounded-xl p-3.5 flex items-start gap-2.5">
                        <span className="material-symbols-outlined text-[#d4af37] text-sm flex-shrink-0 mt-0.5">menu_book</span>
                        <div>
                            <p className="text-[9px] text-[#d4af37]/60 uppercase tracking-wider font-bold mb-0.5">Playbook Rule</p>
                            <p className="text-zinc-400 text-[11px] leading-relaxed">{finding.playbook_reference}</p>
                        </div>
                    </div>
                )}

                {/* Accepted State */}
                {finding.status === 'accepted' && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3"
                    >
                        <span className="material-symbols-outlined text-green-400 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check_circle
                        </span>
                        <div>
                            <p className="text-green-400 text-sm font-semibold">Redline Accepted</p>
                            <p className="text-green-400/60 text-[10px]">The document has been updated with the AI suggestion.</p>
                        </div>
                    </motion.div>
                )}
            </div>

            {/* Action Buttons (sticky footer) */}
            {finding.status === 'open' && (
                <div className="flex-shrink-0 p-4 border-t border-white/5 bg-[#0e0e0e] space-y-2">
                    {finding.suggested_revision && (
                        <button
                            onClick={handleAccept}
                            disabled={isAccepting}
                            className="w-full py-3 bg-gradient-to-r from-[#d4af37] to-[#bda036] text-black text-xs font-bold uppercase tracking-[0.15em] rounded-lg hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isAccepting ? (
                                <>
                                    <span className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                    Applying...
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-sm">check</span>
                                    Accept AI Redline
                                </>
                            )}
                        </button>
                    )}
                    <button
                        onClick={handleConvert}
                        disabled={isConverting}
                        className="w-full py-2.5 bg-transparent border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 text-xs font-bold uppercase tracking-[0.15em] rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isConverting ? (
                            <>
                                <span className="w-3 h-3 border-2 border-zinc-400/20 border-t-zinc-400 rounded-full animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <span className="material-symbols-outlined text-sm">add_task</span>
                                Convert to Task
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    )
}
