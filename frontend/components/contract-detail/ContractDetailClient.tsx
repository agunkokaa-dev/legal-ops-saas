'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import IntelligenceSidebar from './IntelligenceSidebar'
import PDFViewerWrapper from './PDFViewerWrapper'
import jsPDF from 'jspdf'
import { uploadDocument } from '@/app/actions/documentActions';
import ContractHeader from './ContractHeader';

export default function ContractDetailClient({
    pdfUrl,
    contract,
    obligations,
    notes,
    clientName,
    graphDocs,
    graphRels,
    formattedDate
}: {
    pdfUrl: string,
    contract: any,
    obligations: any[],
    notes: any[],
    clientName: string,
    graphDocs: any[],
    graphRels: any[],
    formattedDate: string
}) {
    const [scrollToId, setScrollToId] = useState<string | null>(null);
    const router = useRouter();
    const { getToken } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const [liveContract, setLiveContract] = useState(contract);

    // Auto-polling for status updates
    useEffect(() => {
        if (!liveContract?.id) return;
        let interval: NodeJS.Timeout;

        const checkStatus = async () => {
            try {
                // Inline Supabase fetch to avoid dependency issues
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
                const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
                const headers = { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };
                
                const res = await fetch(`${supabaseUrl}/rest/v1/contracts?id=eq.${liveContract.id}&select=*`, { headers });
                const [data] = await res.json();
                
                if (data && data.status !== liveContract.status) {
                    setLiveContract(data);
                    
                    const newStatus = data.status.toLowerCase();
                    if (!newStatus.includes('processing') && !newStatus.includes('ingesting')) {
                        toast.success("✅ AI Analysis Complete. The War Room is ready.", {
                            style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
                        });
                        router.refresh();
                    }
                }
            } catch (err) {
                console.error("Polling error:", err);
            }
        };

        const isProcessing = liveContract?.status?.toLowerCase().includes('processing') || 
                             liveContract?.status?.toLowerCase().includes('ingesting') ||
                             liveContract?.status === 'In Progress';

        if (isProcessing) {
            interval = setInterval(checkStatus, 3000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [liveContract?.status, liveContract?.id, router]);


    const handleUploadV2 = async (file: File) => {
        if (!file || !contract?.id || !contract?.matter_id) return;
        
        toast.loading("Uploading Version 2...", { id: "upload-v2" });
        
        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const res = await uploadDocument(contract.matter_id, formData, contract.id);
            if (res.error) {
                toast.error(res.error, { id: "upload-v2" });
                return;
            }
            
            toast.success("V2 Uploaded! Processing in background...", { id: "upload-v2" });
            router.refresh();
        } catch (err: any) {
            toast.error(err.message || "Failed to upload V2.", { id: "upload-v2" });
        }
    };

    const filteredNotes = useMemo(() => {
        if (!isLockedForReview) return [];
        return notes.filter(n => {
            const pos = typeof n.position_data === 'string' ? JSON.parse(n.position_data) : n.position_data;
            return pos?.draft_version === currentDraftVersion;
        });
    }, [notes, isLockedForReview, currentDraftVersion]);

    const [dropdownOpen, setDropdownOpen] = useState(false);

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            <ContractHeader 
                initialContract={liveContract} 
                formattedDate={formattedDate}
                actionMenu={
                    <div className="relative ml-2">
                        <button 
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className="flex items-center gap-1.5 px-3 py-1 bg-transparent hover:bg-neutral-800 text-neutral-400 hover:text-white text-[11px] font-bold uppercase tracking-widest rounded transition-colors border border-transparent hover:border-neutral-700"
                        >
                            Actions <span className="material-symbols-outlined text-[14px]">arrow_drop_down</span>
                        </button>

                        {dropdownOpen && (
                            <div className="absolute top-full left-0 mt-2 w-56 bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl py-1 z-50">
                                <button 
                                    onClick={() => { setDropdownOpen(false); fileInputRef.current?.click(); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[15px] opacity-70">upload_file</span> 
                                    Upload Version 2
                                </button>
                                <button 
                                    onClick={() => { setDropdownOpen(false); router.push(`/dashboard/drafting/${liveContract.matter_id}?contract_id=${liveContract.id}`); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[15px] opacity-70">draw</span> 
                                    Open in Smart Composer
                                </button>
                                <div className="my-1 border-t border-neutral-800/80"></div>
                                <button 
                                    onClick={() => { setDropdownOpen(false); toast('Archive coming soon'); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-red-950/30 text-red-500/80 hover:text-red-400 text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[15px] opacity-70">archive</span> 
                                    Archive Document
                                </button>
                            </div>
                        )}
                    </div>
                }
            >
                <div className="flex items-center gap-3 ml-auto">
                    {/* Explicit V2 Upload Input (Hidden but needed) */}
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="application/pdf"
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                handleUploadV2(e.target.files[0]);
                                setLiveContract({ ...liveContract, status: 'Processing' }); // Opt UI update
                            }
                        }}
                    />
                    {/* The Right Side is now completely clean (Nuclear Option Active) */}
                </div>
            </ContractHeader>

            <div className="flex flex-1 w-full overflow-hidden bg-background">
            {/* LEFT: PDF Viewer or Live Draft Viewer */}
            <div className="flex-1 h-full min-w-0 overflow-hidden relative">
                {/* War Room: Version Badge */}
                {liveContract.version_count && liveContract.version_count > 1 && (
                    <div className="absolute top-3 left-3 z-20 bg-[#d4af37]/90 text-black text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 backdrop-blur-sm">
                        <span className="material-symbols-outlined text-[14px]">history</span>
                        V{liveContract.version_count}
                    </div>
                )}
                <PDFViewerWrapper
                    fileUrl={isLockedForReview && pdfBlobUrl ? pdfBlobUrl : pdfUrl}
                    contractId={liveContract.id}
                    scrollToId={scrollToId}
                    notes={isLockedForReview ? filteredNotes : notes}
                    draftVersion={currentDraftVersion}
                />
            </div>
            {/* RIGHT: Sidebar - fixed width, strict height */}
            <div className="w-[400px] h-full flex-shrink-0 overflow-hidden">
                <IntelligenceSidebar
                    contract={liveContract}
                    obligations={obligations}
                    notes={notes} // Send ALL notes to sidebar for fallback rendering
                    clientName={clientName}
                    graphDocs={graphDocs}
                    graphRels={graphRels}
                    onNoteClick={setScrollToId}
                    onNoteDeleted={() => router.refresh()}
                    isLocked={isLockedForReview}
                    currentDraftVersion={currentDraftVersion}
                    onApplySuggestion={handleApplySuggestion}
                />
            </div>
        </div>
        </div>
    )
}
