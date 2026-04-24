'use client'

import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import ScrollbarMarkers from './ScrollbarMarkers'
import FindingPopover from './FindingPopover'
import { sanitizeContractHtml } from '@/lib/contractHtml'
import { DISALLOWED_MARKDOWN_ELEMENTS } from '@/lib/markdownSafety'

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

// ── Severity → color mapping ──
const SEVERITY_COLORS = {
    critical: {
        bg: 'bg-red-500/8',
        border: 'border-l-red-500',
        hoverBg: 'hover:bg-red-500/15',
        dot: 'bg-red-500',
    },
    warning: {
        bg: 'bg-amber-500/8',
        border: 'border-l-amber-500',
        hoverBg: 'hover:bg-amber-500/15',
        dot: 'bg-amber-500',
    },
    info: {
        bg: 'bg-blue-500/8',
        border: 'border-l-blue-500',
        hoverBg: 'hover:bg-blue-500/15',
        dot: 'bg-blue-500',
    },
}

const ACCEPTED_COLORS = {
    bg: 'bg-green-500/8',
    border: 'border-l-green-500',
    hoverBg: 'hover:bg-green-500/15',
    dot: 'bg-green-500',
}

// ── Layer 1: Validate coordinates against source_text ──
interface ValidatedRange {
    start: number
    end: number
    finding_id: string
}

function validateCoordinates(rawDocument: string, findings: ReviewFinding[]): ValidatedRange[] {
    const validated: ValidatedRange[] = []

    for (const finding of findings) {
        if (!finding.coordinates) continue
        const { start_char, end_char, source_text } = finding.coordinates
        if (start_char < 0 || end_char <= start_char) continue

        let finalStart = start_char
        let finalEnd = Math.min(end_char, rawDocument.length)

        // Layer 2: Check if the indices actually match the expected source_text
        if (source_text && source_text.length > 0) {
            const sliced = rawDocument.slice(finalStart, finalEnd)
            const normalizedSlice = sliced.replace(/\s+/g, ' ').trim()
            const normalizedSource = source_text.replace(/\s+/g, ' ').trim()

            if (!normalizedSlice.includes(normalizedSource) && !normalizedSource.includes(normalizedSlice)) {
                // Indices are stale/wrong — use indexOf fallback
                const fallbackIdx = rawDocument.indexOf(source_text)
                if (fallbackIdx !== -1) {
                    finalStart = fallbackIdx
                    finalEnd = fallbackIdx + source_text.length
                } else {
                    // Try normalized search as last resort
                    const normDoc = rawDocument.replace(/\s+/g, ' ')
                    const normIdx = normDoc.indexOf(normalizedSource)
                    if (normIdx !== -1) {
                        // Map normalized index back — approximate, but better than nothing
                        finalStart = normIdx
                        finalEnd = normIdx + normalizedSource.length
                    } else {
                        // Cannot locate this finding in the document at all — skip it
                        continue
                    }
                }
            }
        }

        // Clamp to document bounds
        finalStart = Math.max(0, finalStart)
        finalEnd = Math.min(rawDocument.length, finalEnd)
        if (finalEnd <= finalStart) continue

        validated.push({ start: finalStart, end: finalEnd, finding_id: finding.finding_id })
    }

    return validated
}

// ── Layer 3: Merge overlapping ranges ──
interface MergedRange {
    start: number
    end: number
    finding_ids: string[]
}

function mergeOverlappingRanges(ranges: ValidatedRange[]): MergedRange[] {
    if (ranges.length === 0) return []

    // Sort ascending by start
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)

    const merged: MergedRange[] = []
    let current: MergedRange = {
        start: sorted[0].start,
        end: sorted[0].end,
        finding_ids: [sorted[0].finding_id],
    }

    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i]
        if (next.start < current.end) {
            // Overlap detected — merge
            current.end = Math.max(current.end, next.end)
            current.finding_ids.push(next.finding_id)
        } else {
            merged.push(current)
            current = { start: next.start, end: next.end, finding_ids: [next.finding_id] }
        }
    }
    merged.push(current)

    return merged
}

