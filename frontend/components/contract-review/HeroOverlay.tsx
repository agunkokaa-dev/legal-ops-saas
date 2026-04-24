'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { assertSafeLlmText } from '@/lib/sanitize'

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

function getRiskLevel(banner: BannerData): { label: string; color: string; glow: string; icon: string } {
    if (banner.critical_count > 0) return {
        label: 'HIGH RISK DETECTED',
        color: 'text-red-400',
        glow: 'shadow-[0_0_60px_rgba(239,68,68,0.15)]',
        icon: 'gpp_bad',
    }
    if (banner.warning_count > 0) return {
        label: 'MODERATE RISK',
        color: 'text-amber-400',
        glow: 'shadow-[0_0_60px_rgba(245,158,11,0.12)]',
        icon: 'shield',
    }
    return {
        label: 'LOW RISK',
        color: 'text-green-400',
        glow: 'shadow-[0_0_60px_rgba(34,197,94,0.12)]',
        icon: 'verified_user',
    }
}

export default function HeroOverlay({
    banner,
    findings,
    quickInsights,
    onDismiss,
    onStartWizard,
}: {
    banner: BannerData
    findings: ReviewFinding[]
    quickInsights: QuickInsight[]
    onDismiss: () => void
    onStartWizard: () => void
}) {
    const [isExiting, setIsExiting] = useState(false)
    const risk = getRiskLevel(banner)
    const criticalFindings = findings.filter(f => f.severity === 'critical' && f.status === 'open')
    const topRisks = criticalFindings.slice(0, 2)

    // Find contract value from quick insights
    const valueInsight = quickInsights.find(i =>
        i.label.toLowerCase().includes('value') || i.label.toLowerCase().includes('amount')
    )

    const handleDismiss = () => {
        setIsExiting(true)
        setTimeout(onDismiss, 400)
    }

    const handleWizard = () => {
        setIsExiting(true)
        setTimeout(onStartWizard, 400)
    }

    return (
        <AnimatePresence>
            {!isExiting && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="fixed inset-0 z-[60] flex items-center justify-center"
                >
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={handleDismiss}
                    />

                    {/* Modal Card */}
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.97 }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                        className={`relative w-full max-w-[560px] mx-6 rounded-2xl bg-[#0e0e0e] border border-white/10 overflow-hidden ${risk.glow}`}
                    >
                        {/* Top accent bar */}
                        <div className={`h-1 w-full ${
                            banner.critical_count > 0 ? 'bg-gradient-to-r from-red-500 via-red-600 to-red-500' :
                            banner.warning_count > 0 ? 'bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500' :
                            'bg-gradient-to-r from-green-500 via-green-600 to-green-500'
                        }`} />

                        <div className="p-8 md:p-10">
                            {/* Risk Badge */}
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="flex items-center gap-3 mb-6"
                            >
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                    banner.critical_count > 0 ? 'bg-red-500/15 border border-red-500/30' :
                                    banner.warning_count > 0 ? 'bg-amber-500/15 border border-amber-500/30' :
                                    'bg-green-500/15 border border-green-500/30'
                                }`}>
                                    <span className={`material-symbols-outlined text-2xl ${risk.color}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                                        {risk.icon}
                                    </span>
                                </div>
                                <div>
                                    <h2 className={`text-lg font-bold tracking-wide ${risk.color}`}>
                                        {risk.label}
                                    </h2>
                                    <p className="text-zinc-500 text-xs tracking-wider">
                                        {banner.total_count} issue{banner.total_count !== 1 ? 's' : ''} identified by 7-Agent AI Pipeline
                                    </p>
                                </div>
                            </motion.div>

                            {/* Biggest Risks */}
                            {topRisks.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.45 }}
                                    className="mb-6"
                                >
                                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-xs text-red-400">local_fire_department</span>
                                        Biggest Risks
                                    </h3>
                                    <div className="space-y-2.5">
                                        {topRisks.map((f, i) => (
                                            <div
                                                key={f.finding_id}
                                                className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5"
                                            >
                                                <span className="text-red-400 font-bold text-sm mt-0.5 flex-shrink-0 w-5 text-center">{i + 1}.</span>
                                                <div className="min-w-0">
                                                    <p className="text-white text-[13px] font-semibold leading-snug">{f.title}</p>
                                                    <p className="text-zinc-500 text-[11px] mt-0.5 line-clamp-1">{assertSafeLlmText(f.description, 'review_finding_description')}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                            {/* Business Impact */}
                            {valueInsight && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.55 }}
                                    className="mb-8 p-3.5 rounded-xl bg-[#d4af37]/5 border border-[#d4af37]/15 flex items-center gap-3"
                                >
                                    <span className="material-symbols-outlined text-[#d4af37] text-lg">payments</span>
                                    <div>
                                        <p className="text-[9px] text-[#d4af37]/60 uppercase tracking-widest font-bold">Potential Exposure</p>
                                        <p className="text-[#d4af37] text-sm font-bold">{valueInsight.value}</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Action Buttons */}
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.65 }}
                                className="flex flex-col gap-2.5"
                            >
                                {/* Primary: View Details */}
                                <button
                                    onClick={handleDismiss}
                                    className="w-full py-3.5 bg-white text-black text-xs font-bold uppercase tracking-[0.15em] rounded-xl hover:bg-zinc-100 transition-all flex items-center justify-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-sm">search</span>
                                    View Details
                                </button>

                                <div className="flex gap-2.5">
                                    {/* Review & Apply Fixes (Wizard) */}
                                    {criticalFindings.length > 0 && (
                                        <button
                                            onClick={handleWizard}
                                            className="flex-1 py-3 bg-gradient-to-r from-[#d4af37] to-[#bda036] text-black text-xs font-bold uppercase tracking-[0.12em] rounded-xl hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all flex items-center justify-center gap-2"
                                        >
                                            <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                                            Review & Apply Fixes
                                        </button>
                                    )}

                                    {/* Ask AI (Placeholder) */}
                                    <div className="relative group">
                                        <button
                                            disabled
                                            className="py-3 px-5 bg-white/5 border border-white/10 text-zinc-500 text-xs font-bold uppercase tracking-[0.12em] rounded-xl cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            <span className="material-symbols-outlined text-sm">psychology</span>
                                            Ask AI
                                        </button>
                                        {/* Coming Soon Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#1a1a1a] border border-white/10 rounded-lg text-[10px] text-zinc-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            Coming in next sprint
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1a1a1a] border-r border-b border-white/10 rotate-45 -mt-1" />
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
