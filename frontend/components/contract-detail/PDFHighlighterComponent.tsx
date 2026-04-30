'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
    PdfLoader,
    PdfHighlighter,
    Highlight,
    Popup,
    AreaHighlight
} from 'react-pdf-highlighter'
import 'react-pdf-highlighter/dist/style.css'
import { getNotesByContract, createNote } from '@/app/actions/noteActions'
import { useRouter } from 'next/navigation'
import { resolveMatterFileUrl } from '@/lib/matter-file-url'
// 1. Stable reference to prevent crash
const EMPTY_HIGHLIGHTS: any[] = [];
// 2. Worker version MUST match the installed pdfjs-dist (4.4.168) used by react-pdf-highlighter
const WORKER_URL = 'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

interface PDFHighlighterComponentProps {
    fileUrl: string
    contractId: string
    scrollToId?: string | null
    notes?: any[]
    draftVersion?: string | null
}

export default function PDFHighlighterComponent({ fileUrl, contractId, scrollToId, notes, draftVersion }: PDFHighlighterComponentProps) {
    const router = useRouter()
    const scrollToFnRef = useRef<((highlight: any) => void) | null>(null)

    const [isMounted, setIsMounted] = useState(false)
    const [highlights, setHighlights] = useState<any[]>([])
    const [isSaving, setIsSaving] = useState(false)

    // Zoom State
    const [scale, setScale] = useState(1.0)
    const [totalPages, setTotalPages] = useState<number>(0)

    const parsedHighlights = useMemo(() => {
        if (!notes || !Array.isArray(notes) || notes.length === 0) {
            return EMPTY_HIGHLIGHTS;
        }

        const validHighlights = notes.map((note) => {
            // Handle cases where the position might be stored as a JSON string in the DB
            let positionData;
            const pos = note.position_data || note.position;
            try {
                positionData = typeof pos === 'string' ? JSON.parse(pos) : pos;
            } catch (e) {
                positionData = null;
            }

            // Only return if valid position data exists
            if (positionData && positionData.boundingRect) {
                return {
                    id: String(note.id),
                    content: { text: note.quote || note.content || note.text || '' },
                    position: positionData,
                    comment: { text: note.comment || '' }
                };
            }
            return null;
        }).filter(Boolean); // Remove any nulls (notes without valid coordinates)

        return validHighlights.length > 0 ? validHighlights : EMPTY_HIGHLIGHTS;
    }, [notes]);

    // Combine parsed with local optimistic state
    const allHighlights = useMemo(() => {
        const parsedIds = new Set((parsedHighlights === EMPTY_HIGHLIGHTS ? [] : parsedHighlights).map((h: any) => h.id));
        const optimistic = highlights.filter(h => !parsedIds.has(String(h.id)) && !parsedIds.has(h.id));

        if (parsedHighlights === EMPTY_HIGHLIGHTS && optimistic.length === 0) {
            return EMPTY_HIGHLIGHTS;
        }
        return [...(parsedHighlights === EMPTY_HIGHLIGHTS ? [] : parsedHighlights), ...optimistic];
    }, [parsedHighlights, highlights]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Save a new highlight
    const addHighlight = useCallback(
        async (highlight: any) => {
            setIsSaving(true)

            // Immediately optimistically update UI
            const optimisticId = `temp-${Date.now()}`
            setHighlights(prev => [{ ...highlight, id: optimisticId }, ...prev])

            try {
                const { data, error } = await createNote({
                    contractId: contractId,
                    quote: highlight.content.text || '',
                    comment: highlight.comment.text || '',
                    positionData: highlight.position,
                    draftVersion: draftVersion || undefined
                })

                if (data && !error) {
                    // Update temp ID with real DB ID
                    setHighlights(prev =>
                        prev.map(h =>
                            h.id === optimisticId ? { ...h, id: data.id } : h
                        )
                    )
                    router.refresh()
                } else {
                    console.error("Failed to save note", error)
                    setHighlights(prev => prev.filter(h => h.id !== optimisticId))
                }
            } catch (error) {
                console.error("Error creating note:", error)
                setHighlights(prev => prev.filter(h => h.id !== optimisticId))
            } finally {
                setIsSaving(false)
            }
        },
        [contractId, router]
    )

    // Scroll to highlight when scrollToId changes
    useEffect(() => {
        if (scrollToId && scrollToFnRef.current) {
            const target = allHighlights.find((h: any) => h.id === scrollToId)
            if (target) {
                scrollToFnRef.current(target)
            }
        }
    }, [scrollToId, allHighlights])

    const safeUrl = resolveMatterFileUrl(fileUrl);

    // DO NOT RENDER ANYTHING until mounted to prevent Strict Mode DOM ref crashes
    if (!isMounted) {
        return <div className="h-full w-full flex items-center justify-center bg-[#1e1e24] text-white">Initializing Workspace...</div>;
    }

    if (!safeUrl) {
        return (
            <div className="h-full w-full flex items-center justify-center bg-[#1e1e24] text-white px-6 text-center">
                Document file URL is unavailable. Re-upload the file or verify the stored Supabase path.
            </div>
        );
    }

    return (
        <div className="relative flex flex-col w-full h-[80vh] min-h-[600px] bg-[#121212] rounded-xl border border-neutral-800 overflow-hidden">

            {/* INJECT PDF PAGE STYLES TO ENSURE WHITE PAPER VISIBILITY */}
            <style dangerouslySetInnerHTML={{
                __html: `
      .pdfViewer .page {
        background-color: #ffffff !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
        margin: 20px auto !important;
      }
    `}} />

            {/* Vertical Floating Control Pad (Bottom Left) */}
            <div className="absolute bottom-6 left-6 flex flex-col items-center gap-2 bg-[#1A1A1A]/90 backdrop-blur-md border border-neutral-700 rounded-lg p-2 shadow-2xl z-50">
                {/* Zoom In */}
                <button onClick={() => setScale(s => Math.min(3.0, +(s + 0.25).toFixed(2)))} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-all" title="Zoom In">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>

                {/* Scale Indicator */}
                <span className="text-[10px] text-neutral-300 font-mono text-center tracking-tighter">
                    {Math.round(scale * 100)}%
                </span>

                {/* Zoom Out */}
                <button onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-all" title="Zoom Out">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                </button>

                {/* Separator */}
                <div className="w-4 h-px bg-neutral-700 my-1"></div>

                {/* Page Info */}
                <span className="text-[10px] text-neutral-400 font-medium text-center" title="Total Pages">
                    {totalPages > 0 ? `${totalPages}p` : '...'}
                </span>
            </div>

            {/* PDF RENDERER AREA - Flex-1 provides height naturally without crushing the library */}
            <div className="flex-1 relative w-full h-full overflow-hidden">
                <PdfLoader url={safeUrl} beforeLoad={<div className="flex h-full items-center justify-center text-neutral-500 font-medium">Loading Document Engine...</div>} workerSrc={WORKER_URL}>
                    {(pdfDocument) => {
                        // Safely update total pages state once the document is loaded
                        if (totalPages !== pdfDocument.numPages) {
                            setTimeout(() => setTotalPages(pdfDocument.numPages), 0);
                        }

                        return (
                            <PdfHighlighter
                                key={`highlighter-${scale}-${contractId}`} // Include scale to force re-init on zoom
                                pdfDocument={pdfDocument}
                                enableAreaSelection={(event) => event.altKey}
                                onScrollChange={() => { }}
                                pdfScaleValue={scale.toString()} // Apply manual state scale
                                highlights={allHighlights} // Stable memory reference
                                scrollRef={(scrollTo) => {
                                    scrollToFnRef.current = scrollTo;
                                }}
                                highlightTransform={(
                                    highlight: any,
                                    index: number,
                                    setTip: any,
                                    hideTip: any,
                                    viewportToScaled: any,
                                    screenshot: any,
                                    isScrolledTo: boolean
                                ) => (
                                    <Highlight
                                        key={index}
                                        isScrolledTo={isScrolledTo}
                                        position={highlight.position}
                                        comment={highlight.comment}
                                    />
                                )}
                                onSelectionFinished={(
                                    position,
                                    content,
                                    hideTipAndSelection,
                                    transformSelection
                                ) => {
                                    // Provide a Tip/Pop-up to ask for the comment when text is selected
                                    return (
                                        <HighlightCommentPrompt
                                            onSave={(comment) => {
                                                addHighlight({ content, position, comment: { text: comment } })
                                                hideTipAndSelection()
                                            }}
                                            onCancel={hideTipAndSelection}
                                        />
                                    );
                                }}
                            />
                        );
                    }}
                </PdfLoader>
            </div>
        </div>
    )
}

// Sub-component rendering the modal/tooltip form indicating new highlights
function HighlightCommentPrompt({ onSave, onCancel }: { onSave: (comment: string) => void, onCancel: () => void }) {
    const [comment, setComment] = useState('')

    return (
        <div className="bg-surface border border-surface-border p-3 rounded-lg shadow-2xl min-w-[250px] animate-in fade-in zoom-in-95 duration-200">
            <h4 className="text-xs font-bold text-white mb-2 font-serif">Add Note</h4>
            <textarea
                value={comment}
                autoFocus
                onChange={(e) => setComment(e.target.value)}
                placeholder="What exactly is important about this clause?"
                className="w-full bg-background border border-surface-border rounded p-2 text-xs text-white placeholder-text-muted focus:ring-1 focus:ring-[#B8B8B8] focus:border-[#B8B8B8] resize-none h-20 mb-3"
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="px-3 py-1 text-xs text-text-muted hover:text-white transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={() => onSave(comment)}
                    className="px-3 py-1 text-xs bg-white text-[#0A0A0A] font-medium rounded hover:bg-gray-200 transition-colors"
                >
                    Save Note
                </button>
            </div>
        </div>
    )
}
