'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import AIInsightBanner from './AIInsightBanner'
import DocumentViewer from './DocumentViewer'
import QuickInsightPanel from './QuickInsightPanel'
import AdvancedRiskPanel from './AdvancedRiskPanel'
import Link from 'next/link'

// ── Types ──
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

interface BannerData {
    critical_count: number
    warning_count: number
    info_count: number
    total_count: number
}

interface QuickInsight {
    label: string
    value: string
    icon: string
}

interface ReviewData {
    contract_id: string
    banner: BannerData
    quick_insights: QuickInsight[]
    findings: ReviewFinding[]
    raw_document: string
}

export default function ContractReviewClient({
    contractId,
    matterId,
    contractTitle,
    contractStatus,
}: {
    contractId: string
    matterId: string
    contractTitle: string
    contractStatus: string
}) {
    const { getToken } = useAuth()
    const router = useRouter()

    // ── Core State ──
    const [reviewData, setReviewData] = useState<ReviewData | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // ── Interaction State ──
    const [selectedFinding, setSelectedFinding] = useState<ReviewFinding | null>(null)
    const [hoveredFinding, setHoveredFinding] = useState<ReviewFinding | null>(null)
    const [scrollToFinding, setScrollToFinding] = useState<string | null>(null)

    // ── Load Review Data ──
    const loadReview = useCallback(async (forceRefresh = false) => {
        try {
            setIsLoading(true)
            setError(null)
            const token = await getToken()
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

            // Try to get cached review first
            if (!forceRefresh) {
                const cached = await fetch(`${apiUrl}/api/v1/review/${contractId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (cached.ok) {
                    const data = await cached.json()
                    if (data.found) {
                        setReviewData(data.review)
                        setIsLoading(false)
                        return
                    }
                }
            }

            // Run fresh analysis
            const res = await fetch(`${apiUrl}/api/v1/review/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ contract_id: contractId })
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || 'Failed to analyze contract')
            }

            const data = await res.json()
            setReviewData(data.review)
        } catch (e: any) {
            console.error('Review load error:', e)
            setError(e.message || 'Failed to load review')
        } finally {
            setIsLoading(false)
        }
    }, [contractId, getToken])

    useEffect(() => {
        loadReview()
    }, [loadReview])

    // ── Banner Click Handler ──
    const handleBannerClick = useCallback((severity: 'critical' | 'warning' | 'info') => {
        if (!reviewData) return
        const first = reviewData.findings.find(
            f => f.severity === severity && f.status === 'open'
        )
        if (first) {
            setScrollToFinding(first.finding_id)
            setTimeout(() => setScrollToFinding(null), 500)
        }
    }, [reviewData])

    // ── Finding Click Handler (paragraph click → open sidebar) ──
    const handleFindingSelect = useCallback((finding: ReviewFinding) => {
        setSelectedFinding(finding)
    }, [])

    // ── Accept AI Redline ──
    const handleAcceptRedline = useCallback(async (finding: ReviewFinding) => {
        if (!finding.suggested_revision) return
        try {
            const token = await getToken()
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

            const res = await fetch(`${apiUrl}/api/v1/review/${contractId}/accept`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    finding_id: finding.finding_id,
                    suggested_revision: finding.suggested_revision
                })
            })

            if (!res.ok) throw new Error('Failed to apply redline')

            const data = await res.json()
            toast.success('AI Redline accepted. Document updated.', {
                style: { background: '#1a1a1a', border: '1px solid #22c55e', color: '#fff' }
            })

            // Update local state
            setReviewData(prev => {
                if (!prev) return prev
                return {
                    ...prev,
                    raw_document: data.updated_document,
                    findings: data.updated_findings
                }
            })
            setSelectedFinding(null)
        } catch (e: any) {
            toast.error(e.message || 'Failed to accept redline')
        }
    }, [contractId, getToken])

    // ── Convert to Task ──
    const handleConvertToTask = useCallback(async (finding: ReviewFinding) => {
        try {
            const token = await getToken()
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

            const res = await fetch(`${apiUrl}/api/v1/review/from-finding`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    matter_id: matterId,
                    contract_id: contractId,
                    finding_title: finding.title,
                    finding_description: finding.description
                })
            })

            if (!res.ok) throw new Error('Failed to create task')

            toast.success('Task created and added to Backlog!', {
                style: { background: '#1a1a1a', border: '1px solid #d4af37', color: '#fff' },
                action: {
                    label: 'View Tasks',
                    onClick: () => router.push(`/dashboard/tasks`)
                }
            })
        } catch (e: any) {
            toast.error(e.message || 'Failed to create task')
        }
    }, [matterId, contractId, getToken, router])

    // ── Loading State ──
    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] gap-6">
                <div className="relative">
                    <div className="w-16 h-16 border-2 border-[#d4af37]/20 rounded-full animate-spin" style={{ borderTopColor: '#d4af37' }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#d4af37] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
                    </div>
                </div>
                <div className="text-center">
                    <p className="text-white font-serif text-lg mb-1">Analyzing Contract</p>
                    <p className="text-zinc-500 text-xs tracking-wide">Running 7-Agent AI Pipeline...</p>
                </div>
                <div className="flex gap-2 mt-2">
                    {['Ingestion', 'Compliance', 'Risk', 'Negotiation', 'Drafting', 'Obligations', 'Classification'].map((step, i) => (
                        <div key={step} className="flex flex-col items-center gap-1">
                            <div
                                className="w-2 h-2 rounded-full bg-[#d4af37] animate-pulse"
                                style={{ animationDelay: `${i * 200}ms` }}
                            />
                            <span className="text-[9px] text-zinc-600 tracking-wider">{step}</span>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // ── Error State ──
    if (error || !reviewData) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] gap-4">
                <span className="material-symbols-outlined text-4xl text-red-400">error</span>
                <p className="text-white text-sm">{error || 'No review data available'}</p>
                <div className="flex gap-3">
                    <button
                        onClick={() => loadReview(true)}
                        className="px-4 py-2 text-xs bg-[#d4af37] text-black font-bold rounded hover:bg-[#b5952f] transition-colors"
                    >
                        Retry Analysis
                    </button>
                    <Link
                        href={`/dashboard/contracts/${contractId}`}
                        className="px-4 py-2 text-xs text-zinc-400 border border-zinc-700 rounded hover:text-white transition-colors"
                    >
                        Back to Detail
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-[#0a0a0a]">
            {/* ── Top Bar ── */}
            <header className="h-14 bg-[#0e0e0e] border-b border-white/5 flex items-center justify-between px-6 flex-shrink-0 z-30">
                <div className="flex items-center gap-4">
                    <Link
                        href={`/dashboard/contracts/${contractId}`}
                        className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1"
                    >
                        <span className="material-symbols-outlined text-sm">arrow_back</span>
                        <span className="text-xs tracking-wide">Detail</span>
                    </Link>
                    <div className="w-px h-5 bg-white/10" />
                    <h1 className="text-white font-serif text-sm font-semibold truncate max-w-[300px]">
                        {contractTitle}
                    </h1>
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20">
                        Review Mode
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => loadReview(true)}
                        className="text-zinc-500 hover:text-white text-xs flex items-center gap-1 transition-colors"
                    >
                        <span className="material-symbols-outlined text-sm">refresh</span>
                        Re-analyze
                    </button>
                </div>
            </header>

            {/* ── AI Insight Banner ── */}
            <AIInsightBanner
                banner={reviewData.banner}
                onSeverityClick={handleBannerClick}
            />

            {/* ── Main Content ── */}
            <div className="flex flex-1 overflow-hidden">
                {/* ── Center: Document Viewer ── */}
                <div className="flex-1 h-full min-w-0 overflow-hidden relative">
                    <DocumentViewer
                        rawDocument={reviewData.raw_document}
                        findings={reviewData.findings}
                        selectedFinding={selectedFinding}
                        hoveredFinding={hoveredFinding}
                        scrollToFindingId={scrollToFinding}
                        onFindingSelect={handleFindingSelect}
                        onFindingHover={setHoveredFinding}
                    />
                </div>

                {/* ── Right Sidebar ── */}
                <div className="w-[380px] h-full flex-shrink-0 overflow-hidden border-l border-white/5 bg-[#0e0e0e]">
                    <AnimatePresence mode="wait">
                        {selectedFinding ? (
                            <motion.div
                                key="risk-panel"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="h-full"
                            >
                                <AdvancedRiskPanel
                                    finding={selectedFinding}
                                    onBack={() => setSelectedFinding(null)}
                                    onAcceptRedline={handleAcceptRedline}
                                    onConvertToTask={handleConvertToTask}
                                />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="quick-panel"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="h-full"
                            >
                                <QuickInsightPanel
                                    insights={reviewData.quick_insights}
                                    findings={reviewData.findings}
                                    onFindingClick={(f) => {
                                        setSelectedFinding(f)
                                        setScrollToFinding(f.finding_id)
                                        setTimeout(() => setScrollToFinding(null), 500)
                                    }}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    )
}
