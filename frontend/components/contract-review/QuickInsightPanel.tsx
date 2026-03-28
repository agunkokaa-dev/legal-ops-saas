'use client'

import { motion } from 'framer-motion'

interface QuickInsight {
    label: string
    value: string
    icon: string
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

const SEVERITY_ICON: Record<string, { color: string; bg: string }> = {
    critical: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    warning: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    info: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
}

export default function QuickInsightPanel({
    insights,
    findings,
    onFindingClick,
}: {
    insights: QuickInsight[]
    findings: ReviewFinding[]
    onFindingClick: (finding: ReviewFinding) => void
}) {
    const openFindings = findings.filter(f => f.status === 'open')
    const acceptedFindings = findings.filter(f => f.status === 'accepted')

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-white/5">
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-[#d4af37]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        bolt
                    </span>
                    Quick Insights
                </h2>
                <p className="text-[10px] text-zinc-600 mt-0.5">5-second business context</p>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Insight Cards */}
                <div className="grid grid-cols-2 gap-2.5">
                    {insights.map((insight, i) => (
                        <motion.div
                            key={insight.label}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05, duration: 0.3 }}
                            className="bg-[#141414] border border-white/5 rounded-xl p-3.5 hover:border-[#d4af37]/20 transition-colors group"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="material-symbols-outlined text-[14px] text-[#d4af37] group-hover:scale-110 transition-transform">
                                    {insight.icon || 'info'}
                                </span>
                                <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">
                                    {insight.label}
                                </span>
                            </div>
                            <p className="text-white text-sm font-semibold leading-snug truncate" title={insight.value}>
                                {insight.value}
                            </p>
                        </motion.div>
                    ))}
                </div>

                {/* Findings Summary */}
                {openFindings.length > 0 && (
                    <div>
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] mb-3 flex items-center gap-2">
                            <span className="material-symbols-outlined text-xs">flag</span>
                            Review Findings ({openFindings.length})
                        </h3>
                        <div className="space-y-2">
                            {openFindings.map((finding, i) => {
                                const style = SEVERITY_ICON[finding.severity]
                                return (
                                    <motion.button
                                        key={finding.finding_id}
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.03 }}
                                        onClick={() => onFindingClick(finding)}
                                        className={`
                                            w-full text-left p-3 rounded-lg border transition-all
                                            ${style.bg}
                                            hover:scale-[1.01] hover:shadow-lg
                                            group cursor-pointer
                                        `}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${style.bg}`}>
                                                <span className={`material-symbols-outlined text-xs ${style.color}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                                                    {finding.severity === 'critical' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info'}
                                                </span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-white text-xs font-semibold truncate group-hover:text-[#d4af37] transition-colors">
                                                    {finding.title}
                                                </p>
                                                <p className="text-zinc-500 text-[10px] mt-0.5 line-clamp-1">
                                                    {finding.category}
                                                </p>
                                            </div>
                                            <span className="material-symbols-outlined text-zinc-600 text-sm group-hover:text-[#d4af37] transition-colors flex-shrink-0">
                                                chevron_right
                                            </span>
                                        </div>
                                    </motion.button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Resolved Section */}
                {acceptedFindings.length > 0 && (
                    <div>
                        <h3 className="text-[10px] font-bold text-green-500/60 uppercase tracking-[0.15em] mb-2 flex items-center gap-2">
                            <span className="material-symbols-outlined text-xs text-green-500">check_circle</span>
                            Resolved ({acceptedFindings.length})
                        </h3>
                        <div className="space-y-1.5">
                            {acceptedFindings.map(f => (
                                <div
                                    key={f.finding_id}
                                    className="p-2.5 rounded-lg bg-green-500/5 border border-green-500/10"
                                >
                                    <p className="text-green-400/60 text-[11px] line-through">
                                        {f.title}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
