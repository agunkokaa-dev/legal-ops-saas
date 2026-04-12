'use client'

import { useState, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import { resolveMatterFileUrl } from '@/lib/matter-file-url'

// Strict worker version binding
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerReactPdfProps {
    fileUrl: string
    contractId: string
    scrollToId?: string | null
    notes?: any[]
}

export default function PDFViewerReactPdf({ fileUrl, contractId }: PDFViewerReactPdfProps) {
    const [numPages, setNumPages] = useState<number | null>(null)
    const [pageNumber, setPageNumber] = useState(1)
    const [scale, setScale] = useState(1.0)
    const [pdfUrl, setPdfUrl] = useState<string>('')

    // Resolve Supabase Storage URL if needed
    useEffect(() => {
        setPdfUrl(resolveMatterFileUrl(fileUrl))
    }, [fileUrl])

    function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
        setNumPages(numPages)
    }

    const safeUrl = pdfUrl || resolveMatterFileUrl(fileUrl)

    if (!safeUrl) {
        return <div className="h-full w-full flex items-center justify-center bg-[#0a0a0a] text-neutral-500 text-sm">No document URL provided.</div>
    }

    return (
        <div className="relative w-full h-full bg-[#0a0a0a] overflow-hidden flex flex-col">

            {/* Ultra-Compact Floating Toolbar */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-[#1A1A1A]/90 backdrop-blur-md border border-neutral-800 rounded-md px-2 py-1 shadow-2xl z-50">

                {/* Zoom Out */}
                <button
                    onClick={() => setScale(s => Math.max(0.5, +(s - 0.1).toFixed(1)))}
                    className="p-1 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded transition-all"
                    title="Zoom Out"
                >
                    <span className="material-symbols-outlined text-[14px]">remove</span>
                </button>

                {/* Zoom Indicator */}
                <span className="text-[11px] text-neutral-300 font-mono w-9 text-center tracking-tighter select-none">
                    {Math.round(scale * 100)}%
                </span>

                {/* Zoom In */}
                <button
                    onClick={() => setScale(s => Math.min(3.0, +(s + 0.1).toFixed(1)))}
                    className="p-1 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded transition-all"
                    title="Zoom In"
                >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                </button>

                <div className="w-px h-3 bg-neutral-700 mx-0.5"></div>

                {/* Page Back */}
                <button
                    onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                    disabled={pageNumber <= 1}
                    className="p-1 text-neutral-500 hover:text-white disabled:opacity-30 hover:bg-neutral-800 rounded transition-all"
                    title="Previous Page"
                >
                    <span className="material-symbols-outlined text-[14px]">chevron_left</span>
                </button>

                {/* Page Indicator */}
                <span className="text-[11px] text-neutral-300 font-medium w-10 text-center tracking-tighter select-none">
                    {pageNumber} / {numPages || '-'}
                </span>

                {/* Page Forward */}
                <button
                    onClick={() => setPageNumber(p => Math.min(numPages || 1, p + 1))}
                    disabled={pageNumber >= (numPages || 1)}
                    className="p-1 text-neutral-500 hover:text-white disabled:opacity-30 hover:bg-neutral-800 rounded transition-all"
                    title="Next Page"
                >
                    <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                </button>
            </div>

            {/* Scrollable Document Render Area */}
            <div className="flex-1 overflow-auto flex justify-center pt-14 pb-8 px-4">
                <Document
                    file={safeUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    loading={
                        <div className="flex h-full w-full items-center justify-center text-neutral-500 text-sm">
                            Loading Document...
                        </div>
                    }
                    error={
                        <div className="flex h-full w-full items-center justify-center text-red-400 text-sm p-10">
                            Failed to load document. Check the file URL.
                        </div>
                    }
                >
                    <Page
                        pageNumber={pageNumber}
                        scale={scale}
                        className="shadow-2xl"
                        renderTextLayer={true}
                        renderAnnotationLayer={false}
                    />
                </Document>
            </div>
        </div>
    )
}
