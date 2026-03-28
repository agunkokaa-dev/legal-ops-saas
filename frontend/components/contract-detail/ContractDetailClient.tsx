'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
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
    const { getToken } = useAuth();

    // Lock-for-Review Options
    const [isLockedForReview, setIsLockedForReview] = useState(false);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [currentDraftVersion, setCurrentDraftVersion] = useState<string | null>(null);

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

    const handleApplySuggestion = async (originalIssue: string, neutralRewrite: string) => {
        if (!contract?.id) return;
        try {
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

            const res = await fetch(`${apiUrl}/api/v1/drafting/apply-suggestion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    contract_id: contract.id,
                    original_issue: originalIssue,
                    neutral_rewrite: neutralRewrite
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to apply suggestion");
            }

            toast.success("AI suggestion applied successfully.", {
                style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
            });
            router.refresh();
        } catch (error: any) {
            console.error("Apply error:", error);
            toast.error(error.message || "Failed to apply suggestion.");
        }
    };

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
                {/* War Room: Version Badge */}
                {contract.version_count && contract.version_count > 1 && (
                    <div className="absolute top-3 left-3 z-20 bg-[#d4af37]/90 text-black text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 backdrop-blur-sm">
                        <span className="material-symbols-outlined text-[14px]">history</span>
                        V{contract.version_count}
                    </div>
                )}
                <PDFViewerWrapper
                    fileUrl={isLockedForReview && pdfBlobUrl ? pdfBlobUrl : pdfUrl}
                    contractId={contract.id}
                    scrollToId={scrollToId}
                    notes={isLockedForReview ? filteredNotes : notes}
                    draftVersion={currentDraftVersion}
                />
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
                    onUnlock={() => router.push(`/dashboard/drafting/${contract.matter_id}?contract_id=${contract.id}`)}
                    currentDraftVersion={currentDraftVersion}
                    onApplySuggestion={handleApplySuggestion}
                />
            </div>
        </div>
    )
}
