'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { uploadDocument } from '@/app/actions/documentActions';
import ReactMarkdown from 'react-markdown';
import WordDiff from './WordDiff';

interface DiffDeviation {
    deviation_id: string;
    title: string;
    category: string;
    severity: 'critical' | 'warning' | 'info';
    v1_text: string;
    v2_text: string;
    v2_coordinates?: { start_char: number; end_char: number; source_text: string };
    impact_analysis: string;
    playbook_violation?: string;
    counterparty_intent?: string;
}

interface AuditLogEntry {
    action: string;
    actor: string;
    reason: string;
    timestamp: string;
    previous_status?: string;
    generated_response?: string;
}

interface BATNAFallback {
    deviation_id: string;
    fallback_clause: string;
    reasoning: string;
    leverage_points: string[];
}

interface SmartDiffResult {
    deviations: DiffDeviation[];
    batna_fallbacks: BATNAFallback[];
    risk_delta: number;
    summary: string;
}

interface ContractVersion {
    id: string;
    version_number: number;
    risk_score: number;
    risk_delta: number;
    created_at: string;
    raw_text?: string;
}

export default function WarRoomClient({
    contractId,
    matterId,
    contractTitle
}: {
    contractId: string;
    matterId: string;
    contractTitle: string;
}) {
    const { getToken, userId } = useAuth();
    const router = useRouter();

    const [isLoading, setIsLoading] = useState(true);
    const [loadingStage, setLoadingStage] = useState('Fetching history...');
    const [diffResult, setDiffResult] = useState<SmartDiffResult | null>(null);
    const [versions, setVersions] = useState<ContractVersion[]>([]);

    const [selectedDevId, setSelectedDevId] = useState<string | null>(null);
    const [isEscalating, setIsEscalating] = useState(false);
    const [expandedDevs, setExpandedDevs] = useState<Record<string, boolean>>({});

    // Toggles central view between the Smart Diff (V2) vs the Baseline text (V1)
    const [viewMode, setViewMode] = useState<'v1' | 'v2' | 'v3'>('v2');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);

    // ── STATUS MANAGEMENT STATE ──
    const [issueStatuses, setIssueStatuses] = useState<Record<string, string>>({});
    const [isStatusUpdating, setIsStatusUpdating] = useState(false);
    const [showReasoningModal, setShowReasoningModal] = useState<{ devId: string; action: string } | null>(null);
    const [reasoningText, setReasoningText] = useState('');
    const [auditLogs, setAuditLogs] = useState<Record<string, AuditLogEntry[]>>({});

    const [isPollingTimeout, setIsPollingTimeout] = useState(false);
    const [isPollingFailed, setIsPollingFailed] = useState(false);
    const pollAttempts = useRef(0);

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contractId]);

    // Polling mechanism to resolve Race Condition where V2 is uploaded but SmartDiffAgent is still saving
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (!isLoading && !diffResult && !isPollingTimeout && !isPollingFailed) {
            interval = setInterval(async () => {
                pollAttempts.current += 1;
                
                // 1. Polling Timeout (The 60-Second Rule, 20 iterations * 3s)
                if (pollAttempts.current >= 20) {
                    clearInterval(interval);
                    setIsPollingTimeout(true);
                    return;
                }

                // 2. Inline check for backend failure using Supabase
                try {
                    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
                    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
                    const headers = { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };
                    const res = await fetch(`${supabaseUrl}/rest/v1/contracts?id=eq.${contractId}&select=*`, { headers });
                    const [data] = await res.json();
                    
                    if (data?.status?.toLowerCase() === 'failed') {
                        clearInterval(interval);
                        setIsPollingFailed(true);
                        return;
                    }
                } catch (e) {
                    // Ignore inline fetch errors, just keep polling
                }

                loadData();
            }, 3000);
        }
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, diffResult, contractId, isPollingTimeout, isPollingFailed]);

    const loadData = async () => {
        try {
            setIsLoading(true);
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

            // 1. Fetch versions
            setLoadingStage('Fetching version history...');
            const vRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/versions`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!vRes.ok) throw new Error('Failed to fetch versions');
            const vData = await vRes.json();
            setVersions(vData.versions || []);
            if (vData.versions && vData.versions.length > 2) {
                setViewMode('v3');
            }

            // 2. Fetch Cached Smart Diff
            setLoadingStage('Checking for cached Smart Diff...');
            let diffData = null;

            const getRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/diff`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (getRes.ok) {
                diffData = await getRes.json();
            } else {
                // 3. Trigger Smart Diff if not cached
                setLoadingStage('Running Smart Diff Agent (Comparing V1 vs V2 against Playbook)...');
                const diffRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/diff`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({})
                });

                if (!diffRes.ok) {
                    const err = await diffRes.json().catch(() => ({}));
                    throw new Error(err.detail || 'Smart Diff execution failed');
                }
                diffData = await diffRes.json();
            }

            setDiffResult(diffData);

            if (diffData?.deviations?.length > 0) {
                setSelectedDevId(diffData.deviations[0].deviation_id);
            }

        } catch (error: any) {
            toast.error(error.message || 'Failed to initialize War Room');
        } finally {
            setIsLoading(false);
        }
    };

    const handleEscalate = async (dev: DiffDeviation) => {
        setIsEscalating(true);
        try {
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

            // Find the matching negotiation issue
            const issuesRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/issues`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (issuesRes.ok) {
                const issuesData = await issuesRes.json();
                const matchingIssue = issuesData.issues?.find((i: any) =>
                    i.title?.includes(dev.title?.slice(0, 40) || '')
                ) || issuesData.issues?.[0];

                if (matchingIssue) {
                    const patchRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/issues/${matchingIssue.id}/status`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            status: 'escalated',
                            reason: 'Escalated to internal team for review',
                            actor: userId || 'User'
                        })
                    });

                    if (patchRes.ok) {
                        const result = await patchRes.json();
                        setIssueStatuses(prev => ({ ...prev, [dev.deviation_id]: 'escalated' }));
                        setAuditLogs(prev => ({
                            ...prev,
                            [dev.deviation_id]: [...(prev[dev.deviation_id] || []), result.audit_entry]
                        }));
                        toast.success('Issue escalated and status locked! 🔒');

                        // Force frontend refetch
                        router.refresh();
                        await loadData();
                    } else {
                        throw new Error('Failed to update status to escalated');
                    }
                }
            }
        } catch (e: any) {
            toast.error(e.message || 'Failed to escalate issue');
        } finally {
            setIsEscalating(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsUploading(true);
            toast.loading(`Uploading iterative version: ${file.name}...`, { id: 'upload-v' });

            const formData = new FormData();
            formData.append('file', file);

            // Bypass automated matchmaking by passing contractId as parentContractId
            const res = await uploadDocument(matterId, formData, contractId);

            if (res.error) throw new Error(res.error);

            toast.success("New version ingested. Computing Playbook Smart Diff...", { id: 'upload-v' });

            // Reload the WarRoom data seamlessly
            setLoadingStage('Initializing Next Version Smart Diff...');
            setIsLoading(true);
            router.refresh();
            await loadData();

        } catch (error: any) {
            toast.error(error.message || 'Upload failed', { id: 'upload-v' });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ── STATUS MANAGEMENT HANDLER ──
    const handleStatusChange = async (devId: string, newStatus: string, autoReason?: string) => {
        const finalReason = autoReason || reasoningText.trim();

        if (!finalReason && newStatus !== 'under_review') {
            toast.error('Please provide a reason for this decision.');
            return;
        }

        setIsStatusUpdating(true);
        try {
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

            // Find the matching negotiation issue (we'll search by deviation title)
            const issuesRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/issues`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (issuesRes.ok) {
                const issuesData = await issuesRes.json();
                const matchingIssue = issuesData.issues?.find((i: any) =>
                    i.title?.includes(diffResult?.deviations.find(d => d.deviation_id === devId)?.title?.slice(0, 40) || '')
                ) || issuesData.issues?.[0];

                if (matchingIssue) {
                    const patchRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/issues/${matchingIssue.id}/status`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            status: newStatus,
                            reason: finalReason || `Status changed to ${newStatus}`,
                            actor: userId || 'User'
                        })
                    });

                    if (patchRes.ok) {
                        const result = await patchRes.json();
                        setIssueStatuses(prev => ({ ...prev, [devId]: newStatus }));
                        setAuditLogs(prev => ({
                            ...prev,
                            [devId]: [...(prev[devId] || []), result.audit_entry]
                        }));
                        toast.success(`Status updated to ${newStatus.toUpperCase()}`);

                        // Force frontend refetch to instantly update Risk Score and V3 Draft
                        router.refresh();
                        await loadData();
                    }
                }
            }
        } catch (e: any) {
            toast.error(e.message || 'Failed to update status');
        } finally {
            setIsStatusUpdating(false);
            setShowReasoningModal(null);
            setReasoningText('');
        }
    };

    // ── EDIT IN COMPOSER: Ensure V3 draft exists, then redirect to Drafting page ──
    const handleEditInComposer = async () => {
        try {
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

            // 1. Check if V3 working draft already exists (derive from versions state)
            const existingV3 = versions?.length > 2 ? versions[versions.length - 1] : null;
            let targetVersionId = existingV3?.id;

            if (!targetVersionId) {
                // 2. Trigger a lightweight status patch to force V3 creation
                // Find any deviation to use as the trigger
                const firstDev = diffResult?.deviations?.[0];
                if (firstDev) {
                    const issuesRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/issues`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    if (issuesRes.ok) {
                        const issuesData = await issuesRes.json();
                        const matchingIssue = issuesData.issues?.[0];
                        if (matchingIssue) {
                            await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/issues/${matchingIssue.id}/status`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ status: 'under_review', reason: 'Opening in Composer for manual editing', actor: userId || 'User' })
                            });
                        }
                    }
                }

                // 3. Re-fetch versions to get the newly created V3 id
                const vRes = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/versions`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (vRes.ok) {
                    const vData = await vRes.json();
                    const freshVersions = vData.versions || [];
                    targetVersionId = freshVersions.length > 2 ? freshVersions[freshVersions.length - 1].id : null;
                }
            }

            // 4. Navigate to the Drafting/Composer page with War Room context
            const draftingUrl = targetVersionId
                ? `/dashboard/drafting/${contractId}?mode=warroom&contract_id=${contractId}&draft_id=${targetVersionId}`
                : `/dashboard/drafting/${contractId}?mode=warroom&contract_id=${contractId}`;

            toast.success('Opening Smart Composer with V3 Working Draft...');
            router.push(draftingUrl);
        } catch (e: any) {
            toast.error(e.message || 'Failed to open Composer');
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'accepted': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
            case 'rejected': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
            case 'countered': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            case 'under_review': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'escalated': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
            default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
        }
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] overflow-hidden relative">
                {/* Fallback Banner */}
                <div className="w-full h-14 bg-[#0a0a0a] border-b border-zinc-800/60 flex items-center px-8 shrink-0">
                    <div className="w-48 h-4 bg-zinc-800/60 rounded animate-pulse"></div>
                </div>

                <div className="flex-1 flex overflow-hidden opacity-50 relative pointer-events-none">
                    {/* Simulated Column A */}
                    <div className="w-[280px] border-r border-zinc-800/40 p-6 flex flex-col gap-4">
                        <div className="w-32 h-3 bg-zinc-800 rounded animate-pulse mb-2"></div>
                        <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                        <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                        <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                    </div>

                    {/* Simulated Column B */}
                    <div className="flex-1 p-10 flex flex-col gap-6">
                        <div className="w-3/4 h-8 bg-zinc-900 rounded animate-pulse mb-6"></div>
                        <div className="w-full h-4 bg-zinc-900 rounded animate-pulse"></div>
                        <div className="w-full h-4 bg-zinc-900 rounded animate-pulse"></div>
                        <div className="w-5/6 h-4 bg-zinc-900 rounded animate-pulse"></div>
                        <div className="w-full h-4 bg-zinc-900 rounded animate-pulse mt-4"></div>
                        <div className="w-4/5 h-4 bg-zinc-900 rounded animate-pulse"></div>
                    </div>

                    {/* Simulated Column C */}
                    <div className="w-[380px] border-l border-zinc-800/40 p-6 flex flex-col gap-4">
                        <div className="w-40 h-4 bg-zinc-800 rounded animate-pulse mb-2"></div>
                        <div className="w-full h-32 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                        <div className="w-full h-64 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse mt-4"></div>
                        <div className="w-full h-20 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse mt-4"></div>
                    </div>
                </div>

                {/* Prominent Center Overlay */}
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/60 backdrop-blur-sm">
                    <div className="bg-[#111] border border-[#d4af37]/30 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-md text-center">
                        <div className="w-16 h-16 rounded-full border border-[#d4af37]/20 bg-[#d4af37]/10 flex items-center justify-center mb-6">
                            <span className="material-symbols-outlined text-[#d4af37] text-3xl animate-spin" style={{ animationDuration: '3s' }}>sync</span>
                        </div>
                        <h3 className="text-white font-serif font-bold text-lg mb-3 tracking-wide text-[#d4af37]">AI Processing Documents</h3>
                        <p className="text-zinc-400 text-sm leading-relaxed">
                            Please wait, AI Co-Counsel is comparing V1 against V2 and formulating BATNA strategies...
                        </p>
                        <div className="w-full h-1 bg-zinc-800 mt-6 rounded overflow-hidden">
                            <div className="h-full bg-[#d4af37]/50 w-full animate-pulse"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isPollingFailed) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] h-[calc(100vh-70px)]">
                <div className="bg-[#111] border border-rose-900/50 p-8 rounded-2xl shadow-[0_0_30px_rgba(225,29,72,0.1)] flex flex-col items-center max-w-md text-center">
                    <span className="text-4xl mb-4">❌</span>
                    <h3 className="text-rose-400 font-serif font-bold text-lg mb-3 tracking-wide">AI Processing Failed</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                        Please check the document format or try uploading again. The agent returned a critical error.
                    </p>
                    <button onClick={() => router.push(`/dashboard/contracts/${contractId}`)} className="bg-rose-900/20 hover:bg-rose-900/40 text-rose-300 border border-rose-900/50 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                        Return to Workspace
                    </button>
                </div>
            </div>
        );
    }

    if (isPollingTimeout) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] h-[calc(100vh-70px)]">
                <div className="bg-[#111] border border-amber-900/50 p-8 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.1)] flex flex-col items-center max-w-md text-center">
                    <span className="text-4xl mb-4">⚠️</span>
                    <h3 className="text-amber-500 font-serif font-bold text-lg mb-3 tracking-wide">Analysis Timeout</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                        The document is too large or the AI server is busy.
                    </p>
                    <div className="flex gap-4">
                        <button onClick={() => { setIsPollingTimeout(false); pollAttempts.current = 0; setIsPollingFailed(false); loadData(); }} className="bg-amber-900/20 hover:bg-amber-900/40 text-amber-300 border border-amber-900/50 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                            Try Again
                        </button>
                        <button onClick={() => router.push(`/dashboard/contracts/${contractId}`)} className="text-zinc-500 hover:text-zinc-300 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!diffResult) {
        return (
            <div className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] text-[#e5e2e1] overflow-hidden">
                {/* Skeleton Header */}
                <section className="w-full h-14 bg-[#0a0a0a] border-b border-zinc-800/60 flex items-center justify-between px-8 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-32 h-3 bg-zinc-800/50 rounded animate-pulse"></div>
                        <div className="w-24 h-4 bg-zinc-800 rounded animate-pulse"></div>
                    </div>
                </section>

                <section className="flex-1 flex overflow-hidden">
                    {/* Skeleton Column A */}
                    <aside className="w-[280px] border-r border-zinc-800/40 p-6 flex flex-col gap-6">
                        <div className="w-24 h-2 bg-zinc-800 rounded animate-pulse mb-4"></div>
                        <div className="w-full h-16 bg-[#111] rounded animate-pulse"></div>
                        <div className="w-full h-16 bg-[#111] rounded animate-pulse"></div>

                        <div className="mt-8">
                            <div className="w-32 h-2 bg-zinc-800 rounded animate-pulse mb-4"></div>
                            <div className="space-y-3">
                                <div className="w-full h-24 bg-[#0f0f0f] border border-zinc-900 rounded-lg animate-pulse"></div>
                                <div className="w-full h-24 bg-[#0f0f0f] border border-zinc-900 rounded-lg animate-pulse"></div>
                            </div>
                        </div>
                    </aside>

                    {/* Skeleton Column B */}
                    <section className="flex-1 p-12 bg-[#0a0a0a] relative flex justify-center">
                        {/* Loading Overlay */}
                        <div className="absolute inset-0 bg-[#0a0a0a]/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
                            <div className="flex items-center gap-4 mb-4">
                                <span className="w-6 h-6 border-2 border-[#D4AF37]/20 rounded-full animate-spin border-t-[#D4AF37]"></span>
                                <h3 className="font-serif text-[#D4AF37] text-lg tracking-wide animate-pulse">⏳ AI Co-Counsel is finalizing the War Room Diff...</h3>
                            </div>
                            <p className="text-xs text-zinc-500 uppercase tracking-widest max-w-sm text-center">Comparing V1 against V2 and generating BATNA strategies. Please wait.</p>
                        </div>

                        <div className="max-w-3xl w-full h-[800px] bg-[#0f0f0f] border border-zinc-800/40 rounded-xl p-16 overflow-hidden">
                            <div className="w-64 h-6 bg-zinc-800/50 rounded animate-pulse mb-12 mx-auto"></div>
                            <div className="space-y-4">
                                <div className="w-full h-4 bg-zinc-800/30 rounded animate-pulse"></div>
                                <div className="w-[90%] h-4 bg-zinc-800/30 rounded animate-pulse"></div>
                                <div className="w-[95%] h-4 bg-zinc-800/30 rounded animate-pulse"></div>
                                <div className="w-[80%] h-4 bg-zinc-800/30 rounded animate-pulse mb-8"></div>
                                <div className="w-full h-32 bg-[#1a0f0f]/50 border border-rose-900/20 rounded animate-pulse"></div>
                            </div>
                        </div>
                    </section>
                </section>
            </div>
        );
    }

    // Fix version mapping: Lock V2 as the counterparty document even after V3 Draft is created
    const v1 = versions?.length > 0 ? versions[0] : null;
    const v2 = versions?.length > 1 ? versions[1] : null;
    const v3_working = versions?.length > 2 ? versions[versions.length - 1] : null;

    const v1Score = v1?.risk_score || 0;
    const v2Score = v3_working?.risk_score || v2?.risk_score || 0;

    const criticalCount = diffResult.deviations.filter(d => d.severity === 'critical').length;
    const warningCount = diffResult.deviations.filter(d => d.severity === 'warning').length;

    const selectedDev = diffResult.deviations.find(d => d.deviation_id === selectedDevId) || diffResult.deviations[0];
    const selectedBATNA = diffResult.batna_fallbacks.find(b => b.deviation_id === selectedDevId);

    const renderV2WithContextualDeviations = () => {
        if (!v2?.raw_text) return <p className="text-zinc-500 italic">No raw text available for V2.</p>;

        const deviationsWithCoords = diffResult.deviations.filter(d => d.v2_coordinates);
        const unmappedDeviations = diffResult.deviations.filter(d => !d.v2_coordinates);

        deviationsWithCoords.sort((a, b) => (a.v2_coordinates?.start_char || 0) - (b.v2_coordinates?.start_char || 0));

        let lastIndex = 0;
        const elements: React.ReactNode[] = [];

        // Render unmapped deviations at the top (e.g. Removed categories without V2 coordinates)
        if (unmappedDeviations.length > 0) {
            elements.push(
                <div key="unmapped" className="bg-[#111] p-6 rounded-xl border border-zinc-800/60 mb-8 space-y-6 shadow-xl">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800/60 pb-2 flex items-center gap-2">
                        <span className="material-symbols-outlined text-xs">playlist_remove</span>
                        Unmapped / Global Deviations
                    </h3>
                    {unmappedDeviations.map(dev => {
                        const isAddOrMod = dev.category === 'Added' || dev.category === 'Modified';
                        const isSelected = selectedDevId === dev.deviation_id;
                        const isExpanded = expandedDevs[dev.deviation_id];

                        return (
                            <div
                                key={`dev-${dev.deviation_id}`}
                                id={`dev-${dev.deviation_id}`}
                                className={`relative bg-[#1a0f0f] border-l-4 ${isAddOrMod ? 'border-emerald-900/80' : 'border-rose-900/60'} p-6 flex flex-col transition-all duration-300 cursor-pointer ${isSelected ? 'ring-1 ring-white/10 shadow-lg scale-[1.01]' : 'opacity-80 hover:opacity-100'
                                    }`}
                                onClick={(e) => { e.stopPropagation(); setSelectedDevId(dev.deviation_id); }}
                            >
                                <div className="flex justify-between items-center mb-4">
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${isAddOrMod ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                                        {dev.category.toUpperCase()} DEVIATION
                                    </span>
                                    {isSelected && <span className="text-[10px] text-[#D4AF37] font-bold tracking-wider">ACTIVE</span>}
                                </div>

                                {dev.category === 'Removed' ? (
                                    <div className="relative mt-2">
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                            <div className="bg-[#1a0f0f] text-rose-300 px-3 py-1 rounded border border-rose-500/30 text-[10px] uppercase font-bold tracking-widest shadow-2xl">
                                                Clause Deleted in V2
                                            </div>
                                        </div>
                                        <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-1">Baseline (V1)</span>
                                        <p className="line-through text-zinc-500 decoration-rose-900/50 italic text-[13px] border-l border-rose-900/30 pl-3 opacity-60">
                                            {dev.v1_text}
                                        </p>
                                    </div>
                                ) : (
                                    (() => {
                                        // --- DYNAMIC INTRALINE STATE RENDERING ALGORITHM ---
                                        // By visually resolving the deviation immediately using the UI block 
                                        // we avoid shifting the V2 coordinate array.
                                        const dStatus = viewMode === 'v3' ? issueStatuses[dev.deviation_id] : null;
                                        let dStatusBadge = null;
                                        let dActiveColor = '';
                                        let dContent = null;

                                        if (dStatus === 'accepted') {
                                            dStatusBadge = '✅ Accepted (V2 Merged)';
                                            dActiveColor = 'emerald';
                                            dContent = <p className="font-sans font-medium text-[13px] border-l pl-3 leading-relaxed text-emerald-300 border-emerald-500/50 bg-emerald-900/10 py-2 px-2 italic">{dev.v2_text}</p>;
                                        } else if (dStatus === 'rejected') {
                                            dStatusBadge = '❌ Rejected (Reverted to V1)';
                                            dActiveColor = 'rose';
                                            dContent = <p className="font-sans font-medium text-[13px] border-l pl-3 leading-relaxed text-rose-300 border-rose-500/50 bg-rose-900/10 py-2 px-2 italic line-through decoration-rose-500/30">{dev.v1_text || 'Removed Clause'}</p>;
                                        } else if (dStatus === 'countered') {
                                            dStatusBadge = '🔄 Countered (BATNA Inserted)';
                                            dActiveColor = 'amber';
                                            const resolvedBatna = diffResult.batna_fallbacks.find(b => b.deviation_id === dev.deviation_id);
                                            dContent = <p className="font-sans font-medium text-[13px] border-l pl-3 leading-relaxed text-amber-300 border-amber-500/50 bg-amber-900/10 py-2 px-2 italic">{resolvedBatna?.fallback_clause || dev.v1_text}</p>;
                                        }

                                        if (dStatusBadge) {
                                            return (
                                                <div className="mt-1 relative">
                                                    <div className={`text-[10px] font-bold text-${dActiveColor}-400 mb-2 mt-2 tracking-wider flex items-center gap-1.5 uppercase`}>
                                                        {dStatusBadge}
                                                    </div>
                                                    {dContent}
                                                </div>
                                            );
                                        }

                                        return (
                                            <div className="mt-1">
                                                {dev.category === 'Modified' && dev.v1_text && (
                                                    <div className="mb-3">
                                                        <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-2">Inline Word Diff</span>
                                                        <div className="border-l pl-3 border-zinc-700/50">
                                                            <WordDiff oldText={dev.v1_text} newText={dev.v2_text} />
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedDevs(prev => ({ ...prev, [dev.deviation_id]: !prev[dev.deviation_id] })); }}
                                                            className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-[#D4AF37]/70 hover:text-[#D4AF37] transition-colors px-2 py-1 bg-white/5 rounded hover:bg-white/10 mt-3"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                {isExpanded ? 'visibility_off' : 'visibility'}
                                                            </span>
                                                            {isExpanded ? 'Hide Original Baseline' : 'Show Original Baseline'}
                                                        </button>

                                                        {isExpanded && (
                                                            <div className="mt-2 mb-4">
                                                                <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-1">Baseline (V1)</span>
                                                                <p className="line-through text-zinc-500 decoration-rose-900/80 italic text-[13px] border-l border-rose-900/30 pl-3">
                                                                    {dev.v1_text}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                <div>
                                                    {dev.category === 'Modified' && <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-1">Current Iteration (V2)</span>}
                                                    {dev.category !== 'Modified' && <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-1">Unresolved Issue</span>}
                                                    <p className={`font-sans font-medium text-[13px] border-l pl-3 leading-relaxed ${isAddOrMod ? 'text-emerald-300/90 border-emerald-900/40' : 'text-rose-300/90 border-rose-900/40'
                                                        }`}>
                                                        {dev.v2_text}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })()
                                )}
                            </div>
                        );
                    })}
                </div>
            );
        }

        // Render mapped deviations contextually within the raw text
        deviationsWithCoords.forEach((dev) => {
            const start = dev.v2_coordinates!.start_char;
            const end = dev.v2_coordinates!.end_char;

            // Catch-up text
            if (start > lastIndex) {
                elements.push(
                    <div key={`text-${lastIndex}`} className="prose prose-invert prose-zinc max-w-none prose-headings:font-serif prose-headings:font-light prose-p:text-[13px] prose-p:leading-[1.8] prose-p:text-zinc-400 prose-li:text-[13px] prose-li:leading-[1.8] prose-li:text-zinc-400 my-4">
                        <ReactMarkdown>
                            {v2.raw_text!.slice(lastIndex, start)}
                        </ReactMarkdown>
                    </div>
                );
            }

            const isSelected = selectedDevId === dev.deviation_id;
            const isAddOrMod = dev.category === 'Added' || dev.category === 'Modified';
            const isExpanded = expandedDevs[dev.deviation_id];

            // Contextual Deviation Box
            elements.push(
                <div
                    key={`dev-${dev.deviation_id}`}
                    id={`dev-${dev.deviation_id}`}
                    className={`relative my-8 p-6 -mx-8 sm:-mx-12 group transition-all duration-300 cursor-pointer shadow-lg rounded-r ${isAddOrMod ? 'bg-[#0d160d] border-l-4 border-emerald-900/80' : 'bg-[#1a0f0f] border-l-4 border-rose-900/80'
                        } ${isSelected ? 'ring-1 ring-white/10 scale-[1.02] shadow-[0_15px_30px_-10px_rgba(0,0,0,0.8)] z-10' : 'opacity-80 hover:opacity-100'}`}
                    onClick={(e) => { e.stopPropagation(); setSelectedDevId(dev.deviation_id); }}
                >
                    <div className={`absolute -left-[3px] top-6 w-5 h-5 rounded-full flex items-center justify-center border border-[#0a0a0a] ${isAddOrMod ? 'bg-emerald-900/80' : 'bg-rose-900/80'
                        }`}>
                        <span className={`material-symbols-outlined text-[10px] ${isAddOrMod ? 'text-emerald-200' : 'text-rose-200'}`}>
                            {isAddOrMod ? 'add' : 'close'}
                        </span>
                    </div>

                    <div className="flex justify-between items-center mb-4">
                        <span className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${isAddOrMod ? 'text-emerald-400/80' : 'text-rose-400/80'
                            }`}>
                            <span className="material-symbols-outlined text-[12px]">gavel</span>
                            DEVIATION LOG: {dev.category.toUpperCase()}
                        </span>
                        {isSelected && <span className="text-[10px] text-[#D4AF37] font-bold tracking-wider float-right">ACTIVE</span>}
                    </div>

                    {dev.category === 'Removed' ? (
                        <div className="relative mt-2">
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                <div className="bg-[#1a0f0f] text-rose-300 px-3 py-1 rounded border border-rose-500/30 text-[10px] uppercase font-bold tracking-widest shadow-2xl">
                                    Clause Deleted in V2
                                </div>
                            </div>
                            <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-1">Baseline (V1)</span>
                            <p className="line-through text-zinc-500 decoration-rose-900/50 italic text-[13px] border-l border-rose-900/30 pl-3 opacity-60">
                                {dev.v1_text}
                            </p>
                        </div>
                    ) : (
                        <div className="mt-1">
                            {dev.category === 'Modified' && dev.v1_text && (
                                <div className="mb-3">
                                    <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-2">Inline Word Diff</span>
                                    <div className="border-l pl-3 border-zinc-700/50">
                                        <WordDiff oldText={dev.v1_text} newText={dev.v2_text} />
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setExpandedDevs(prev => ({ ...prev, [dev.deviation_id]: !prev[dev.deviation_id] })); }}
                                        className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-[#D4AF37]/70 hover:text-[#D4AF37] transition-colors px-2 py-1 bg-white/5 rounded hover:bg-white/10 mt-3"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">
                                            {isExpanded ? 'visibility_off' : 'visibility'}
                                        </span>
                                        {isExpanded ? 'Hide Full V1 Baseline' : 'Show Full V1 Baseline'}
                                    </button>

                                    {isExpanded && (
                                        <div className="mt-2 mb-4">
                                            <span className="text-[9px] uppercase tracking-widest text-zinc-600 block mb-1">Full Baseline (V1)</span>
                                            <p className="line-through text-zinc-500 decoration-rose-900/80 italic text-[13px] border-l border-rose-900/30 pl-3">
                                                {dev.v1_text}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                            {dev.category !== 'Modified' && (
                                <div>
                                    <p className={`font-sans font-medium text-[13px] border-l pl-3 leading-relaxed ${isAddOrMod ? 'text-emerald-300/90 border-emerald-900/40' : 'text-rose-300/90 border-rose-900/40'
                                        }`}>
                                        {dev.v2_text}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );

            // Instead of skipping the raw text inside the deviation coordinates, 
            // the LLM already extracted it as 'v2_text'. So we skip it in the raw render.
            lastIndex = end;
        });

        // Remaining text
        if (lastIndex < v2.raw_text!.length) {
            elements.push(
                <div key={`text-${lastIndex}`} className="prose prose-invert prose-zinc max-w-none prose-headings:font-serif prose-headings:font-light prose-p:text-[13px] prose-p:leading-[1.8] prose-p:text-zinc-400 prose-li:text-[13px] prose-li:leading-[1.8] prose-li:text-zinc-400 my-4">
                    <ReactMarkdown>
                        {v2.raw_text!.slice(lastIndex)}
                    </ReactMarkdown>
                </div>
            );
        }

        return <div className="max-w-none pb-[20vh]">{elements}</div>;
    };

    const unresolvedCount = diffResult?.deviations.filter(d => !issueStatuses[d.deviation_id] || issueStatuses[d.deviation_id] === 'open' || issueStatuses[d.deviation_id] === 'countered').length || 0;
    const underReviewCount = diffResult?.deviations.filter(d => issueStatuses[d.deviation_id] === 'under_review' || issueStatuses[d.deviation_id] === 'escalated').length || 0;
    const resolvedCount = diffResult?.deviations.filter(d => issueStatuses[d.deviation_id] === 'accepted' || issueStatuses[d.deviation_id] === 'rejected').length || 0;

    return (
        <main className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] text-[#e5e2e1] overflow-hidden font-sans">

            {/* 1. THE AI INSIGHT BANNER */}
            <section className="w-full h-14 bg-[#0a0a0a] border-b border-zinc-800/60 flex items-center justify-between px-8 shrink-0">
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Negotiation Health:</span>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-400 opacity-60">V1 Risk: {v1Score}/100</span>
                        <span className="material-symbols-outlined text-[12px] text-zinc-600">
                            {v2Score > v1Score ? 'trending_up' : v2Score < v1Score ? 'trending_down' : 'trending_flat'}
                        </span>
                        <span className={`text-xs font-bold ${v2Score > v1Score ? 'text-[#D4AF37]/90' : 'text-emerald-500'}`}>
                            {v3_working ? 'V3 Working Risk:' : 'V2 Draft Risk:'} {v2Score}/100
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button className="text-[#D4AF37] text-xs hover:underline underline-offset-4 font-medium" onClick={() => router.push(`/dashboard/contracts/${contractId}`)}>
                        Back to Contract
                    </button>
                </div>
            </section>

            {/* MAIN WORKSPACE: 3 COLUMNS */}
            <section className="flex-1 flex overflow-hidden">

                {/* COLUMN A: Version & Deviations */}
                <aside className="w-[280px] bg-[#0a0a0a] border-r border-zinc-800/40 p-6 flex flex-col gap-8 shrink-0 overflow-y-auto custom-scrollbar">
                    <div>
                        <h4 className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase font-bold mb-4">Lineage Overview</h4>
                        <div className="space-y-3 mb-6">
                            <div
                                className={`p-3 rounded flex justify-between items-center opacity-70 cursor-pointer transition-all ${viewMode === 'v1' ? 'bg-[#141414] border-2 border-[#D4AF37]/40 shadow-[0_0_15px_rgba(212,175,55,0.05)]' : 'bg-[#111] border border-zinc-800/60 hover:opacity-100 hover:border-zinc-600'}`}
                                onClick={() => setViewMode('v1')}
                            >
                                <div>
                                    <span className={`text-xs font-bold font-serif block break-words max-w-[120px] ${viewMode === 'v1' ? 'text-[#D4AF37]' : 'text-zinc-400'}`}>Baseline (V1)</span>
                                    <span className="text-[9px] text-zinc-600 uppercase">System Record</span>
                                </div>
                                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 flex-shrink-0 py-0.5 rounded border border-zinc-700">Source</span>
                            </div>
                            <div className="w-0.5 h-4 bg-zinc-800 ml-6"></div>

                            <div
                                className={`p-3 rounded flex justify-between items-center cursor-pointer transition-all ${viewMode === 'v2' ? 'bg-[#141414] border-2 border-[#D4AF37]/40 shadow-[0_0_15px_rgba(212,175,55,0.05)]' : 'bg-[#111] border border-[#D4AF37]/20 hover:border-[#D4AF37]/40 opacity-80 hover:opacity-100'}`}
                                onClick={() => setViewMode('v2')}
                            >
                                <div>
                                    <span className={`text-xs font-bold font-serif block break-words max-w-[120px] ${viewMode === 'v2' ? 'text-[#D4AF37]' : 'text-zinc-500'}`}>Round 1 (V2)</span>
                                    <span className="text-[9px] text-zinc-500 uppercase">Counterparty Upload</span>
                                </div>
                                <span className="text-[10px] bg-[#D4AF37]/10 text-[#D4AF37] px-2 flex-shrink-0 py-0.5 rounded border border-[#D4AF37]/20">Active Diff</span>
                            </div>

                            {v3_working && (
                                <>
                                    <div className="w-0.5 h-4 bg-[#D4AF37]/40 ml-6"></div>
                                    <div
                                        className={`p-3 rounded flex justify-between items-center cursor-pointer transition-all shadow-[0_0_15px_rgba(16,185,129,0.05)] ${viewMode === 'v3' ? 'bg-[#1a2e1a] border-2 border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.15)]' : 'bg-[#1a2e1a] border border-emerald-900/60 hover:border-emerald-700/60 opacity-80 hover:opacity-100'}`}
                                        onClick={() => setViewMode('v3')}
                                    >
                                        <div>
                                            <span className={`text-xs font-bold font-serif block break-words max-w-[120px] ${viewMode === 'v3' ? 'text-emerald-400' : 'text-emerald-500'}`}>Working Draft (V3)</span>
                                            <span className="text-[9px] text-emerald-600/80 uppercase">Merges</span>
                                        </div>
                                        <span className="text-[10px] bg-emerald-900/30 font-bold text-emerald-400 flex-shrink-0 px-2 py-0.5 rounded border border-emerald-800/50 flex gap-1 items-center">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                            Live
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="pt-2">
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept=".pdf,.docx,.txt"
                            onChange={handleFileUpload}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="w-full mt-3 py-3 border border-dashed border-zinc-700 hover:border-[#D4AF37]/50 text-zinc-500 hover:text-[#D4AF37] text-[10px] font-bold uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isUploading ? (
                                <>
                                    <span className="w-3 h-3 border-2 border-[#D4AF37]/20 rounded-full animate-spin border-t-[#D4AF37]" />
                                    UPLOADING...
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-xs">arrow_upward</span>
                                    UPLOAD NEXT VERSION
                                </>
                            )}
                        </button>
                    </div>

                    <div className="mb-8 mt-2 p-4 bg-[#111] border border-zinc-800/80 rounded flex flex-col gap-3 shadow-inner">
                        <h4 className="text-[9px] text-zinc-500 tracking-[0.2em] uppercase font-bold text-center">Momentum Tracker</h4>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between bg-[#1a0f0f] border border-rose-900/50 px-3 py-2 rounded shadow-[0_0_10px_rgba(225,29,72,0.1)]">
                                <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider flex items-center gap-2"><span className="text-[12px]">⚠️</span> Unresolved</span>
                                <span className="text-[12px] font-bold text-rose-300">{unresolvedCount}</span>
                            </div>
                            <div className="flex items-center justify-between bg-blue-900/10 border border-blue-900/40 px-3 py-2 rounded shadow-[0_0_10px_rgba(59,130,246,0.1)]">
                                <span className="text-[10px] text-blue-300 font-bold uppercase tracking-wider flex items-center gap-2"><span className="text-[12px]">🟡</span> Under Review</span>
                                <span className="text-[12px] font-bold text-blue-200">{underReviewCount}</span>
                            </div>
                            <div className="flex items-center justify-between bg-emerald-900/10 border border-emerald-900/40 px-3 py-2 rounded shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-2"><span className="text-[12px]">✅</span> Resolved</span>
                                <span className="text-[12px] font-bold text-emerald-300">{resolvedCount}</span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h4 className="text-[10px] text-rose-400 tracking-[0.2em] uppercase font-bold mb-4 flex items-center gap-2">
                            <span className="material-symbols-outlined text-xs">gavel</span>
                            Identified Deviations
                        </h4>
                        <div className="space-y-3">
                            {diffResult.deviations.map((dev) => (
                                <div
                                    key={dev.deviation_id}
                                    onClick={() => {
                                        setSelectedDevId(dev.deviation_id);
                                        const el = document.getElementById(`dev-${dev.deviation_id}`);
                                        if (el) {
                                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        }
                                    }}
                                    className={`p-4 rounded-lg cursor-pointer transition-all border ${selectedDevId === dev.deviation_id
                                            ? 'bg-[#1a0f0f] border-rose-900/40 shadow-sm'
                                            : 'bg-[#0f0f0f] border-zinc-800/40 hover:border-zinc-700/60 opacity-60 hover:opacity-100'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-1.5 h-1.5 rounded-full ${dev.severity === 'critical' ? 'bg-rose-500' : dev.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`}></span>
                                            <h5 className="text-xs font-medium text-rose-200 truncate max-w-[130px]">{dev.title}</h5>
                                        </div>
                                        {issueStatuses[dev.deviation_id] && (
                                            <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${getStatusColor(issueStatuses[dev.deviation_id])}`}>
                                                {issueStatuses[dev.deviation_id].replace('_', ' ')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-rose-400/80 leading-relaxed truncate">{dev.impact_analysis}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>

                {/* COLUMN B: The Document (Smart Diff) */}
                <section className="flex-1 bg-[#0a0a0a] overflow-y-auto p-12 custom-scrollbar relative">
                    <div className="max-w-3xl mx-auto bg-[#0f0f0f] border border-zinc-800/60 rounded-xl p-16 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]">
                        <header className="mb-12 text-center">
                            <h1 className="font-serif text-2xl font-light text-zinc-100 tracking-tight mb-2">{contractTitle}</h1>
                            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">Negotiation War Room Diff</p>
                        </header>

                        <article className="font-serif text-[15px] leading-[1.8] text-zinc-300 space-y-8">
                            {viewMode === 'v1' ? (
                                <div className="prose prose-invert prose-zinc max-w-none prose-headings:font-serif prose-headings:font-light prose-p:text-[13px] prose-p:leading-[1.8] prose-p:text-zinc-400 prose-li:text-[13px] prose-li:leading-[1.8] prose-li:text-zinc-400 pb-[20vh]">
                                    {v1?.raw_text ? (
                                        <ReactMarkdown>{v1.raw_text}</ReactMarkdown>
                                    ) : (
                                        'No raw text available for V1.'
                                    )}
                                </div>
                            ) : viewMode === 'v3' ? (
                                <div className="prose prose-invert prose-zinc max-w-none prose-headings:font-serif prose-headings:font-light prose-p:text-[13px] prose-p:leading-[1.8] prose-p:text-zinc-400 prose-li:text-[13px] prose-li:leading-[1.8] prose-li:text-zinc-400 pb-[20vh]">
                                    {v3_working?.raw_text ? (
                                        <ReactMarkdown>{v3_working.raw_text}</ReactMarkdown>
                                    ) : (
                                        renderV2WithContextualDeviations()
                                    )}
                                </div>
                            ) : (
                                renderV2WithContextualDeviations()
                            )}
                        </article>
                    </div>
                </section>

                {/* COLUMN C: AI Co-Counsel & BATNA Center */}
                <aside className="w-[420px] bg-[#0a0a0a] border-l border-zinc-800/40 flex flex-col shrink-0 overflow-y-auto">
                    {selectedDev && (
                        <div className="p-6 border-b border-zinc-800/40 bg-[#0c0c0c]">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-[10px] text-[#f2ca50] tracking-[0.25em] uppercase font-bold">AI Negotiation Co-Counsel</h3>
                            </div>
                            <div className="space-y-4">

                                {/* AI Co-Counsel Card */}
                                <div className={`bg-[#141414] border-l-2 p-4 rounded shadow-sm ${selectedDev.severity === 'critical' ? 'border-rose-500' : 'border-amber-500'}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`material-symbols-outlined text-sm ${selectedDev.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'}`}>warning</span>
                                        <span className={`text-xs font-bold ${selectedDev.severity === 'critical' ? 'text-rose-100' : 'text-amber-100'}`}>
                                            Risk: {selectedDev.title}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed mb-4">
                                        {selectedDev.impact_analysis}
                                    </p>

                                    {/* ── COUNTERPARTY INTENT CARD ── */}
                                    {selectedDev.counterparty_intent && (
                                        <div className="mb-4 bg-[#0d0a1a] border border-indigo-800/40 p-3 rounded-lg">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="material-symbols-outlined text-sm text-indigo-400">psychology</span>
                                                <span className="text-[9px] uppercase tracking-widest text-indigo-400 font-bold">Why Changed? — Counterparty Intent</span>
                                            </div>
                                            <p className="text-[11px] text-indigo-200/90 leading-relaxed italic">
                                                {selectedDev.counterparty_intent}
                                            </p>
                                        </div>
                                    )}

                                    {selectedBATNA && (
                                        <div className="bg-[#f2ca50]/5 border border-[#f2ca50]/20 p-3 rounded-lg mb-4">
                                            <span className="text-[9px] uppercase tracking-widest text-[#D4AF37] font-bold block mb-1">BATNA Strategy</span>
                                            <p className="text-[11px] text-[#D4AF37]/90 leading-tight mb-3 italic">
                                                {selectedBATNA.reasoning}
                                            </p>
                                            <div className="bg-[#111] p-2 mt-2 mb-3 rounded border border-zinc-800">
                                                <p className="text-xs text-zinc-300 font-serif whitespace-pre-wrap">{selectedBATNA.fallback_clause}</p>
                                            </div>

                                            <button
                                                onClick={() => handleStatusChange(selectedDev.deviation_id, 'countered', 'Applied BATNA Strategy automatically.')}
                                                disabled={isStatusUpdating || issueStatuses[selectedDev.deviation_id] === 'countered'}
                                                className="w-full mt-2 mb-3 py-2 bg-[#D4AF37] hover:brightness-110 text-black text-[10px] uppercase font-bold tracking-widest rounded flex justify-center items-center gap-1 transition-all disabled:opacity-50"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">bolt</span>
                                                Apply This Strategy
                                            </button>

                                            {selectedBATNA.leverage_points?.length > 0 && (
                                                <div className="mb-1">
                                                    <span className="text-[9px] uppercase tracking-widest text-zinc-500 block mb-1 font-bold">Leverage Points:</span>
                                                    <ul className="list-disc pl-4 space-y-1">
                                                        {selectedBATNA.leverage_points.map((point, idx) => (
                                                            <li key={idx} className="text-[10px] text-zinc-400">{point}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Playbook Citation */}
                                    {selectedDev.playbook_violation && (
                                        <div className="mb-4 flex items-start gap-2.5 bg-[#050505] border border-zinc-800/80 p-3 rounded-lg shadow-inner">
                                            <span className="shrink-0 text-base">⚖️</span>
                                            <div className="flex-1">
                                                <span className="text-zinc-500 font-bold uppercase tracking-widest block mb-1" style={{ fontSize: '9px' }}>Playbook Policy Citation</span>
                                                <p className="italic leading-relaxed text-[11px] text-zinc-300">"{selectedDev.playbook_violation}"</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── NEGOTIATION STATE ACTIONS ── */}
                                    <div className="mb-4">
                                        <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold block mb-2">Negotiation Decision</span>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setShowReasoningModal({ devId: selectedDev.deviation_id, action: 'accepted' })}
                                                disabled={isStatusUpdating || issueStatuses[selectedDev.deviation_id] === 'accepted'}
                                                className="py-2 border border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37]/10 text-[9px] font-bold uppercase tracking-wider transition-all rounded disabled:opacity-30 flex items-center justify-center gap-1"
                                            >
                                                <span className="material-symbols-outlined text-[12px]">check_circle</span>
                                                Accept
                                            </button>
                                            <button
                                                onClick={() => setShowReasoningModal({ devId: selectedDev.deviation_id, action: 'rejected' })}
                                                disabled={isStatusUpdating || issueStatuses[selectedDev.deviation_id] === 'rejected'}
                                                className="py-2 border border-zinc-700 text-zinc-400 hover:text-rose-500 hover:border-rose-500 text-[9px] font-bold uppercase tracking-wider transition-all rounded disabled:opacity-30 flex items-center justify-center gap-1"
                                            >
                                                <span className="material-symbols-outlined text-[12px]">cancel</span>
                                                Reject
                                            </button>
                                            <button
                                                onClick={() => setShowReasoningModal({ devId: selectedDev.deviation_id, action: 'countered' })}
                                                disabled={isStatusUpdating || issueStatuses[selectedDev.deviation_id] === 'countered'}
                                                className="py-2 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-[9px] font-bold uppercase tracking-wider transition-all rounded disabled:opacity-30 flex items-center justify-center gap-1"
                                            >
                                                <span className="material-symbols-outlined text-[12px]">reply</span>
                                                Counter
                                            </button>
                                            <button
                                                onClick={handleEditInComposer}
                                                disabled={isStatusUpdating}
                                                className="py-2 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/60 text-[9px] font-bold uppercase tracking-wider transition-all rounded disabled:opacity-30 flex items-center justify-center gap-1"
                                            >
                                                Edit in Composer
                                            </button>
                                        </div>

                                        {/* Current Status Badge */}
                                        {issueStatuses[selectedDev.deviation_id] && (
                                            <div className={`mt-2 text-center py-1.5 rounded border text-[9px] font-bold uppercase tracking-wider ${getStatusColor(issueStatuses[selectedDev.deviation_id])}`}>
                                                {issueStatuses[selectedDev.deviation_id] === 'escalated'
                                                    ? '🔒 Waiting Internal Approval (Task Locked)'
                                                    : `Current Decision: ${issueStatuses[selectedDev.deviation_id].replace('_', ' ')}`
                                                }
                                            </div>
                                        )}
                                    </div>

                                    {/* ── AUDIT TRAIL ── */}
                                    {auditLogs[selectedDev.deviation_id]?.length > 0 && (
                                        <div className="mb-4">
                                            <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold block mb-2">Audit Trail</span>
                                            <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                                                {auditLogs[selectedDev.deviation_id].map((entry, idx) => (
                                                    <div key={idx} className="bg-[#050505] border border-zinc-800/60 p-2 rounded text-[10px]">
                                                        <div className="flex justify-between items-center mb-0.5">
                                                            <span className={`font-bold uppercase tracking-wider ${getStatusColor(entry.action).split(' ')[1]}`}>
                                                                {entry.action.replace('_', ' ')}
                                                            </span>
                                                            <span className="text-zinc-600">
                                                                {new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        {entry.reason && <p className="text-zinc-400 italic mb-2">"{entry.reason}"</p>}
                                                        {entry.generated_response && (
                                                            <div className="mt-2 p-2 bg-zinc-900 border border-zinc-800 rounded">
                                                                <span className="text-[9px] uppercase tracking-widest text-[#D4AF37] font-bold block mb-1">Generated Response (Ready to Send)</span>
                                                                <p className="text-zinc-300 font-serif leading-relaxed">"{entry.generated_response}"</p>
                                                                <button className="mt-2 text-blue-400 font-bold uppercase text-[9px] hover:underline">[ Edit Response ]</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Escalate */}
                                    <button
                                        onClick={() => handleEscalate(selectedDev)}
                                        disabled={isEscalating}
                                        className="w-full py-2 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-[10px] font-bold uppercase tracking-widest transition-all rounded disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isEscalating ? 'Escalating...' : 'Escalate to Task ⚡'}
                                    </button>
                                </div>

                            </div>
                        </div>
                    )}

                    {!selectedDev && (
                        <div className="p-6 text-center text-zinc-500 text-sm">
                            No deviation selected.
                        </div>
                    )}

                </aside>

            </section>

            {/* ── REASONING MODAL ── */}
            {showReasoningModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-[#141414] border border-zinc-700/60 rounded-xl p-6 w-[440px] shadow-2xl">
                        <h3 className="text-sm font-bold text-zinc-200 mb-1">
                            {showReasoningModal.action === 'accepted' ? '✓ Accept' :
                                showReasoningModal.action === 'rejected' ? '✗ Reject' :
                                    '↩ Counter'} This Deviation
                        </h3>
                        <p className="text-[10px] text-zinc-500 mb-4">
                            Provide reasoning for this negotiation decision. This will be recorded in the audit trail.
                        </p>
                        <textarea
                            value={reasoningText}
                            onChange={(e) => setReasoningText(e.target.value)}
                            placeholder={`e.g., "${showReasoningModal.action === 'accepted' ? 'Accepted: Finance approved Net-90 terms as commercially reasonable.' : showReasoningModal.action === 'rejected' ? 'Rejected: Violates our standard liability cap policy.' : 'Countered: Proposed mutual indemnification as a compromise.'}"`}
                            className="w-full h-24 bg-[#0a0a0a] border border-zinc-700/60 rounded-lg p-3 text-xs text-zinc-300 placeholder-zinc-500 resize-none focus:outline-none focus:border-[#D4AF37]/50 transition-colors"
                            autoFocus
                        />
                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={() => { setShowReasoningModal(null); setReasoningText(''); }}
                                className="flex-1 py-2 bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-zinc-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleStatusChange(showReasoningModal.devId, showReasoningModal.action)}
                                disabled={isStatusUpdating || !reasoningText.trim()}
                                className={`flex-1 py-2 border text-[10px] font-bold uppercase tracking-widest rounded transition-colors disabled:opacity-40 ${showReasoningModal.action === 'accepted' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30' :
                                        showReasoningModal.action === 'rejected' ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30' :
                                            'bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30'
                                    }`}
                            >
                                {isStatusUpdating ? 'Saving...' : 'Confirm Decision'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