// ── Main injection: reverse loop with validated, merged ranges ──
function buildInjectedMarkdown(rawDocument: string, findings: ReviewFinding[]): string {
    if (!rawDocument) return ''

    // Step 1: Validate all coordinates
    const validated = validateCoordinates(rawDocument, findings)

    // Step 2: Merge overlapping ranges
    const merged = mergeOverlappingRanges(validated)

    // Step 3: Sort DESCENDING for reverse injection (bottom-up)
    merged.sort((a, b) => b.start - a.start)

    let modified = rawDocument

    for (const range of merged) {
        const text = modified.slice(range.start, range.end)
        // Use the first finding_id as the primary (for click/scroll targeting)
        // Store all IDs as a comma-separated attribute for multi-finding awareness
        const primaryId = range.finding_ids[0]
        const allIds = range.finding_ids.join(',')
        const tag = `<mark data-finding-id="${primaryId}" data-all-finding-ids="${allIds}">${text}</mark>`
        modified = modified.slice(0, range.start) + tag + modified.slice(range.end)
    }

    return modified
}

export default function DocumentViewer({
    rawDocument,
    findings,
    selectedFinding,
    hoveredFinding,
    scrollToFindingId,
    isBlurred,
    onFindingSelect,
    onFindingHover,
    onAcceptRedline,
    onConvertToTask,
}: {
    rawDocument: string
    findings: ReviewFinding[]
    selectedFinding: ReviewFinding | null
    hoveredFinding: ReviewFinding | null
    scrollToFindingId: string | null
    isBlurred?: boolean
    onFindingSelect: (finding: ReviewFinding) => void
    onFindingHover: (finding: ReviewFinding | null) => void
    onAcceptRedline: (finding: ReviewFinding) => Promise<void>
    onConvertToTask: (finding: ReviewFinding) => Promise<void>
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const findingRefs = useRef<Map<string, HTMLElement>>(new Map())
    const [popoverTarget, setPopoverTarget] = useState<{
        finding: ReviewFinding
        rect: DOMRect
    } | null>(null)

    // ── Build markdown with injected marks ──
    const injectedMarkdown = useMemo(
        () => buildInjectedMarkdown(rawDocument, findings),
        [rawDocument, findings]
    )
    const safeInjectedMarkdown = useMemo(
        () => sanitizeContractHtml(injectedMarkdown),
        [injectedMarkdown]
    )

    // ── Auto-scroll to finding ──
    useEffect(() => {
        if (!scrollToFindingId) return
        const el = findingRefs.current.get(scrollToFindingId)
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white')
            setTimeout(() => {
                el.classList.remove('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-white')
            }, 2000)
        }
    }, [scrollToFindingId])

    const setFindingRef = useCallback((id: string, el: HTMLElement | null) => {
        if (el) findingRefs.current.set(id, el)
        else findingRefs.current.delete(id)
    }, [])

    // ── Click handler (click-to-popover, not hover) ──
    const handleFindingClick = useCallback((finding: ReviewFinding, e: React.MouseEvent) => {
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        // Toggle: if same finding clicked again, close popover
        if (popoverTarget?.finding.finding_id === finding.finding_id) {
            setPopoverTarget(null)
        } else {
            setPopoverTarget({ finding, rect })
        }
    }, [popoverTarget])

    // Close popover on outside click
    const handleContainerClick = useCallback(() => {
        setPopoverTarget(null)
    }, [])

    // Close popover when selectedFinding changes (sidebar opened)
    useEffect(() => {
        if (selectedFinding) setPopoverTarget(null)
    }, [selectedFinding])

    return (
        <div className="relative h-full flex" onClick={handleContainerClick}>
            {/* ── Document Container ── */}
            <div
                ref={containerRef}
                className={`flex-1 h-full overflow-y-auto p-8 pb-24 transition-all duration-500 ${
                    isBlurred ? 'blur-md opacity-40 pointer-events-none select-none' : 'blur-0 opacity-100'
                }`}
                style={{ scrollBehavior: 'smooth' }}
            >
                {/* A4-style paper container */}
                <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-2xl shadow-black/40 min-h-[1056px]">
                    <div className="p-12 md:p-16">
                        <div className="prose prose-sm max-w-none text-black">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                                disallowedElements={DISALLOWED_MARKDOWN_ELEMENTS}
                                unwrapDisallowed
                                components={{
                                    mark: ({ node, children, ...props }: any) => {
                                        const primaryId = props['data-finding-id']
                                        const allIdsStr: string = props['data-all-finding-ids'] || primaryId
                                        const allIds = allIdsStr.split(',').filter(Boolean)

                                        // Find all associated findings
                                        const associatedFindings = allIds
                                            .map(id => findings.find(f => f.finding_id === id))
                                            .filter(Boolean) as ReviewFinding[]

                                        if (associatedFindings.length === 0) return <mark {...props}>{children}</mark>

                                        // Pick highest severity for styling: critical > warning > info
                                        const severityPriority = { critical: 3, warning: 2, info: 1 }
                                        const primaryFinding = associatedFindings.reduce((best, f) =>
                                            (severityPriority[f.severity] || 0) > (severityPriority[best.severity] || 0) ? f : best
                                        , associatedFindings[0])

                                        const isSelected = allIds.some(id => selectedFinding?.finding_id === id)
                                        const isPopoverOpen = allIds.some(id => popoverTarget?.finding.finding_id === id)
                                        const isAccepted = primaryFinding.status === 'accepted'
                                        const colors = isAccepted ? ACCEPTED_COLORS : SEVERITY_COLORS[primaryFinding.severity]

                                        return (
                                            <mark
                                                ref={(el) => {
                                                    // Register ref for every finding_id so scroll-to works for any
                                                    allIds.forEach(id => setFindingRef(id, el))
                                                }}
                                                data-finding-id={primaryId}
                                                className={`
                                                    relative cursor-pointer transition-all duration-300 rounded-sm
                                                    border-l-4 px-1 -mx-1
                                                    ${colors.bg} ${colors.border} ${colors.hoverBg}
                                                    ${isSelected || isPopoverOpen ? 'ring-2 ring-[#d4af37] ring-offset-1 ring-offset-white shadow-lg' : ''}
                                                `}
                                                style={{
                                                    backgroundColor: isAccepted
                                                        ? 'rgba(34, 197, 94, 0.08)'
                                                        : primaryFinding.severity === 'critical'
                                                            ? 'rgba(239, 68, 68, 0.08)'
                                                            : primaryFinding.severity === 'warning'
                                                                ? 'rgba(245, 158, 11, 0.08)'
                                                                : 'rgba(59, 130, 246, 0.08)',
                                                    color: 'inherit',
                                                }}
                                                onClick={(e) => handleFindingClick(primaryFinding, e)}
                                                onMouseEnter={() => onFindingHover(primaryFinding)}
                                                onMouseLeave={() => onFindingHover(null)}
                                            >
                                                {children}
                                            </mark>
                                        )
                                    }
                                }}
                            >
                                {safeInjectedMarkdown}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Scrollbar Side Markers ── */}
            {!isBlurred && (
                <ScrollbarMarkers
                    findings={findings}
                    documentLength={rawDocument.length}
                    containerRef={containerRef}
                    onMarkerClick={(finding) => {
                        onFindingSelect(finding)
                        const el = findingRefs.current.get(finding.finding_id)
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                />
            )}

            {/* ── Click-to-Open Popover ── */}
            <AnimatePresence>
                {popoverTarget && !isBlurred && (
                    <FindingPopover
                        finding={popoverTarget.finding}
                        targetRect={popoverTarget.rect}
                        onAcceptRedline={onAcceptRedline}
                        onConvertToTask={onConvertToTask}
                        onViewDetails={(f) => {
                            onFindingSelect(f)
                            setPopoverTarget(null)
                        }}
                        onClose={() => setPopoverTarget(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}
