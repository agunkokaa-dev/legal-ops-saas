'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { assertSafeLlmText } from '@/lib/sanitize'

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

const SEVERITY_STYLES: Record<string, { bg: string; border: string; label: string; icon: string }> = {
    critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'text-red-400', icon: 'error' },
    warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'text-amber-400', icon: 'warning' },
    info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'text-blue-400', icon: 'info' },
}

export default function FindingPopover({
    finding,
    targetRect,
    containerRect,
    onAcceptRedline,
    onConvertToTask,
    onViewDetails,
    onClose,
}: {
    finding: ReviewFinding
    targetRect: DOMRect
    containerRect?: DOMRect
    onAcceptRedline: (finding: ReviewFinding) => Promise<void>
    onConvertToTask: (finding: ReviewFinding) => Promise<void>
    onViewDetails: (finding: ReviewFinding) => void
    onClose: () => void
}) {
    const [isFixing, setIsFixing] = useState(false)
    const [isTasking, setIsTasking] = useState(false)
    const style = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info
    const safeDescription = assertSafeLlmText(finding.description, 'review_finding_description')
    const safeSuggestedRevision = finding.suggested_revision
        ? assertSafeLlmText(finding.suggested_revision, 'suggested_revision')
        : null

    const handleFix = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!safeSuggestedRevision) return
        setIsFixing(true)
        try {
            await onAcceptRedline(finding)
            onClose()
        } finally {
            setIsFixing(false)
        }
    }

    const handleTask = async (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsTasking(true)
        try {
            await onConvertToTask(finding)
        } finally {
            setIsTasking(false)
        }
    }

    const handleDetails = (e: React.MouseEvent) => {
        e.stopPropagation()
        onViewDetails(finding)
        onClose()
    }

    // Position: above the highlighted text, clamped inside document viewport
    const popoverWidth = 340
    const top = targetRect.top - 16
    const leftCenter = targetRect.left + targetRect.width / 2 - popoverWidth / 2
    const left = Math.max(20, Math.min(leftCenter, window.innerWidth - popoverWidth - 20))

    return (
        <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`
                fixed z-[80] w-[340px]
                ${style.bg} backdrop-blur-2xl
                border ${style.border} rounded-xl
                shadow-2xl shadow-black/60
                overflow-hidden
            `}
            style={{
                top: `${top}px`,
                left: `${left}px`,
                transform: 'translateY(-100%)',
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="p-3.5 pb-2.5">
                <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                        <span className={`material-symbols-outlined text-sm ${style.label}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                            {style.icon}
                        </span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${style.label}`}>
                            {finding.severity} — {finding.category}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-600 hover:text-white transition-colors p-0.5"
                    >
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
                <p className="text-white text-xs font-semibold leading-snug mb-1">{finding.title}</p>
                <p className="text-zinc-400 text-[11px] leading-relaxed line-clamp-2">{safeDescription}</p>
            </div>

            {/* Action Bar */}
            <div className="flex items-center gap-1.5 p-2.5 pt-0 border-t border-white/5 mt-1">
                {safeSuggestedRevision && finding.status === 'open' && (
                    <button
                        onClick={handleFix}
                        disabled={isFixing}
                        className="flex-1 py-2 bg-gradient-to-r from-[#d4af37] to-[#bda036] text-black text-[10px] font-bold uppercase tracking-wider rounded-lg hover:shadow-[0_0_12px_rgba(212,175,55,0.3)] transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                        {isFixing ? (
                            <span className="w-2.5 h-2.5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                        ) : (
                            <span className="material-symbols-outlined text-xs">auto_fix_high</span>
                        )}
                        {isFixing ? 'Fixing...' : 'Fix Now'}
                    </button>
                )}
                <button
                    onClick={handleTask}
                    disabled={isTasking}
                    className="py-2 px-3 bg-white/5 border border-white/10 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                >
                    <span className="material-symbols-outlined text-xs">add_task</span>
                    Task
                </button>
                <button
                    onClick={handleDetails}
                    className="py-2 px-3 bg-white/5 border border-white/10 text-zinc-400 hover:text-[#d4af37] text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1"
                >
                    <span className="material-symbols-outlined text-xs">open_in_full</span>
                    Details
                </button>
            </div>

            {/* Arrow pointing down to the text */}
            <div
                className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 ${style.bg} border-r border-b ${style.border}`}
            />
        </motion.div>
    )
}
