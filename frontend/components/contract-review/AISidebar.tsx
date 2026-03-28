'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface BannerData {
    critical_count: number
    warning_count: number
    info_count: number
    total_count: number
}

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

interface QuickInsight {
    label: string
    value: string
    icon: string
}

type SeverityGroup = 'critical' | 'warning' | 'info' | 'summary' | 'resolved'

const SEVERITY_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string; glow: string }> = {
    critical: {
        icon: 'error',
        label: 'Critical Risks',
        color: 'text-red-400',
        bg: 'bg-red-500/8',
        border: 'border-red-500/20 hover:border-red-500/40',
        glow: 'hover:shadow-[0_0_20px_rgba(239,68,68,0.08)]',
    },
    warning: {
        icon: 'warning',
        label: 'Potential Issues',
        color: 'text-amber-400',
        bg: 'bg-amber-500/8',
        border: 'border-amber-500/20 hover:border-amber-500/40',
        glow: 'hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]',
    },
    info: {
        icon: 'info',
        label: 'Informational',
        color: 'text-blue-400',
        bg: 'bg-blue-500/8',
        border: 'border-blue-500/20 hover:border-blue-500/40',
        glow: 'hover:shadow-[0_0_20px_rgba(59,130,246,0.08)]',
    },
    summary: {
        icon: 'description',
        label: 'Contract Summary',
        color: 'text-[#d4af37]',
        bg: 'bg-[#d4af37]/5',
        border: 'border-[#d4af37]/15 hover:border-[#d4af37]/30',
        glow: 'hover:shadow-[0_0_20px_rgba(212,175,55,0.06)]',
    },
    resolved: {
        icon: 'check_circle',
        label: 'Resolved',
        color: 'text-green-400',
        bg: 'bg-green-500/5',
        border: 'border-green-500/15 hover:border-green-500/30',
        glow: '',
    },
}

