'use client'

import { useMemo } from 'react'

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

const SEVERITY_DOT_COLORS: Record<string, string> = {
    critical: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
}

export default function ScrollbarMarkers({
    findings,
    documentLength,
    containerRef,
    onMarkerClick,
}: {
    findings: ReviewFinding[]
    documentLength: number
    containerRef: React.RefObject<HTMLDivElement | null>
    onMarkerClick: (finding: ReviewFinding) => void
}) {
    // Calculate proportional positions
    const markers = useMemo(() => {
        if (!documentLength || documentLength === 0) return []
        return findings
            .filter(f => f.status === 'open' && f.coordinates)
            .map(f => ({
                finding: f,
                position: (f.coordinates.start_char / documentLength) * 100,
            }))
    }, [findings, documentLength])

    if (markers.length === 0) return null

    return (
        <div
            className="w-4 h-full flex-shrink-0 relative bg-transparent"
            aria-label="Finding markers"
        >
            {/* Track background */}
            <div className="absolute inset-x-0 top-0 bottom-0 flex items-stretch">
                <div className="w-full bg-white/[0.02] rounded-r" />
            </div>

            {/* Marker dots */}
            {markers.map(({ finding, position }) => (
                <button
                    key={finding.finding_id}
                    className="absolute left-1/2 -translate-x-1/2 group z-10"
                    style={{ top: `${Math.max(2, Math.min(position, 98))}%` }}
                    onClick={() => onMarkerClick(finding)}
                    title={finding.title}
                >
                    {/* Outer glow */}
                    <div
                        className="w-4 h-4 rounded-full opacity-30 group-hover:opacity-60 transition-opacity absolute -inset-1 blur-sm"
                        style={{ backgroundColor: SEVERITY_DOT_COLORS[finding.severity] }}
                    />
                    {/* Dot */}
                    <div
                        className="w-2.5 h-2.5 rounded-full relative shadow-sm group-hover:scale-150 transition-transform cursor-pointer"
                        style={{ backgroundColor: SEVERITY_DOT_COLORS[finding.severity] }}
                    />
                </button>
            ))}
        </div>
    )
}
