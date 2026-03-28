'use client'

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

const SEVERITY_STYLES: Record<string, { bg: string; border: string; label: string; icon: string }> = {
    critical: {
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        label: 'text-red-400',
        icon: 'error',
    },
    warning: {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        label: 'text-amber-400',
        icon: 'warning',
    },
    info: {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        label: 'text-blue-400',
        icon: 'info',
    },
}

export default function FindingTooltip({
    finding,
    targetRect,
}: {
    finding: ReviewFinding
    targetRect: DOMRect
}) {
    const style = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info

    // Position above the target element
    const top = targetRect.top - 12
    const left = Math.max(20, Math.min(targetRect.left + targetRect.width / 2 - 160, window.innerWidth - 340))

    return (
        <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`
                fixed z-[100] w-[320px] pointer-events-none
                ${style.bg} backdrop-blur-xl
                border ${style.border} rounded-xl
                shadow-2xl shadow-black/60
                p-4
            `}
            style={{
                top: `${top}px`,
                left: `${left}px`,
                transform: 'translateY(-100%)',
            }}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
                <span className={`material-symbols-outlined text-sm ${style.label}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                    {style.icon}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${style.label}`}>
                    {finding.severity} — {finding.category}
                </span>
            </div>

            {/* Title */}
            <p className="text-white text-xs font-semibold mb-1.5 leading-snug">
                {finding.title}
            </p>

            {/* Description */}
            <p className="text-zinc-400 text-[11px] leading-relaxed line-clamp-3">
                {finding.description}
            </p>

            {/* Click hint */}
            <div className="mt-3 flex items-center gap-1 text-zinc-600 text-[9px] tracking-wider uppercase">
                <span className="material-symbols-outlined text-[10px]">touch_app</span>
                Click to see full analysis
            </div>

            {/* Arrow */}
            <div
                className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 ${style.bg} border-r border-b ${style.border}`}
            />
        </motion.div>
    )
}