export default function AISidebar({
    banner,
    findings,
    quickInsights,
    selectedFinding,
    onFindingClick,
    onConvertToTask,
}: {
    banner: BannerData
    findings: ReviewFinding[]
    quickInsights: QuickInsight[]
    selectedFinding: ReviewFinding | null
    onFindingClick: (finding: ReviewFinding) => void
    onConvertToTask: (finding: ReviewFinding) => Promise<void>
}) {
    const [expandedGroup, setExpandedGroup] = useState<SeverityGroup | null>(
        banner.critical_count > 0 ? 'critical' : banner.warning_count > 0 ? 'warning' : null
    )

    const grouped = useMemo(() => ({
        critical: findings.filter(f => f.severity === 'critical' && f.status === 'open'),
        warning: findings.filter(f => f.severity === 'warning' && f.status === 'open'),
        info: findings.filter(f => f.severity === 'info' && f.status === 'open'),
        resolved: findings.filter(f => f.status === 'accepted'),
    }), [findings])

    const toggleGroup = (group: SeverityGroup) => {
        setExpandedGroup(prev => prev === group ? null : group)
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
            {/* AI Directive Header */}
            <div className="flex-shrink-0 p-5 pb-4 border-b border-white/5">
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#d4af37]/20 to-[#d4af37]/5 border border-[#d4af37]/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-[#d4af37] text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                            psychology
                        </span>
                    </div>
                    <div>
                        <p className="text-white text-[13px] font-serif leading-relaxed">
                            I found <span className="text-[#d4af37] font-bold">{banner.total_count} issue{banner.total_count !== 1 ? 's' : ''}</span> in this contract.
                            {banner.critical_count > 0
                                ? ' I suggest we start with the highest risks.'
                                : ' Nothing critical — review at your convenience.'
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* Scrollable Action Blocks */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {/* Critical Risks */}
                {grouped.critical.length > 0 && (
                    <ActionBlock
                        config={SEVERITY_CONFIG.critical}
                        count={grouped.critical.length}
                        isExpanded={expandedGroup === 'critical'}
                        isPrimary={true}
                        onToggle={() => toggleGroup('critical')}
                    >
                        <FindingList
                            findings={grouped.critical}
                            selectedId={selectedFinding?.finding_id}
                            onFindingClick={onFindingClick}
                            onConvertToTask={onConvertToTask}
                        />
                    </ActionBlock>
                )}

                {/* Warnings */}
                {grouped.warning.length > 0 && (
                    <ActionBlock
                        config={SEVERITY_CONFIG.warning}
                        count={grouped.warning.length}
                        isExpanded={expandedGroup === 'warning'}
                        onToggle={() => toggleGroup('warning')}
                    >
                        <FindingList
                            findings={grouped.warning}
                            selectedId={selectedFinding?.finding_id}
                            onFindingClick={onFindingClick}
                            onConvertToTask={onConvertToTask}
                        />
                    </ActionBlock>
                )}

                {/* Info */}
                {grouped.info.length > 0 && (
                    <ActionBlock
                        config={SEVERITY_CONFIG.info}
                        count={grouped.info.length}
                        isExpanded={expandedGroup === 'info'}
                        onToggle={() => toggleGroup('info')}
                    >
                        <FindingList
                            findings={grouped.info}
                            selectedId={selectedFinding?.finding_id}
                            onFindingClick={onFindingClick}
                            onConvertToTask={onConvertToTask}
                        />
                    </ActionBlock>
                )}

                {/* Contract Summary */}
                <ActionBlock
                    config={SEVERITY_CONFIG.summary}
                    count={quickInsights.length}
                    countLabel="fields"
                    isExpanded={expandedGroup === 'summary'}
                    onToggle={() => toggleGroup('summary')}
                >
                    <div className="grid grid-cols-2 gap-2 pt-1">
                        {quickInsights.map((insight) => (
                            <div
                                key={insight.label}
                                className="bg-white/[0.03] border border-white/5 rounded-lg p-2.5"
                            >
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="material-symbols-outlined text-[11px] text-[#d4af37]">{insight.icon || 'info'}</span>
                                    <span className="text-[8px] text-zinc-600 uppercase tracking-wider font-bold">{insight.label}</span>
                                </div>
                                <p className="text-white text-[11px] font-semibold truncate" title={insight.value}>{insight.value}</p>
                            </div>
                        ))}
                    </div>
                </ActionBlock>

                {/* Resolved */}
                {grouped.resolved.length > 0 && (
                    <ActionBlock
                        config={SEVERITY_CONFIG.resolved}
                        count={grouped.resolved.length}
                        isExpanded={expandedGroup === 'resolved'}
                        onToggle={() => toggleGroup('resolved')}
                    >
                        <div className="space-y-1.5 pt-1">
                            {grouped.resolved.map(f => (
                                <div key={f.finding_id} className="p-2 rounded-lg bg-green-500/5 border border-green-500/10">
                                    <p className="text-green-400/60 text-[11px] line-through">{f.title}</p>
                                </div>
                            ))}
                        </div>
                    </ActionBlock>
                )}
            </div>
        </div>
    )
}

// ── Action Block (Expandable Card) ──
function ActionBlock({
    config,
    count,
    countLabel,
    isExpanded,
    isPrimary,
    onToggle,
    children,
}: {
    config: (typeof SEVERITY_CONFIG)[string]
    count: number
    countLabel?: string
    isExpanded: boolean
    isPrimary?: boolean
    onToggle: () => void
    children: React.ReactNode
}) {
    return (
        <motion.div
            layout
            className={`rounded-xl border transition-all duration-300 overflow-hidden ${config.bg} ${config.border} ${config.glow} ${
                isPrimary && !isExpanded ? 'ring-1 ring-red-500/20 animate-pulse-subtle' : ''
            }`}
        >
            <button
                onClick={onToggle}
                className="w-full p-3.5 flex items-center justify-between group"
            >
                <div className="flex items-center gap-3">
                    <span
                        className={`material-symbols-outlined text-lg ${config.color}`}
                        style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                        {config.icon}
                    </span>
                    <span className="text-white text-[13px] font-semibold">{config.label}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${config.color} px-2 py-0.5 rounded-full ${config.bg}`}>
                        {count} {countLabel || ''}
                    </span>
                    <motion.span
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="material-symbols-outlined text-sm text-zinc-600"
                    >
                        expand_more
                    </motion.span>
                </div>
            </button>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="px-3.5 pb-3.5">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}

// ── Finding List (inside expanded block) ──
function FindingList({
    findings,
    selectedId,
    onFindingClick,
    onConvertToTask,
}: {
    findings: ReviewFinding[]
    selectedId?: string
    onFindingClick: (f: ReviewFinding) => void
    onConvertToTask: (f: ReviewFinding) => Promise<void>
}) {
    return (
        <div className="space-y-1.5 pt-1">
            {findings.map((f, i) => (
                <motion.div
                    key={f.finding_id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`group flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all ${
                        selectedId === f.finding_id
                            ? 'bg-white/10 border border-[#d4af37]/30'
                            : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.06] hover:border-white/10'
                    }`}
                    onClick={() => onFindingClick(f)}
                >
                    <div className="flex-1 min-w-0">
                        <p className="text-white text-[12px] font-medium truncate group-hover:text-[#d4af37] transition-colors">
                            {f.title}
                        </p>
                        <p className="text-zinc-600 text-[10px] mt-0.5 truncate">{f.category}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={(e) => { e.stopPropagation(); onConvertToTask(f) }}
                            className="p-1 rounded opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-[#d4af37] hover:bg-white/5 transition-all"
                            title="Convert to Task"
                        >
                            <span className="material-symbols-outlined text-[14px]">add_task</span>
                        </button>
                        <span className="material-symbols-outlined text-sm text-zinc-700 group-hover:text-[#d4af37] transition-colors">
                            chevron_right
                        </span>
                    </div>
                </motion.div>
            ))}
        </div>
    )
}
