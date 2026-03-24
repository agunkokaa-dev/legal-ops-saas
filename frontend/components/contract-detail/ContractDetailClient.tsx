'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import IntelligenceSidebar from './IntelligenceSidebar'
import PDFViewerWrapper from './PDFViewerWrapper'
import jsPDF from 'jspdf'

export default function ContractDetailClient({
    pdfUrl,
    contract,
    obligations,
    notes,
    clientName,
    graphDocs,
    graphRels
}: {
    pdfUrl: string,
    contract: any,
    obligations: any[],
    notes: any[],
    clientName: string,
    graphDocs: any[],
    graphRels: any[]
}) {
    const [scrollToId, setScrollToId] = useState<string | null>(null);
    const router = useRouter();

    // Lock-for-Review Options
    const [isLockedForReview, setIsLockedForReview] = useState(false);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [currentDraftVersion, setCurrentDraftVersion] = useState<string | null>(null);
    const [showUnlockModal, setShowUnlockModal] = useState(false);

    // String hasher
    const generateHash = (str: string) => {
        let hash = 0;
        for (let i = 0, len = str.length; i < len; i++) {
            let chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0;
        }
        return `v_${Math.abs(hash)}_${Date.now()}`;
    };

    const parsedDraftText = useMemo(() => {
        if (!contract?.draft_revisions) return "";
        
        let rawDraft = contract.draft_revisions;
        if (typeof rawDraft === 'string') {
            try {
                rawDraft = JSON.parse(rawDraft);
            } catch (e) {
                return rawDraft;
            }
        }
        
        if (rawDraft?.latest_text) return rawDraft.latest_text;
        
        if (Array.isArray(rawDraft)) {
            return rawDraft.map((item: any, index: number) => 
                `📌 PASAL REVISI ${index + 1}\n\n[Isu Awal]:\n${item.original_issue}\n\n[Saran Redaksi AI]:\n${item.neutral_rewrite}`
            ).join('\n\n' + '─'.repeat(40) + '\n\n');
        }
        
        return typeof rawDraft === 'string' ? rawDraft : JSON.stringify(rawDraft);
    }, [contract?.draft_revisions]);

    const handleLockForReview = () => {
        setIsLockedForReview(true);
        const newVersion = generateHash(parsedDraftText);
        setCurrentDraftVersion(newVersion);

        try {
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'pt',
                format: 'a4'
            });

            const pageHeight = doc.internal.pageSize.getHeight();
            const pageWidth = doc.internal.pageSize.getWidth();

            // Explicitly draw a white rectangle to prevent transparent dark-mode black text
            doc.setFillColor(255, 255, 255);
            doc.rect(0, 0, pageWidth, pageHeight, 'F');

            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);

            const margin = 50;
            const maxLineWidth = pageWidth - (margin * 2);

            // Strip HTML tags if any exist (since jspdf doesn't render HTML natively)
            let plainText = parsedDraftText.replace(/<[^>]*>?/gm, '');

            const lines = doc.splitTextToSize(plainText || "No content available.", maxLineWidth);
            let cursorY = margin + 20;

            for (let i = 0; i < lines.length; i++) {
                if (cursorY + 16 > pageHeight - margin) {
                    doc.addPage();
                    doc.setFillColor(255, 255, 255);
                    doc.rect(0, 0, pageWidth, pageHeight, 'F');
                    cursorY = margin + 20;
                }
                doc.text(lines[i], margin, cursorY);
                cursorY += 16;
            }

            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            setPdfBlobUrl(url);
            
            console.log("Generated PDF Blob URL:", url);
        } catch (error) {
            console.error("Error generating PDF:", error);
            setIsLockedForReview(false);
            alert("Failed to generated PDF for Review Mode.");
        }
    };

    useEffect(() => {
        if ((contract?.status === 'Review' || contract?.status === 'Pending Review') && !isLockedForReview && parsedDraftText) {
            handleLockForReview(); 
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.status, parsedDraftText, isLockedForReview]);

    const confirmUnlock = () => {
        setIsLockedForReview(false);
        setShowUnlockModal(false);
        if (pdfBlobUrl) {
            URL.revokeObjectURL(pdfBlobUrl);
            setPdfBlobUrl(null);
        }
    };

    const filteredNotes = useMemo(() => {
        if (!isLockedForReview) return [];
        return notes.filter(n => {
            const pos = typeof n.position_data === 'string' ? JSON.parse(n.position_data) : n.position_data;
            return pos?.draft_version === currentDraftVersion;
        });
    }, [notes, isLockedForReview, currentDraftVersion]);

    return (
        <div className="flex h-[calc(100vh-70px)] w-full overflow-hidden bg-background">
            {/* LEFT: PDF Viewer or Live Draft Viewer */}
            <div className="flex-1 h-full min-w-0 overflow-hidden relative">
                {showUnlockModal && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-sm text-center shadow-2xl">
                            <h3 className="text-white text-lg font-bold font-serif mb-2">Unlock Document?</h3>
                            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                                Unlocking will change the document layout. Previous highlights will be hidden from the document to prevent misalignment, but notes remain in the sidebar.
                            </p>
                            <div className="flex justify-between gap-4">
                                <button onClick={() => setShowUnlockModal(false)} className="flex-1 py-2 text-sm text-gray-300 hover:text-white transition-colors border border-gray-600 rounded">
                                    Stay in Review
                                </button>
                                <button onClick={confirmUnlock} className="flex-1 py-2 text-sm bg-white text-black font-semibold rounded hover:bg-gray-200 transition-colors">
                                    Continue Editing
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {(pdfUrl && contract.status !== 'Draft') || (isLockedForReview && pdfBlobUrl) ? (
                    <PDFViewerWrapper
                        fileUrl={isLockedForReview && pdfBlobUrl ? pdfBlobUrl : pdfUrl}
                        contractId={contract.id}
                        scrollToId={scrollToId}
                        notes={isLockedForReview ? filteredNotes : notes}
                        draftVersion={currentDraftVersion}
                    />
                ) : (
                    <div className="w-full h-full flex flex-col bg-[#0a0a0a] p-6">
                            {/* Dynamic Banner */}
                            <div className="w-full bg-[#d4af37]/10 border border-[#d4af37]/30 text-[#d4af37] px-4 py-3 rounded-lg mb-4 flex items-center justify-between flex-shrink-0 shadow-lg">
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                                        📝 Live Draft Mode
                                    </span>
                                    <span className="text-[10px] text-[#d4af37]/70 italic hidden md:inline mt-0.5">
                                        HTML Reflow Enabled. Lock the document to apply highlights.
                                    </span>
                                </div>
                                <button 
                                    onClick={handleLockForReview}
                                    className="px-4 py-1.5 bg-[#d4af37]/20 hover:bg-[#d4af37]/30 border border-[#d4af37]/50 rounded text-xs font-bold transition-colors uppercase tracking-wider flex items-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">lock</span> Lock for Review
                                </button>
                            </div>

                            {/* Live Draft Document Viewer */}
                            <div className="w-full h-full bg-[#141414] p-4 md:p-8 overflow-y-auto rounded-xl border border-white/5 flex justify-center shadow-inner relative">
                                <div className="w-full max-w-[850px] bg-white text-black p-12 md:p-16 rounded shadow-2xl min-h-[1056px]">
                                    <div className="font-serif leading-relaxed space-y-6 text-[15px] whitespace-pre-wrap">
                                        {parsedDraftText || "No draft content available."}
                                    </div>
                                </div>
                            </div>
                    </div>
                )}
            </div>
            {/* RIGHT: Sidebar - fixed width, strict height */}
            <div className="w-[400px] h-full flex-shrink-0 overflow-hidden">
                <IntelligenceSidebar
                    contract={contract}
                    obligations={obligations}
                    notes={notes} // Send ALL notes to sidebar for fallback rendering
                    clientName={clientName}
                    graphDocs={graphDocs}
                    graphRels={graphRels}
                    onNoteClick={setScrollToId}
                    onNoteDeleted={() => router.refresh()}
                    isLocked={isLockedForReview}
                    onUnlock={() => setShowUnlockModal(true)}
                    currentDraftVersion={currentDraftVersion}
                />
            </div>
        </div>
    )
}
