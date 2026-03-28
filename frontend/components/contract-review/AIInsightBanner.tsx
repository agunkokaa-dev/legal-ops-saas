'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

interface BannerData {
    critical_count: number
    warning_count: number
    info_count: number
    total_count: number
}

function AnimatedCounter({ target, duration = 1.2 }: { target: number; duration?: number }) {
    const [count, setCount] = useState(0)

    useEffect(() => {
        if (target === 0) { setCount(0); return }
        let start = 0
        const step = Math.ceil(target / (duration * 60))
        const timer = setInterval(() => {
            start += step
            if (start >= target) {
                setCount(target)
                clearInterval(timer)
            } else {
                setCount(start)
            }
        }, 1000 / 60)
        return () => clearInterval(timer)
    }, [target, duration])

    return <span>{count}</span>
}

export default function AIInsightBanner({
    banner,
    onSeverityClick
}: {
    banner: BannerData
    onSeverityClick: (severity: 'critical' | 'warning' | 'info') => void
}) {
    if (banner.total_count === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex-shrink-0 px-6 py-3 bg-gradient-to-r from-green-500/10 via-green-500/5 to-transparent border-b border-green-500/20"
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20">
                        <span className="material-symbols-outlined text-green-400 text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                            verified_user
                        </span>
                    </div>
                    <div>
                        <p className="text-green-400 text-sm font-semibold">No Issues Found</p>
                        <p className="text-green-400/60 text-[10px] tracking-wide">This contract passed all compliance and risk checks.</p>
                    </div>
                </div>
            </motion.div>
        )
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="flex-shrink-0 px-6 py-3 bg-gradient-to-r from-[#0e0e0e] via-[#121212] to-[#0e0e0e] border-b border-white/5 backdrop-blur-sm"
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                    {/* Shield Icon */}
                    <div className="relative">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-red-500/20 to-amber-500/10 border border-red-500/20">
                            <span className="material-symbols-outlined text-red-400 text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                                shield
                            </span>
                        </div>
                        {banner.critical_count > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[8px] font-bold text-white animate-pulse">
                                {banner.critical_count}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <span className="text-white text-sm font-serif font-semibold">AI Review Complete</span>
                        <span className="text-zinc-600 text-sm mx-2">—</span>
                        <span className="text-zinc-400 text-xs">
                            <AnimatedCounter target={banner.total_count} /> issues identified
                        </span>
                    </div>
                </div>

                {/* Severity Badges */}
                <div className="flex items-center gap-2">
                    {banner.critical_count > 0 && (
                        <button
                            onClick={() => onSeverityClick('critical')}
                            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-all cursor-pointer"
                        >
                            <span className="w-2 h-2 rounded-full bg-red-500 group-hover:animate-pulse" />
                            <span className="text-red-400 text-xs font-bold">
                                <AnimatedCounter target={banner.critical_count} /> Critical
                            </span>
                        </button>
                    )}
                    {banner.warning_count > 0 && (
                        <button
                            onClick={() => onSeverityClick('warning')}
                            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/40 transition-all cursor-pointer"
                        >
                            <span className="w-2 h-2 rounded-full bg-amber-500 group-hover:animate-pulse" />
                            <span className="text-amber-400 text-xs font-bold">
                                <AnimatedCounter target={banner.warning_count} /> Warnings
                            </span>
                        </button>
                    )}
                    {banner.info_count > 0 && (
                        <button
                            onClick={() => onSeverityClick('info')}
                            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 hover:border-blue-500/40 transition-all cursor-pointer"
                        >
                            <span className="w-2 h-2 rounded-full bg-blue-500 group-hover:animate-pulse" />
                            <span className="text-blue-400 text-xs font-bold">
                                <AnimatedCounter target={banner.info_count} /> Info
                            </span>
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    )
}
