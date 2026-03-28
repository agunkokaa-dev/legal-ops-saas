'use client'

import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ScrollbarMarkers from './ScrollbarMarkers'
import FindingTooltip from './FindingTooltip'

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

/**
 * Splits the raw document into segments — some are plain text, some are
 * highlighted findings. Uses absolute character offsets.
 */
interface TextSegment {
    type: 'text' | 'finding'
    content: string
    start: number
    end: number
    finding?: ReviewFinding
}

function buildSegments(rawDocument: string, findings: ReviewFinding[]): TextSegment[] {
    if (!rawDocument) return []

    // Sort findings by start_char
    const sorted = [...findings]
        .filter(f => f.coordinates && f.coordinates.start_char >= 0 && f.coordinates.end_char > f.coordinates.start_char)
        .sort((a, b) => a.coordinates.start_char - b.coordinates.start_char)

    const segments: TextSegment[] = []
    let cursor = 0

    for (const finding of sorted) {
        const start = finding.coordinates.start_char
        const end = Math.min(finding.coordinates.end_char, rawDocument.length)

        if (start < cursor) continue // overlapping, skip

        // Plain text before this finding
        if (start > cursor) {
            segments.push({
                type: 'text',
                content: rawDocument.slice(cursor, start),
                start: cursor,
                end: start,
            })
        }

        // The finding segment
        segments.push({
            type: 'finding',
            content: rawDocument.slice(start, end),
            start,
            end,
            finding,
        })

        cursor = end
    }

    // Remaining text after last finding
    if (cursor < rawDocument.length) {
        segments.push({
            type: 'text',
            content: rawDocument.slice(cursor),
            start: cursor,
            end: rawDocument.length,
        })
    }

    return segments
}

export default function DocumentViewer({
    rawDocument,
    findings,
    selectedFinding,
    hoveredFinding,
    scrollToFindingId,
    onFindingSelect,
    onFindingHover,
}: {
    rawDocument: string
    findings: ReviewFinding[]
    selectedFinding: ReviewFinding | null
    hoveredFinding: ReviewFinding | null
    scrollToFindingId: string | null
    onFindingSelect: (finding: ReviewFinding) => void
    onFindingHover: (finding: ReviewFinding | null) => void
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const findingRefs = useRef<Map<string, HTMLElement>>(new Map())
    const [tooltipTarget, setTooltipTarget] = useState<{
        finding: ReviewFinding
        rect: DOMRect
    } | null>(null)

    // ── Build text segments ──
    const segments = useMemo(
        () => buildSegments(rawDocument, findings),
        [rawDocument, findings]
    )

    // ── Auto-scroll to finding ──
    useEffect(() => {
        if (!scrollToFindingId) return
        const el = findingRefs.current.get(scrollToFindingId)
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Flash animation
            el.classList.add('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-[#0a0a0a]')
            setTimeout(() => {
                el.classList.remove('ring-2', 'ring-[#d4af37]', 'ring-offset-2', 'ring-offset-[#0a0a0a]')
            }, 2000)
        }
    }, [scrollToFindingId])

    // Register finding element ref
    const setFindingRef = useCallback((id: string, el: HTMLElement | null) => {
        if (el) findingRefs.current.set(id, el)
        else findingRefs.current.delete(id)
    }, [])

    // ── Hover handler ──
    const handleMouseEnter = useCallback((finding: ReviewFinding, e: React.MouseEvent) => {
        onFindingHover(finding)
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setTooltipTarget({ finding, rect })
    }, [onFindingHover])

    const handleMouseLeave = useCallback(() => {
        onFindingHover(null)
        setTooltipTarget(null)
    }, [onFindingHover])

    return (
        <div className="relative h-full flex">
            {/* ── Document Container ── */}
            <div
                ref={containerRef}
                className="flex-1 h-full overflow-y-auto p-8 pb-24"
                style={{ scrollBehavior: 'smooth' }}
            >
                {/* A4-style paper container */}
                <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-2xl shadow-black/40 min-h-[1056px]">
                    <div className="p-12 md:p-16">
                        <div className="font-serif text-[15px] leading-relaxed text-black" style={{ whiteSpace: 'pre-wrap' }}>
                            {segments.map((seg, idx) => {
                                if (seg.type === 'text') {
                                    return <span key={`t-${idx}`}>{seg.content}</span>
                                }

                                const finding = seg.finding!
                                const isSelected = selectedFinding?.finding_id === finding.finding_id
                                const isAccepted = finding.status === 'accepted'
                                const colors = isAccepted ? ACCEPTED_COLORS : SEVERITY_COLORS[finding.severity]

                                return (
                                    <mark
                                        key={`f-${finding.finding_id}`}
                                        ref={(el) => setFindingRef(finding.finding_id, el)}
                                        data-finding-id={finding.finding_id}
                                        className={`
                                            relative cursor-pointer transition-all duration-300 rounded-sm
                                            border-l-4 px-1 -mx-1
                                            ${colors.bg} ${colors.border} ${colors.hoverBg}
                                            ${isSelected ? 'ring-2 ring-[#d4af37] ring-offset-1 ring-offset-white shadow-lg' : ''}
                                        `}
                                        style={{
                                            backgroundColor: isAccepted
                                                ? 'rgba(34, 197, 94, 0.08)'
                                                : finding.severity === 'critical'
                                                    ? 'rgba(239, 68, 68, 0.08)'
                                                    : finding.severity === 'warning'
                                                        ? 'rgba(245, 158, 11, 0.08)'
                                                        : 'rgba(59, 130, 246, 0.08)',
                                            color: 'inherit',
                                        }}
                                        onClick={() => onFindingSelect(finding)}
                                        onMouseEnter={(e) => handleMouseEnter(finding, e)}
                                        onMouseLeave={handleMouseLeave}
                                    >
                                        {seg.content}
                                    </mark>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Scrollbar Side Markers ── */}
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

            {/* ── Tooltip ── */}
            <AnimatePresence>
                {tooltipTarget && (
                    <FindingTooltip
                        finding={tooltipTarget.finding}
                        targetRect={tooltipTarget.rect}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}
