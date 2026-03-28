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

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: string; riskText: string }> = {
    critical: {
        color: 'text-red-400',
        bg: 'bg-red-500/8',
        icon: 'error',
        riskText: 'This issue poses a critical business risk and requires immediate attention.',
    },
    warning: {
        color: 'text-amber-400',
        bg: 'bg-amber-500/8',
        icon: 'warning',
        riskText: 'This non-standard clause could create issues during disputes or enforcement.',
    },
    info: {
        color: 'text-blue-400',
        bg: 'bg-blue-500/8',
        icon: 'info',
        riskText: 'Informational note — review for compliance with internal standards.',
    },
}

export default function FindingCard({
    finding,
    onBack,
    onAcceptRedline,
    onConvertToTask,
    wizardMode,
    wizardProgress,
    onWizardNext,
}: {
    finding: ReviewFinding
    onBack: () => void
    onAcceptRedline: (finding: ReviewFinding) => Promise<void>
    onConvertToTask: (finding: ReviewFinding) => Promise<void>
    wizardMode?: boolean
    wizardProgress?: { current: number; total: number }
    onWizardNext?: () => void
}) {
    const [isAccepting, setIsAccepting] = useState(false)
    const [isConverting, setIsConverting] = useState(false)
    const [justAccepted, setJustAccepted] = useState(false)
    const config = SEVERITY_CONFIG[finding.severity] || SEVERITY_CONFIG.info

    const handleAccept = async () => {
        if (!finding.suggested_revision) return
        setIsAccepting(true)
        try {
            await onAcceptRedline(finding)
            setJustAccepted(true)
            // In wizard mode, auto-advance after a brief visual flash
            if (wizardMode && onWizardNext) {
                setTimeout(() => {
                    setJustAccepted(false)
                    onWizardNext()
                }, 1200)
            }
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
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]"
        >
            {/* Header */}
            <div className="flex-shrink-0 p-5 pb-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1 text-zinc-500 hover:text-white transition-colors text-xs"
                    >
                        <span className="material-symbols-outlined text-sm">arrow_back</span>
                        {wizardMode ? 'Exit Wizard' : 'Back'}
                    </button>
                    <div className="flex items-center gap-2">
                        {wizardMode && wizardProgress && (
                            <span className="text-[10px] text-zinc-500 font-bold tracking-wider">
                                {wizardProgress.current} / {wizardProgress.total}
                            </span>
                        )}
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border ${config.bg} ${config.color} border-current/30`}>
                            {finding.severity}
                        </span>
                    </div>
                </div>
                <h2 className="text-white font-serif font-semibold text-[15px] leading-snug">
                    {finding.title}
                </h2>
                <p className="text-zinc-600 text-[10px] mt-1 tracking-wider uppercase">{finding.category}</p>
            </div>

            {/* Scrollable Content — 3 Structured Sections */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* ⚠️ THE PROBLEM */}
                <Section icon="report_problem" title="THE PROBLEM" color="text-red-400">
                    <p className="text-zinc-300 text-[12px] leading-relaxed">
                        {finding.description}
                    </p>
                </Section>

                {/* 💥 THE RISK */}
                <Section icon="trending_down" title="THE RISK" color="text-amber-400">
                    <p className="text-zinc-400 text-[12px] leading-relaxed italic">
                        {config.riskText}
                    </p>
                    {finding.playbook_reference && (
                        <div className="mt-3 p-2.5 rounded-lg bg-[#d4af37]/5 border border-[#d4af37]/10 flex items-start gap-2">
                            <span className="material-symbols-outlined text-[#d4af37] text-xs mt-0.5">menu_book</span>
                            <p className="text-zinc-500 text-[11px] leading-relaxed">{finding.playbook_reference}</p>
                        </div>
                    )}
                </Section>

                {/* 💡 THE SOLUTION */}
                {finding.suggested_revision && finding.status !== 'accepted' && (
                    <Section icon="lightbulb" title="THE SOLUTION" color="text-green-400">
                        <div className="bg-[#0d1a0d] border-l-4 border-l-green-500/50 border border-green-500/10 rounded-r-xl p-4">
                            <p className="text-green-300/90 text-[12px] font-serif leading-relaxed whitespace-pre-wrap">
                                {finding.suggested_revision}
                            </p>
                        </div>
                    </Section>
                )}

                {/* Original Clause (collapsed context) */}
                <Section icon="format_quote" title="ORIGINAL CLAUSE" color="text-zinc-500">
                    <div className="bg-white/[0.02] border-l-4 border-l-zinc-700 border border-white/5 rounded-r-xl p-3">
                        <p className="text-zinc-500 text-[11px] font-serif leading-relaxed italic">
                            &ldquo;{finding.coordinates.source_text}&rdquo;
                        </p>
                    </div>
                </Section>

                {/* Accepted Flash */}
                {(justAccepted || finding.status === 'accepted') && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3"
                    >
                        <span className="material-symbols-outlined text-green-400 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check_circle
                        </span>
                        <div>
                            <p className="text-green-400 text-sm font-semibold">Revision Applied</p>
                            <p className="text-green-400/60 text-[10px]">
                                {wizardMode ? 'Moving to next issue...' : 'The document has been updated.'}
                            </p>
                        </div>
                    </motion.div>
                )}
            </div>

            {/* Sticky Footer Actions */}
            {finding.status === 'open' && !justAccepted && (
                <div className="flex-shrink-0 p-4 border-t border-white/5 bg-[#0e0e0e] space-y-2">
                    {finding.suggested_revision && (
                        <button
                            onClick={handleAccept}
                            disabled={isAccepting}
                            className="w-full py-3 bg-gradient-to-r from-[#d4af37] to-[#bda036] text-black text-xs font-bold uppercase tracking-[0.15em] rounded-xl hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isAccepting ? (
                                <>
                                    <span className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                    Applying...
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                                    Apply Revision
                                </>
                            )}
                        </button>
                    )}
                    <button
                        onClick={handleConvert}
                        disabled={isConverting}
                        className="w-full py-2.5 bg-transparent border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 text-xs font-bold uppercase tracking-[0.12em] rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
        </motion.div>
    )
}

// ── Section wrapper ──
function Section({
    icon,
    title,
    color,
    children,
}: {
    icon: string
    title: string
    color: string
    children: React.ReactNode
}) {
    return (
        <div>
            <h3 className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-2.5 flex items-center gap-1.5 ${color}`}>
                <span className="material-symbols-outlined text-xs">{icon}</span>
                {title}
            </h3>
            {children}
        </div>
    )
}
