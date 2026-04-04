'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'framer-motion'
import HeroOverlay from './HeroOverlay'
import DocumentViewer from './DocumentViewer'
import AISidebar from './AISidebar'
import FindingCard from './FindingCard'
import Link from 'next/link'
import { createTask } from '@/app/actions/taskActions'

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
    const [loadingPhase, setLoadingPhase] = useState<'checking' | 'analyzing' | 'finalizing'>('checking')
    const [error, setError] = useState<string | null>(null)

    // ── UI State ──
    const [showHero, setShowHero] = useState(true)
    const [selectedFinding, setSelectedFinding] = useState<ReviewFinding | null>(null)
    const [hoveredFinding, setHoveredFinding] = useState<ReviewFinding | null>(null)
    const [scrollToFinding, setScrollToFinding] = useState<string | null>(null)

    // ── Wizard State ──
    const [wizardMode, setWizardMode] = useState(false)
    const [wizardIndex, setWizardIndex] = useState(0)

    // Critical findings for wizard
    const wizardFindings = useMemo(() => {
        if (!reviewData) return []
        return reviewData.findings.filter(f => f.severity === 'critical' && f.status === 'open' && f.suggested_revision)
    }, [reviewData])

    // ── Load Review Data ──
    const loadReview = useCallback(async (forceRefresh = false) => {
        try {
            setIsLoading(true)
            setError(null)
            setLoadingPhase('checking')
            const token = await getToken()
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

            if (!forceRefresh) {
                try {
                    const cached = await fetch(`${apiUrl}/api/v1/review/${contractId}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    })
                    if (cached.ok) {
                        const data = await cached.json()
                        if (data.found && data.review) {
                            setReviewData(data.review)
                            setIsLoading(false)
                            return
                        }
                    }
                } catch (cacheErr) {
                    console.warn('Cache check failed, proceeding to fresh analysis:', cacheErr)
                }
            }

            setLoadingPhase('analyzing')
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
                throw new Error(err.detail || `Analysis failed (HTTP ${res.status})`)
            }

            setLoadingPhase('finalizing')
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

    // ── Hero Handlers ──
    const handleHeroDismiss = useCallback(() => {
        setShowHero(false)
    }, [])

    const handleStartWizard = useCallback(() => {
        setShowHero(false)
        if (wizardFindings.length > 0) {
            setWizardMode(true)
            setWizardIndex(0)
            const first = wizardFindings[0]
            setSelectedFinding(first)
            setScrollToFinding(first.finding_id)
            setTimeout(() => setScrollToFinding(null), 600)
        }
    }, [wizardFindings])

    // ── Wizard: advance to next finding ──
    const handleWizardNext = useCallback(() => {
        const nextIdx = wizardIndex + 1
        if (nextIdx < wizardFindings.length) {
            setWizardIndex(nextIdx)
            const next = wizardFindings[nextIdx]
            setSelectedFinding(next)
            setScrollToFinding(next.finding_id)
            setTimeout(() => setScrollToFinding(null), 600)
        } else {
            // Wizard complete
            setWizardMode(false)
            setSelectedFinding(null)
            toast.success('All critical issues reviewed!', {
                style: { background: '#1a1a1a', border: '1px solid #22c55e', color: '#fff' },
                icon: '🎉',
            })
        }
    }, [wizardIndex, wizardFindings])

    // ── Finding Click (from sidebar) ──
    const handleFindingClick = useCallback((finding: ReviewFinding) => {
        setSelectedFinding(finding)
        setScrollToFinding(finding.finding_id)
        setTimeout(() => setScrollToFinding(null), 600)
        if (wizardMode) setWizardMode(false)
    }, [wizardMode])

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
            toast.success('Revision applied to document.', {
                style: { background: '#1a1a1a', border: '1px solid #22c55e', color: '#fff' }
            })

            setReviewData(prev => {
                if (!prev) return prev
                return {
                    ...prev,
                    raw_document: data.updated_document,
                    findings: data.updated_findings,
                    banner: {
                        ...prev.banner,
                        critical_count: (data.updated_findings || []).filter((f: ReviewFinding) => f.severity === 'critical' && f.status === 'open').length,
                        warning_count: (data.updated_findings || []).filter((f: ReviewFinding) => f.severity === 'warning' && f.status === 'open').length,
                        info_count: (data.updated_findings || []).filter((f: ReviewFinding) => f.severity === 'info' && f.status === 'open').length,
                        total_count: (data.updated_findings || []).filter((f: ReviewFinding) => f.status === 'open').length,
                    }
                }
            })
            
            setSelectedFinding(prev => prev && prev.finding_id === finding.finding_id ? { ...prev, status: 'accepted' } : prev)
            router.refresh()
            
        } catch (e: any) {
            toast.error(e.message || 'Failed to accept redline')
        }
    }, [contractId, getToken, router])

    // ── Convert to Task (uses proven Server Action — same as Notes→Task) ──
    const handleConvertToTask = useCallback(async (finding: ReviewFinding) => {
        try {
            const autoTitle = finding.title.length > 80
                ? finding.title.substring(0, 80) + '...'
                : finding.title

            const res = await createTask({
                title: `[Review] ${autoTitle}`,
                description: (
                    `**Source:** AI Contract Review\n\n` +
                    `**Contract ID:** ${contractId}\n\n` +
                    `**Severity:** ${finding.severity}\n\n` +
                    `**Category:** ${finding.category}\n\n` +
                    `**Finding:**\n${finding.description}`
                ),
                status: 'backlog',
                matterId: matterId,
            })

            if (res.error) {
                console.error('API REJECTED:', res.error)
                throw new Error(res.error)
            }

            toast.success('✅ Task successfully added to Backlog.', {
                style: { background: '#1a1a1a', border: '1px solid #d4af37', color: '#fff' },
                duration: 6000,
                action: {
                    label: 'Open Task Management',
                    onClick: () => router.push('/dashboard/tasks')
                }
            })
        } catch (e: any) {
            toast.error(`❌ Failed to create task: ${e.message || 'Unknown error'}`, {
                style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' }
            })
            throw e
        }
    }, [matterId, contractId, router])

    // ── Edit in Drafting (Review-to-Draft Bridge) ──
    const handleEditInDrafting = useCallback((finding: ReviewFinding) => {
        router.push(
            `/dashboard/drafting/${matterId}?mode=review&contract_id=${contractId}&focus_finding=${finding.finding_id}`
        )
    }, [matterId, contractId, router])

    // ── Loading State ──
    if (isLoading) {
        const phaseMessages = {
            checking: { title: 'Checking for Cached Review', subtitle: 'Looking up existing analysis data...' },
            analyzing: { title: 'AI is Analyzing This Document', subtitle: 'Running 7-Agent LangGraph Pipeline — this may take 30-60 seconds...' },
            finalizing: { title: 'Finalizing Results', subtitle: 'Structuring findings and insights...' }
        }
        const phase = phaseMessages[loadingPhase]
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] gap-6">
                <div className="relative">
                    <div className="w-16 h-16 border-2 border-[#d4af37]/20 rounded-full animate-spin" style={{ borderTopColor: '#d4af37' }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#d4af37] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
                    </div>
                </div>
                <div className="text-center">
                    <p className="text-white font-serif text-lg mb-1">{phase.title}</p>
                    <p className="text-zinc-500 text-xs tracking-wide">{phase.subtitle}</p>
                </div>
                {loadingPhase === 'analyzing' && (
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
                )}
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
            <header className="h-12 bg-[#0e0e0e] border-b border-white/5 flex items-center justify-between px-6 flex-shrink-0 z-30">
                <div className="flex items-center gap-3">
                    <Link
                        href={`/dashboard/contracts/${contractId}`}
                        className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1"
                    >
                        <span className="material-symbols-outlined text-sm">arrow_back</span>
                        <span className="text-xs tracking-wide">Detail</span>
                    </Link>
                    <div className="w-px h-4 bg-white/10" />
                    <h1 className="text-white font-serif text-sm font-semibold truncate max-w-[300px]">
                        {contractTitle}
                    </h1>
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20">
                        {wizardMode ? 'Wizard Mode' : 'Review Mode'}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {/* Summary badges */}
                    <div className="flex items-center gap-1.5">
                        {reviewData.banner.critical_count > 0 && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 rounded">
                                {reviewData.banner.critical_count} Critical
                            </span>
                        )}
                        {reviewData.banner.warning_count > 0 && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">
                                {reviewData.banner.warning_count} Warnings
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => loadReview(true)}
                        className="text-zinc-500 hover:text-white text-xs flex items-center gap-1 transition-colors"
                    >
                        <span className="material-symbols-outlined text-sm">refresh</span>
                        Re-analyze
                    </button>
                </div>
            </header>

            {/* ── Main Content ── */}
            <div className="flex flex-1 overflow-hidden relative">
                {/* ── Panel 1: Left Navigation Sidebar ── */}
                <div className="w-[320px] h-full flex-shrink-0 overflow-hidden border-r border-white/5 bg-[#0a0a0a] z-10 shadow-[4px_0_24px_rgba(0,0,0,0.5)]">
                    <AISidebar
                        banner={reviewData.banner}
                        findings={reviewData.findings}
                        quickInsights={reviewData.quick_insights}
                        selectedFinding={selectedFinding}
                        onFindingClick={handleFindingClick}
                        onConvertToTask={handleConvertToTask}
                    />
                </div>

                {/* ── Panel 2: Center Document Viewer ── */}
                <div className="flex-1 h-full min-w-0 overflow-hidden relative bg-[#121212]">
                    <DocumentViewer
                        rawDocument={reviewData.raw_document}
                        findings={reviewData.findings}
                        selectedFinding={selectedFinding}
                        hoveredFinding={hoveredFinding}
                        scrollToFindingId={scrollToFinding}
                        isBlurred={showHero}
                        onFindingSelect={handleFindingClick}
                        onFindingHover={setHoveredFinding}
                        onAcceptRedline={handleAcceptRedline}
                        onConvertToTask={handleConvertToTask}
                    />
                </div>

                {/* ── Panel 3: Right Co-Counsel Area ── */}
                <div className="w-[360px] h-full flex-shrink-0 overflow-hidden border-l border-white/5 bg-[#0a0a0a] z-10 shadow-[-4px_0_24px_rgba(0,0,0,0.5)]">
                    <AnimatePresence mode="wait">
                        {selectedFinding ? (
                            <FindingCard
                                key={`card-${selectedFinding.finding_id}`}
                                finding={selectedFinding}
                                onBack={() => {
                                    setSelectedFinding(null)
                                    if (wizardMode) setWizardMode(false)
                                }}
                                onAcceptRedline={handleAcceptRedline}
                                onConvertToTask={handleConvertToTask}
                                onEditInDrafting={handleEditInDrafting}
                                wizardMode={wizardMode}
                                wizardProgress={wizardMode ? { current: wizardIndex + 1, total: wizardFindings.length } : undefined}
                                onWizardNext={wizardMode ? handleWizardNext : undefined}
                            />
                        ) : (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex flex-col items-center justify-center h-full text-zinc-500 p-8 text-center"
                            >
                                <span className="material-symbols-outlined text-4xl mb-4 opacity-40">analytics</span>
                                <h3 className="text-white font-serif font-bold text-sm mb-2">Select an Issue</h3>
                                <p className="text-[12px] leading-relaxed">
                                    Click any finding from the left panel to review AI-generated risk analysis and suggestions.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* ── Hero Overlay ── */}
            {showHero && (
                <HeroOverlay
                    banner={reviewData.banner}
                    findings={reviewData.findings}
                    quickInsights={reviewData.quick_insights}
                    onDismiss={handleHeroDismiss}
                    onStartWizard={handleStartWizard}
                />
            )}
        </div>
    )
}
