'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import IntelligenceSidebar from './IntelligenceSidebar'
import PDFViewerWrapper from './PDFViewerWrapper'
import jsPDF from 'jspdf'
import { uploadDocument } from '@/app/actions/documentActions';
import ContractHeader from './ContractHeader';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { createNote } from '@/app/actions/noteActions';
import { useContractSSE } from '@/hooks/useContractSSE';
import { SSEStatusBadge } from '@/components/status/SSEStatusBadge';
import { sanitizeContractHtml } from '@/lib/contractHtml';
import { DISALLOWED_MARKDOWN_ELEMENTS } from '@/lib/markdownSafety';
import { getPublicApiBase } from '@/lib/public-api-base';

export default function ContractDetailClient({
    fileUrl,
    contract,
    obligations,
    notes,
    clientName,
    graphDocs,
    graphRels,
    formattedDate
}: {
    fileUrl: string,
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
    const missingFileUrlFetchRef = useRef<string | null>(null);

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
                `\ud83d\udccc PASAL REVISI ${index + 1}\n\n[Isu Awal]:\n${item.original_issue}\n\n[Saran Redaksi AI]:\n${item.neutral_rewrite}`
            ).join('\n\n' + '\u2500'.repeat(40) + '\n\n');
        }

        return typeof rawDraft === 'string' ? rawDraft : JSON.stringify(rawDraft);
    }, [contract?.draft_revisions]);

    // ── Markdown Index Mapper: bridges clean browser text ↔ raw markdown positions ──
    // Strips markdown syntax and builds a char-by-char index map: plainIndex → rawIndex
    const { plainText, plainToRaw } = useMemo(() => {
        if (!parsedDraftText) return { plainText: '', plainToRaw: [] as number[] };

        const raw = parsedDraftText;
        let plain = '';
        const map: number[] = []; // map[plainIndex] = rawIndex

        let i = 0;
        while (i < raw.length) {
            // Skip ** (bold markers)
            if (raw[i] === '*' && raw[i + 1] === '*') { i += 2; continue; }
            // Skip * (italic markers)
            if (raw[i] === '*' && raw[i + 1] !== '*') { i += 1; continue; }
            // Skip __ (bold alt markers)
            if (raw[i] === '_' && raw[i + 1] === '_') { i += 2; continue; }
            // Skip heading markers at start of line (### )
            if (raw[i] === '#') {
                let hEnd = i;
                while (hEnd < raw.length && raw[hEnd] === '#') hEnd++;
                if (hEnd < raw.length && raw[hEnd] === ' ') { i = hEnd + 1; continue; }
            }
            // Skip ~~ (strikethrough)
            if (raw[i] === '~' && raw[i + 1] === '~') { i += 2; continue; }
            // Skip ` (inline code backtick)
            if (raw[i] === '`' && !(raw[i + 1] === '`' && raw[i + 2] === '`')) { i += 1; continue; }

            // Regular character — include in plain text and record mapping
            map.push(i);
            plain += raw[i];
            i++;
        }

        return { plainText: plain, plainToRaw: map };
    }, [parsedDraftText]);

    // Text Selection / Note Creation state for Markdown viewer
    const [selectedText, setSelectedText] = useState('');
    const [pendingStartChar, setPendingStartChar] = useState(-1);
    const [pendingEndChar, setPendingEndChar] = useState(-1);
    const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
    const [noteComment, setNoteComment] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);
    const markdownContainerRef = useRef<HTMLDivElement>(null);

    const handleTextSelection = useCallback(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || text.length < 3 || !sel?.rangeCount) return;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // ── Calculate start_char/end_char using the plainText index mapper ──
        let start_char = -1;
        let end_char = -1;

        if (plainText && plainToRaw.length > 0) {
            // Step 1: Get DOM offset using pre-range
            let innerTextStart = 0;
            if (markdownContainerRef.current) {
                try {
                    const preRange = document.createRange();
                    preRange.selectNodeContents(markdownContainerRef.current);
                    preRange.setEnd(range.startContainer, range.startOffset);
                    innerTextStart = preRange.toString().length;
                } catch { /* fallback below */ }
            }

            // Step 2: Find all occurrences in plainText (clean ↔ clean = always matches)
            const allOccurrences: number[] = [];
            let searchFrom = 0;
            while (searchFrom < plainText.length) {
                const idx = plainText.indexOf(text, searchFrom);
                if (idx === -1) break;
                allOccurrences.push(idx);
                searchFrom = idx + 1;
            }

            if (allOccurrences.length > 0) {
                // Step 3: Disambiguate — pick occurrence closest to DOM position
                const bestPlainIdx = allOccurrences.reduce((best, curr) =>
                    Math.abs(curr - innerTextStart) < Math.abs(best - innerTextStart) ? curr : best
                );
                // Step 4: Map plain indices → raw markdown indices
                start_char = plainToRaw[bestPlainIdx] ?? -1;
                const endPlainIdx = bestPlainIdx + text.length - 1;
                end_char = endPlainIdx < plainToRaw.length
                    ? (plainToRaw[endPlainIdx] ?? -1) + 1
                    : parsedDraftText.length;
            }
        }

        console.log(`[Note Selection] quote="${text.substring(0, 40)}..." start_char=${start_char} end_char=${end_char}`);

        setSelectedText(text);
        setPendingStartChar(start_char);
        setPendingEndChar(end_char);
        setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top - 10 });
        setNoteComment('');
    }, [plainText, plainToRaw, parsedDraftText]);

    const handleSaveNote = useCallback(async () => {
        if (!selectedText || !contract?.id) return;
        setIsSavingNote(true);
        try {
            const { error } = await createNote({
                contractId: contract.id,
                quote: selectedText,
                comment: noteComment,
                positionData: {
                    boundingRect: null,
                    rects: [],
                    pageNumber: 1,
                    // Store coordinates for reliable re-highlighting
                    start_char: pendingStartChar >= 0 ? pendingStartChar : undefined,
                    end_char: pendingEndChar >= 0 ? pendingEndChar : undefined,
                },
                draftVersion: currentDraftVersion || undefined,
            });
            if (error) throw new Error(error);
            toast.success('Note saved!', {
                style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
            });
            setSelectedText('');
            setPendingStartChar(-1);
            setPendingEndChar(-1);
            setSelectionPos(null);
            setNoteComment('');
            window.getSelection()?.removeAllRanges();
            router.refresh();
        } catch (e: any) {
            toast.error(e.message || 'Failed to save note');
        } finally {
            setIsSavingNote(false);
        }
    }, [selectedText, noteComment, pendingStartChar, pendingEndChar, contract?.id, currentDraftVersion, router]);

    const dismissNotePopup = useCallback(() => {
        setSelectedText('');
        setPendingStartChar(-1);
        setPendingEndChar(-1);
        setSelectionPos(null);
        setNoteComment('');
        window.getSelection()?.removeAllRanges();
    }, []);


    // ── Note Highlight Injection Pipeline (coordinate-first, plainText-fallback) ──
    const injectedDraftText = useMemo(() => {
        if (!parsedDraftText) return '';
        if (!notes || notes.length === 0) return parsedDraftText;

        interface NoteRange { start: number; end: number; noteId: string }
        const ranges: NoteRange[] = [];

        for (const note of notes) {
            const pos = typeof note.position_data === 'string'
                ? JSON.parse(note.position_data)
                : note.position_data;

            const quote = note.quote;
            if (!quote || quote.length < 3) continue;

            // ── Priority 1: Use stored coordinates (exact, fast) ──
            const sc = pos?.start_char;
            const ec = pos?.end_char;

            if (typeof sc === 'number' && typeof ec === 'number' &&
                sc >= 0 && ec > sc && ec <= parsedDraftText.length) {
                ranges.push({ start: sc, end: ec, noteId: String(note.id) });
                continue;
            }

            // ── Priority 2: Search in plainText (clean↔clean), map back via plainToRaw ──
            if (plainText && plainToRaw.length > 0) {
                const plainIdx = plainText.indexOf(quote);
                if (plainIdx !== -1) {
                    const rawStart = plainToRaw[plainIdx];
                    const rawEndPlain = plainIdx + quote.length - 1;
                    const rawEnd = rawEndPlain < plainToRaw.length
                        ? plainToRaw[rawEndPlain] + 1
                        : parsedDraftText.length;
                    if (typeof rawStart === 'number') {
                        ranges.push({ start: rawStart, end: rawEnd, noteId: String(note.id) });
                        continue;
                    }
                }
            }

            // ── Priority 3: Last resort — direct indexOf (handles plain text docs) ──
            const directIdx = parsedDraftText.indexOf(quote);
            if (directIdx !== -1) {
                ranges.push({ start: directIdx, end: directIdx + quote.length, noteId: String(note.id) });
            }
        }

        if (ranges.length === 0) return parsedDraftText;

        // Sort DESCENDING — reverse injection to avoid index shifting
        ranges.sort((a, b) => b.start - a.start);

        let modified = parsedDraftText;
        for (const range of ranges) {
            const text = modified.slice(range.start, range.end);
            const tag = `<mark data-note-id="${range.noteId}" style="background:rgba(253,224,71,0.5);border-radius:2px;padding:0 1px;">${text}</mark>`;
            modified = modified.slice(0, range.start) + tag + modified.slice(range.end);
        }

        return modified;
    }, [parsedDraftText, notes, plainText, plainToRaw]);
    const safeInjectedDraftText = useMemo(
        () => sanitizeContractHtml(injectedDraftText),
        [injectedDraftText]
    );

    const handleApplySuggestion = async (originalIssue: string, neutralRewrite: string) => {
        if (!contract?.id) return;
        try {
            const token = await getToken();
            const apiUrl = getPublicApiBase();

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
        // Removed jsPDF logic as we now render Markdown directly
    };

    useEffect(() => {
        if ((contract?.status === 'Review' || contract?.status === 'Pending Review') && !isLockedForReview && parsedDraftText) {
            handleLockForReview();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract?.status, parsedDraftText, isLockedForReview]);

    const [liveContract, setLiveContract] = useState(contract);
    const [taskError, setTaskError] = useState<{ error_summary: string; error_log_id: string | null; attempt?: number } | null>(null);
    const [errorLogDetail, setErrorLogDetail] = useState<any>(null);
    const [showDetailedLog, setShowDetailedLog] = useState(false);
    const [pipelineProgress, setPipelineProgress] = useState<{
        currentAgent: string
        agentIndex: number
        totalAgents: number
        message: string
    } | null>(null);

    useEffect(() => {
        setLiveContract(contract);
        missingFileUrlFetchRef.current = null;
        if ((contract?.status || '').toLowerCase() !== 'failed') {
            setTaskError(null);
        }
    }, [contract]);

    const fetchLatestContract = useCallback(async () => {
        if (!liveContract?.id) return;

        try {
            const token = await getToken();
            if (!token) {
                return null;
            }

            const apiUrl = getPublicApiBase();
            const res = await fetch(`${apiUrl}/api/contracts/${liveContract.id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) {
                return null;
            }

            const payload = await res.json();
            const data = payload?.data || payload?.contract || null;
            if (!data) return null;

            setLiveContract((prev: any) => (prev ? { ...prev, ...data } : data));
            return data;
        } catch (err) {
            console.error('Contract refresh error:', err);
            return null;
        }
    }, [getToken, liveContract?.id]);

    const pollContractStatus = useCallback(async () => {
        const data = await fetchLatestContract();
        if (!data) return;

        const newStatus = (data.status || '').toLowerCase();
        if (newStatus === 'failed') {
            const dr = data.draft_revisions;
            const errorLogId = dr?.error_log_id || null;
            const errorSummary = dr?.error_summary || 'An unknown error occurred during AI analysis.';
            setTaskError({ error_summary: errorSummary, error_log_id: errorLogId });
            setPipelineProgress(null);
            toast.error('AI Analysis Failed. See the error panel for details.', {
                style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' }
            });
            return;
        }

        if (newStatus.startsWith('retrying')) {
            toast.loading(`Retrying analysis... (${data.status})`, {
                id: 'retry-toast',
                style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
            });
            return;
        }

        if (!newStatus.includes('queued') && !newStatus.includes('processing') && !newStatus.includes('ingesting') && !newStatus.includes('in progress')) {
            setPipelineProgress(null);
            router.refresh();
        }
    }, [fetchLatestContract, router]);

    const viewerFileUrl = liveContract?.file_url || fileUrl || '';

    useEffect(() => {
        if (!liveContract?.id || viewerFileUrl) {
            return;
        }
        if (missingFileUrlFetchRef.current === liveContract.id) {
            return;
        }

        missingFileUrlFetchRef.current = liveContract.id;
        void fetchLatestContract();
    }, [fetchLatestContract, liveContract?.id, viewerFileUrl]);

    const liveStatus = (liveContract?.status || '').toLowerCase();
    const isRealtimeTracked = ['queued', 'processing', 'ingesting', 'in progress', 'signing in progress', 'partially signed'].some(
        status => liveStatus.includes(status)
    ) || liveStatus.startsWith('retrying');

    const { isConnected: isSSEConnected, isFallbackPolling } = useContractSSE({
        contractId: liveContract?.id || contract?.id || '',
        enabled: Boolean(liveContract?.id) && isRealtimeTracked,
        pollFallback: pollContractStatus,
        onPipelineProgress: (event) => {
            const totalAgents = Math.max(1, Number(event.data.total_agents || 8));
            setPipelineProgress({
                currentAgent: String(event.data.agent_name || ''),
                agentIndex: Number(event.data.agent_index || 0),
                totalAgents,
                message: String(event.data.message || 'Pipeline update received'),
            });
        },
        onPipelineCompleted: () => {
            setPipelineProgress(null);
            toast.success('AI Analysis Complete. The War Room is ready.', {
                style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
            });
            router.refresh();
        },
        onPipelineFailed: (event) => {
            setPipelineProgress(null);
            setTaskError({
                error_summary: String(event.data.error || 'An unknown error occurred during AI analysis.'),
                error_log_id: null,
            });
            toast.error('AI Analysis Failed. See the error panel for details.', {
                style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' }
            });
            router.refresh();
        },
        onStatusChanged: (event) => {
            setLiveContract((prev: any) => ({
                ...prev,
                status: event.data.new_status || prev?.status,
            }));

            const newStatus = String(event.data.new_status || '').toLowerCase();
            if (newStatus.startsWith('retrying')) {
                toast.loading(`Retrying analysis... (${String(event.data.new_status || '')})`, {
                    id: 'retry-toast',
                    style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
                });
            }

            if (newStatus === 'failed') {
                setPipelineProgress(null);
            }

            router.refresh();
        },
        onSigningUpdate: (event) => {
            if (event.data.message) {
                toast.info(String(event.data.message), {
                    style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
                });
            }
            router.refresh();
        },
    });

    const shouldShowPipelineProgress = Boolean(pipelineProgress) || liveStatus.includes('queued') || liveStatus.includes('processing') || liveStatus.startsWith('retrying');
    const truncationWarning = useMemo(() => {
        const draftRevisions = liveContract?.draft_revisions
        if (!draftRevisions) return null
        if (typeof draftRevisions === 'object' && !Array.isArray(draftRevisions)) {
            return draftRevisions.truncation_warning ?? null
        }
        if (typeof draftRevisions === 'string') {
            try {
                const parsed = JSON.parse(draftRevisions)
                return parsed?.truncation_warning ?? null
            } catch {
                return null
            }
        }
        return null
    }, [liveContract?.draft_revisions]);

    // Fetch full error log detail on demand
    const fetchErrorLogDetail = useCallback(async (logId: string) => {
        try {
            const token = await getToken();
            const apiUrl = getPublicApiBase();
            const res = await fetch(`${apiUrl}/api/task-logs/${logId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setErrorLogDetail(data.log);
            }
        } catch (e) {
            console.error('Failed to fetch error log:', e);
        }
    }, [getToken]);


    const handleUploadV2 = async (file: File) => {
        if (!file || !contract?.id || !contract?.matter_id) return;

        const isCounterpartyResponse = String(liveContract?.status || contract?.status || '').toLowerCase() === 'awaiting_counterparty';
        const uploadLabel = isCounterpartyResponse ? 'counterparty response' : 'Version 2';

        toast.loading(`Uploading ${uploadLabel}...`, { id: "upload-v2" });

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await uploadDocument(contract.matter_id, formData, contract.id);
            if (res.error) {
                toast.error(res.error, { id: "upload-v2" });
                return;
            }

            toast.success(`${uploadLabel} uploaded and queued for AI processing.`, { id: "upload-v2" });
            router.refresh();
        } catch (err: any) {
            toast.error(err.message || `Failed to upload ${uploadLabel}.`, { id: "upload-v2" });
        }
    };

    useEffect(() => {
        const triggerUpload = () => fileInputRef.current?.click()
        window.addEventListener('contract-detail:upload-next-version', triggerUpload as EventListener)
        return () => window.removeEventListener('contract-detail:upload-next-version', triggerUpload as EventListener)
    }, [])

    const filteredNotes = useMemo(() => {
        if (!isLockedForReview) return [];
        return notes.filter(n => {
            const pos = typeof n.position_data === 'string' ? JSON.parse(n.position_data) : n.position_data;
            return pos?.draft_version === currentDraftVersion;
        });
    }, [notes, isLockedForReview, currentDraftVersion]);

    const [dropdownOpen, setDropdownOpen] = useState(false);

    // ── Failed State Panel ──
    const FailedStatePanel = () => (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#0d0d0d] p-8">
            <div className="max-w-lg w-full">
                {/* Error Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                        <span className="material-symbols-outlined text-red-400 text-xl">error</span>
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-base">AI Analysis Failed</h3>
                        <p className="text-neutral-500 text-xs">The pipeline encountered an error during processing</p>
                    </div>
                </div>

                {/* Error Summary */}
                <div className="bg-red-950/20 border border-red-500/20 rounded-lg p-4 mb-4">
                    <p className="text-red-300 text-sm font-mono leading-relaxed">
                        {taskError?.error_summary || 'Unknown error occurred.'}
                    </p>
                </div>

                {/* Agent Progress (if log detail loaded) */}
                {errorLogDetail?.agent_progress && errorLogDetail.agent_progress.length > 0 && (
                    <div className="mb-4">
                        <p className="text-neutral-500 text-xs uppercase tracking-widest mb-2">Pipeline Progress</p>
                        <div className="space-y-1">
                            {errorLogDetail.agent_progress.map((step: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                        step.status === 'completed' ? 'bg-green-500' :
                                        step.status === 'failed' || step.status === 'failed_with_fallback' ? 'bg-red-500' :
                                        step.status === 'running' ? 'bg-yellow-500 animate-pulse' : 'bg-neutral-600'
                                    }`} />
                                    <span className="text-neutral-400 capitalize">{step.agent.replace(/_/g, ' ')}</span>
                                    {step.duration_ms && <span className="text-neutral-600 ml-auto">{(step.duration_ms / 1000).toFixed(1)}s</span>}
                                    {step.error && <span className="text-red-400 ml-2 truncate max-w-[200px]">{step.error}</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                    <button
                        onClick={() => router.push(`/dashboard/contracts/${liveContract.id}`)}
                        className="flex-1 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white bg-neutral-800 hover:bg-neutral-700 rounded border border-neutral-700 transition-colors"
                    >
                        Retry Upload
                    </button>
                    {taskError?.error_log_id && !errorLogDetail && (
                        <button
                            onClick={() => {
                                setShowDetailedLog(true);
                                fetchErrorLogDetail(taskError.error_log_id!);
                            }}
                            className="flex-1 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 rounded border border-neutral-700 transition-colors"
                        >
                            View Full Log
                        </button>
                    )}
                </div>

                {/* Error Traceback (collapsed behind button) */}
                {showDetailedLog && errorLogDetail && (
                    <div className="mt-4">
                        <p className="text-neutral-500 text-xs uppercase tracking-widest mb-2">Error Traceback</p>
                        <pre className="bg-black/50 border border-neutral-800 rounded p-3 text-[10px] text-red-300/80 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                            {errorLogDetail.error_traceback || errorLogDetail.error_message || 'No traceback available.'}
                        </pre>
                        <p className="text-neutral-600 text-[10px] mt-2">Log ID: {taskError?.error_log_id}</p>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            {truncationWarning && (
                <div className="w-full border-b border-amber-500/30 bg-amber-900/20 px-4 py-3">
                    <div className="flex items-center justify-center gap-2 text-amber-400">
                        <span className="material-symbols-outlined text-sm">warning</span>
                        <p className="text-xs font-bold uppercase tracking-wide">Document Truncated</p>
                    </div>
                    <p className="mt-1 text-center text-xs text-amber-300/80">
                        {truncationWarning.message}
                    </p>
                    <p className="mt-1 text-center text-[11px] text-amber-300/60">
                        Some clauses in the middle of the document may not have been analyzed.
                    </p>
                </div>
            )}
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
                                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] uppercase tracking-widest font-semibold transition-colors"
                                >
                                    {String(liveContract?.status || '').toLowerCase() === 'awaiting_counterparty'
                                        ? 'Upload Counterparty Response'
                                        : 'Upload Next Version'}
                                </button>
                                <button
                                    onClick={() => { setDropdownOpen(false); router.push(`/dashboard/contracts/${liveContract.id}/review`); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] uppercase tracking-widest font-semibold transition-colors"
                                >
                                    View Contract Review
                                </button>
                                <button
                                    onClick={() => {
                                        if (liveContract?.version_count && liveContract.version_count >= 2) {
                                            setDropdownOpen(false);
                                            router.push(`/dashboard/contracts/${liveContract.id}/war-room`);
                                        }
                                    }}
                                    disabled={!liveContract?.version_count || liveContract.version_count < 2}
                                    className={`w-full text-left px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold transition-colors ${(!liveContract?.version_count || liveContract.version_count < 2) ? 'text-neutral-600 cursor-not-allowed' : 'hover:bg-neutral-800 text-neutral-300 hover:text-white'}`}
                                >
                                    enter Negotiation War Room
                                </button>
                                <button
                                    onClick={() => { setDropdownOpen(false); router.push(`/dashboard/contracts/${liveContract.id}/signing`); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] uppercase tracking-widest font-semibold transition-colors"
                                >
                                    Signing Center
                                </button>
                                <button
                                    onClick={() => { setDropdownOpen(false); router.push(`/dashboard/drafting/${liveContract.matter_id}?contract_id=${liveContract.id}`); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] uppercase tracking-widest font-semibold transition-colors"
                                >
                                    Open in Smart Composer
                                </button>
                                <div className="my-1 border-t border-neutral-800/80"></div>
                                <button
                                    onClick={() => { setDropdownOpen(false); toast('Archive coming soon'); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-red-950/30 text-red-500/80 hover:text-red-400 text-[11px] uppercase tracking-widest font-semibold transition-colors"
                                >
                                    Archive Document
                                </button>
                            </div>
                        )}
                    </div>
                }
            >
                <div className="flex items-center gap-3 ml-auto">
                    {isRealtimeTracked && (
                        <SSEStatusBadge isConnected={isSSEConnected} isFallbackPolling={isFallbackPolling} />
                    )}
                    {/* Explicit V2 Upload Input (Hidden but needed) */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="application/pdf"
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                handleUploadV2(e.target.files[0]);
                                setLiveContract({ ...liveContract, status: 'Queued' }); // Opt UI update
                            }
                        }}
                    />

                    {/* ── Signing lifecycle CTAs ── */}
                    {(() => {
                        const s = (liveContract?.status || '').toLowerCase();
                        if (s === 'executed') {
                            return (
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                        Executed
                                    </span>
                                    <button
                                        onClick={() => router.push(`/dashboard/contracts/${liveContract.id}/signing`)}
                                        className="text-[11px] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-lg px-3 py-1.5 transition-colors"
                                    >
                                        Download Signed PDF
                                    </button>
                                </div>
                            );
                        }
                        if (s === 'signing in progress' || s === 'partially signed') {
                            const label = s === 'partially signed' ? 'Partially Signed' : 'Signing in Progress';
                            return (
                                <button
                                    onClick={() => router.push(`/dashboard/contracts/${liveContract.id}/signing`)}
                                    className="flex items-center gap-1.5 text-[11px] text-[#fbbf24] border border-[#fbbf24]/30 bg-[#fbbf24]/5 hover:bg-[#fbbf24]/10 rounded-lg px-3 py-1.5 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-sm">draw</span>
                                    {label} — View
                                </button>
                            );
                        }
                        if (s === 'ready to sign' || s === 'pending approval') {
                            return (
                                <button
                                    onClick={() => router.push(`/dashboard/contracts/${liveContract.id}/signing`)}
                                    className="flex items-center gap-1.5 text-[11px] font-bold text-black bg-[#fbbf24] hover:bg-[#f59e0b] rounded-lg px-4 py-1.5 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-sm">draw</span>
                                    Initiate Signing
                                </button>
                            );
                        }
                        return null;
                    })()}
                </div>
            </ContractHeader>

            {shouldShowPipelineProgress && (
                <div className="border-b border-[#d4af37]/10 bg-[#111] px-6 py-3">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                                <div
                                    className="h-full bg-[#d4af37] transition-all duration-500"
                                    style={{
                                        width: `${pipelineProgress
                                            ? Math.max(8, (pipelineProgress.agentIndex / Math.max(1, pipelineProgress.totalAgents)) * 100)
                                            : 12
                                        }%`
                                    }}
                                />
                            </div>
                            <p className="text-[11px] uppercase tracking-widest text-neutral-400">
                                {pipelineProgress?.message || 'Waiting for AI pipeline updates...'}
                                {pipelineProgress && (
                                    <span className="ml-2 text-[#d4af37]">
                                        ({pipelineProgress.agentIndex}/{pipelineProgress.totalAgents})
                                    </span>
                                )}
                            </p>
                        </div>
                        <SSEStatusBadge isConnected={isSSEConnected} isFallbackPolling={isFallbackPolling} />
                    </div>
                </div>
            )}

            <div className="flex flex-1 w-full overflow-hidden bg-background">
                {/* LEFT: PDF Viewer or Live Draft Viewer */}
                <div className="flex-1 h-full min-w-0 overflow-hidden relative">


                    {liveContract?.status?.toLowerCase() === 'failed' || taskError ? (
                        <FailedStatePanel />
                    ) : isLockedForReview ? (
                        <div
                            ref={markdownContainerRef}
                            className="w-full h-full overflow-y-auto p-12 bg-[#121212] flex justify-center custom-scrollbar items-start relative [&_::selection]:bg-yellow-200 [&_::selection]:text-black"
                            style={{ userSelect: 'text' }}
                            onMouseUp={handleTextSelection}
                        >
                            <div className="max-w-4xl w-full h-fit min-h-full bg-white text-black p-12 shadow-2xl rounded-sm">
                                <div className="prose prose-sm max-w-none">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeRaw as any]}
                                        disallowedElements={DISALLOWED_MARKDOWN_ELEMENTS}
                                        unwrapDisallowed
                                    >
                                        {safeInjectedDraftText}
                                    </ReactMarkdown>
                                </div>
                            </div>

                            {/* Floating Note Creation Popup */}
                            {selectedText && selectionPos && (
                                <div
                                    className="fixed z-[100] animate-in fade-in zoom-in-95 duration-200"
                                    style={{
                                        left: Math.min(selectionPos.x - 140, window.innerWidth - 310),
                                        top: Math.max(selectionPos.y - 180, 20)
                                    }}
                                >
                                    <div className="bg-[#1a1a1a] border border-[#d4af37]/30 p-3 rounded-lg shadow-2xl min-w-[280px]">
                                        <h4 className="text-xs font-bold text-white mb-2 font-serif flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[#d4af37] text-sm">edit_note</span>
                                            Create Note from Selection
                                        </h4>
                                        <div className="text-[10px] text-zinc-400 mb-2 p-2 bg-white/5 rounded border-l-2 border-[#d4af37]/50 italic max-h-16 overflow-y-auto">
                                            &ldquo;{selectedText.length > 120 ? selectedText.substring(0, 120) + '...' : selectedText}&rdquo;
                                        </div>
                                        <textarea
                                            value={noteComment}
                                            autoFocus
                                            onChange={(e) => setNoteComment(e.target.value)}
                                            placeholder="Add a comment (optional)..."
                                            className="w-full bg-[#0e0e0e] border border-white/10 rounded p-2 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-[#d4af37] focus:border-[#d4af37] resize-none h-16 mb-2"
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={dismissNotePopup}
                                                className="px-3 py-1 text-xs text-zinc-500 hover:text-white transition-colors"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleSaveNote}
                                                disabled={isSavingNote}
                                                className="px-3 py-1.5 text-xs bg-[#d4af37] text-black font-bold rounded hover:bg-[#c5a059] transition-colors disabled:opacity-50"
                                            >
                                                {isSavingNote ? 'Saving...' : 'Save Note'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <PDFViewerWrapper
                            fileUrl={viewerFileUrl}
                            contractId={liveContract.id}
                            scrollToId={scrollToId}
                            notes={notes}
                            draftVersion={currentDraftVersion}
                        />
                    )}
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
