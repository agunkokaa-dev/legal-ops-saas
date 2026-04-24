'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { searchLaws } from '@/app/actions/backend';
import { uploadDocument } from '@/app/actions/documentActions';
import { useLawsUI } from '@/components/laws/LawsUIProvider';
import ReactMarkdown from 'react-markdown';
import DeviationAssistantPanel from './DeviationAssistantPanel';
import LeftSidebar from './LeftSidebar';
import RelatedLawsPanel from './RelatedLawsPanel';
import V2ContextualDiffView from './V2ContextualDiffView';
import V3WorkingDraftView from './V3WorkingDraftView';
import dynamic from 'next/dynamic';
import { WarRoomHeader } from './WarRoomHeader';
import FinalizeRoundButton from './FinalizeRoundButton';
import ClauseAssistant from '../contract-detail/ClauseAssistant';
const WarRoomCenterPanel = dynamic(
    () => import('./WarRoomCenterPanel').then(mod => mod.WarRoomCenterPanel),
    {
        ssr: false,
        loading: () => (
            <div className="flex-1 flex items-center justify-center bg-[#0A0A0F]">
                <div className="text-zinc-500 text-sm">Loading document viewer…</div>
            </div>
        ),
    }
);

import { useContractSSE } from '@/hooks/useContractSSE';
import { getPublicApiBase } from '@/lib/public-api-base';
import type { LawSearchResponse, LawSearchResult } from '@/types/laws';
import WarRoomStateScreen from './WarRoomStateScreen';
import type {
    AuditLogEntry,
    BATNAFallback,
    ContractVersion,
    DiffDeviation,
    NegotiationIssue,
    SmartDiffResult,
} from './warRoomTypes';
import {
    RESOLVED_STATUSES,
    TERMINAL_STATUSES,
    buildFallbackDiffResult,
    isIssueFinalizeResolved,
    isStructuralChangeDetected,
    normalizeDiffResult,
    normalizeIssue,
    normalizeVersion,
    replaceLastAuditEntry,
    resolveWarRoomVersions,
} from './warRoomUtils';

type WarRoomComposerPrefill = {
    text: string;
    source: 'war_room';
    contractId: string;
    matterId: string;
    title: string;
    versionLabel: string;
};

const WAR_ROOM_COMPOSER_PREFILL_KEY = 'war_room:composer_prefill';

export default function WarRoomClient({
    contractId,
    matterId,
    contractTitle,
    contractStatus,
    fileUrl,
}: {
    contractId: string;
    matterId: string;
    contractTitle: string;
    contractStatus?: string | null;
    fileUrl?: string | null;
}) {
    const { getToken, userId } = useAuth();
    const { openNodeDetail } = useLawsUI();
    const router = useRouter();

    const [isLoading, setIsLoading] = useState(true);
    const [loadingStage, setLoadingStage] = useState('Fetching history...');
    const [diffResult, setDiffResult] = useState<SmartDiffResult | null>(null);
    const [versions, setVersions] = useState<ContractVersion[]>([]);

    const [selectedDevId, setSelectedDevId] = useState<string | null>(null);
    const [showClauseAssistant, setShowClauseAssistant] = useState(false);

    useEffect(() => {
        setShowClauseAssistant(false);
    }, [selectedDevId]);

    // Toggles central view between the Smart Diff (V2) vs the Baseline text (V1)
    const [viewMode, setViewMode] = useState<'v1' | 'v2' | 'v3'>('v2');

    // ── STATUS MANAGEMENT STATE ──
    const [issues, setIssues] = useState<NegotiationIssue[]>([]);
    const [pendingDecision, setPendingDecision] = useState<{ issueId: string; status: string } | null>(null);

    // ── FILTERS ──
    const [severityFilters, setSeverityFilters] = useState<Record<string, boolean>>({});
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    const [waitingForRealtime, setWaitingForRealtime] = useState(false);
    const [realtimeError, setRealtimeError] = useState<string | null>(null);
    const [enableDebate, setEnableDebate] = useState(false);

    const [relatedLawResults, setRelatedLawResults] = useState<LawSearchResult[]>([]);
    const [showRelatedLawsPanel, setShowRelatedLawsPanel] = useState(false);
    const [isLoadingRelatedLaws, setIsLoadingRelatedLaws] = useState(false);
    const [relatedLawsError, setRelatedLawsError] = useState<string | null>(null);
    const [relatedLawsCoverageNote, setRelatedLawsCoverageNote] = useState<string | null>(null);
    const [isFinalizeRoundModalOpen, setIsFinalizeRoundModalOpen] = useState(false);

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contractId, enableDebate]);

    const buildNegotiationApiUrl = useCallback((suffix = '') => {
        const apiBase = getPublicApiBase();
        const negotiationBase = apiBase.endsWith('/api/v1')
            ? `${apiBase}/negotiation/${contractId}`
            : `${apiBase}/api/v1/negotiation/${contractId}`;
        return suffix ? `${negotiationBase}/${suffix.replace(/^\/+/, '')}` : negotiationBase;
    }, [contractId]);

    const getAuthToken = useCallback(async () => {
        const token = await getToken();
        if (!token) {
            throw new Error('Authentication failed');
        }
        return token;
    }, [getToken]);

    const fetchVersions = useCallback(async (token: string) => {
        const response = await fetch(buildNegotiationApiUrl('versions'), {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch versions');
        }

        const data = await response.json();
        const rawVersions: unknown[] = Array.isArray(data)
            ? data
            : Array.isArray(data?.versions)
                ? data.versions
                : Array.isArray(data?.version_history)
                    ? data.version_history
                    : Array.isArray(data?.data)
                        ? data.data
                        : [];
        const nextVersions: ContractVersion[] = rawVersions
            .map((rawVersion) => normalizeVersion(rawVersion))
            .filter((version): version is ContractVersion => Boolean(version?.id));
        setVersions(nextVersions);
        return nextVersions;
    }, [buildNegotiationApiUrl]);

    const parseIssuesResponse = useCallback((data: unknown): NegotiationIssue[] => {
        const rawIssues: unknown[] = Array.isArray(data)
            ? data
            : Array.isArray((data as any)?.issues)
                ? (data as any).issues
                : Array.isArray((data as any)?.issueList)
                    ? (data as any).issueList
                    : Array.isArray((data as any)?.negotiation_issues)
                        ? (data as any).negotiation_issues
                        : Array.isArray((data as any)?.data)
                            ? (data as any).data
                            : [];
        return rawIssues
            .map((rawIssue) => normalizeIssue(rawIssue))
            .filter((issue): issue is NegotiationIssue => Boolean(issue?.id));
    }, []);

    const fetchIssuesForVersion = useCallback(async (token: string, versionId?: string | null) => {
        if (!versionId) {
            setIssues([]);
            return [] as NegotiationIssue[];
        }

        // 1. Try fetching with version_id filter
        const response = await fetch(buildNegotiationApiUrl(`issues?version_id=${versionId}`), {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch negotiation issues');
        }

        let nextIssues = parseIssuesResponse(await response.json());

        // 2. Fallback: if version-filtered fetch returned 0, retry WITHOUT version_id
        //    Issues may exist under a different version_id or none at all.
        if (nextIssues.length === 0) {
            try {
                const fallbackRes = await fetch(buildNegotiationApiUrl('issues'), {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (fallbackRes.ok) {
                    nextIssues = parseIssuesResponse(await fallbackRes.json());
                }
            } catch (fallbackErr) {
                console.warn('[WarRoom] Fallback issue fetch failed:', fallbackErr);
            }
        }

        setIssues(nextIssues);
        return nextIssues;
    }, [buildNegotiationApiUrl, parseIssuesResponse]);

    const refreshVersions = useCallback(async (token?: string) => {
        const authToken = token || await getAuthToken();
        return fetchVersions(authToken);
    }, [fetchVersions, getAuthToken]);

    const persistComposerPrefill = useCallback((payload: WarRoomComposerPrefill | null) => {
        if (typeof window === 'undefined') {
            return;
        }

        if (!payload) {
            window.sessionStorage.removeItem(WAR_ROOM_COMPOSER_PREFILL_KEY);
            return;
        }

        window.sessionStorage.setItem(
            WAR_ROOM_COMPOSER_PREFILL_KEY,
            JSON.stringify(payload),
        );
    }, []);

    const patchIssueStatus = useCallback(async (
        token: string,
        issueId: string,
        status: string,
        reason: string,
    ) => {
        const response = await fetch(buildNegotiationApiUrl(`issues/${issueId}/status`), {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                status,
                reason,
                actor: userId || 'User'
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.detail || 'Failed to update issue status');
        }

        return data;
    }, [buildNegotiationApiUrl, userId]);

    const applyOptimisticIssueStatus = useCallback(async ({
        issueId,
        newStatus,
        reason,
        successTitle,
        successDescription,
    }: {
        issueId: string;
        newStatus: string;
        reason: string;
        successTitle: string;
        successDescription: string;
    }) => {
        const currentIssue = issues.find((issue) => issue.id === issueId);
        if (!currentIssue) {
            toast.error('No negotiation issue found for this deviation.');
            return false;
        }

        const optimisticEntry: AuditLogEntry = {
            action: newStatus,
            actor: userId || 'User',
            reason,
            timestamp: new Date().toISOString(),
            previous_status: currentIssue.status,
        };
        const previousIssues = issues;

        setPendingDecision({ issueId, status: newStatus });
        setIssues((prev) => prev.map((issue) => issue.id === issueId ? {
            ...issue,
            status: newStatus,
            reasoning_log: [...(issue.reasoning_log || []), optimisticEntry],
        } : issue));
        toast.success(successTitle, { description: successDescription });

        try {
            const token = await getAuthToken();
            const result = await patchIssueStatus(token, issueId, newStatus, reason);

            setIssues((prev) => prev.map((issue) => issue.id === issueId ? {
                ...issue,
                status: result.new_status || newStatus,
                linked_task_id: result.task_id ?? issue.linked_task_id,
                reasoning_log: result.audit_entry
                    ? replaceLastAuditEntry(issue.reasoning_log, result.audit_entry)
                    : issue.reasoning_log,
            } : issue));
            void refreshVersions(token).catch(() => undefined);
            return true;
        } catch (error: any) {
            setIssues(previousIssues);
            toast.error('Failed to save decision', {
                description: error.message || 'Status has been reverted. Please try again.',
            });
            return false;
        } finally {
            setPendingDecision(null);
        }
    }, [getToken, issues, patchIssueStatus, refreshVersions, userId]);

    const loadData = useCallback(async () => {
        try {
            setIsLoading(true);
            setRealtimeError(null);
            const token = await getAuthToken();

            // 1. Fetch versions
            setLoadingStage('Fetching version history...');
            const nextVersions = await fetchVersions(token);
            const { baselineVersion, counterpartyVersion, workingDraftVersion } = resolveWarRoomVersions(nextVersions);

            if (!baselineVersion || !counterpartyVersion) {
                setWaitingForRealtime(true);
                setDiffResult(null);
                setIssues([]);
                setLoadingStage('Waiting for the revised contract to finish processing...');
                return;
            }

            setViewMode((prev) => prev === 'v3' && !workingDraftVersion ? 'v2' : prev);
            const issuesPromise = fetchIssuesForVersion(token, counterpartyVersion.id)
                .catch((issueError) => {
                    console.error('[WarRoom] Failed to fetch issues:', issueError);
                    setIssues([]);
                    return [] as NegotiationIssue[];
                });

            // 2. Fetch Cached Smart Diff
            setLoadingStage('Checking for cached Smart Diff...');
            let diffData: SmartDiffResult | null = null;

            let cachedDiffWithoutDebate: SmartDiffResult | null = null;

            const getRes = await fetch(
                buildNegotiationApiUrl(`diff?version_id=${encodeURIComponent(counterpartyVersion.id)}`),
                {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (getRes.ok) {
                diffData = normalizeDiffResult(await getRes.json());
                if (enableDebate && !diffData?.debate_protocol) {
                    cachedDiffWithoutDebate = diffData;
                    diffData = null;
                }
            }

            if (!diffData) {
                // 3. Trigger Smart Diff if not cached or if debate enrichment is missing
                setLoadingStage(enableDebate
                    ? 'Running Smart Diff Agent + AI Debate (Comparing V1 vs V2 against Playbook)...'
                    : 'Running Smart Diff Agent (Comparing V1 vs V2 against Playbook)...');
                const diffRes = await fetch(buildNegotiationApiUrl(`diff?enable_debate=${enableDebate}`), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        v1_version_id: baselineVersion.id,
                        v2_version_id: counterpartyVersion.id,
                    })
                });

                if (diffRes.status === 202) {
                    const queued = await diffRes.json();
                    setWaitingForRealtime(true);
                    setDiffResult(cachedDiffWithoutDebate);
                    setLoadingStage(String(queued.message || 'Smart Diff queued. Waiting for worker...'));
                    await issuesPromise;
                    return;
                }

                if (!diffRes.ok) {
                    const err = await diffRes.json().catch(() => ({}));
                    const detail = err.detail || 'Smart Diff execution failed';
                    if (String(detail).toLowerCase().includes('not enough versions')) {
                        setWaitingForRealtime(true);
                        setDiffResult(null);
                        setLoadingStage('Waiting for the revised contract to finish processing...');
                        await issuesPromise;
                        return;
                    }
                    throw new Error(detail);
                }
                diffData = normalizeDiffResult(await diffRes.json());
            }

            setWaitingForRealtime(false);
            setDiffResult(diffData);
            const fetchedIssues = await issuesPromise;

            // If no issues came from the DB but we have deviations,
            // synthesize NegotiationIssue objects so the decision buttons render.
            if ((!fetchedIssues || fetchedIssues.length === 0) && diffData?.deviations?.length) {
                const syntheticIssues: NegotiationIssue[] = diffData.deviations.map((dev) => ({
                    id: dev.deviation_id,
                    contract_id: contractId,
                    version_id: null,
                    deviation_id: dev.deviation_id,
                    finding_id: dev.deviation_id,
                    title: dev.title || 'Untitled Deviation',
                    description: dev.impact_analysis || null,
                    status: 'open',
                    severity: dev.severity || 'warning',
                    category: dev.category || 'Negotiation',
                    linked_task_id: null,
                    linked_task_status: null,
                    reasoning_log: [],
                    decided_at: null,
                }));
                setIssues(syntheticIssues);
            }

        } catch (error: any) {
            setWaitingForRealtime(false);
            setRealtimeError(error.message || 'Failed to initialize War Room');
            toast.error(error.message || 'Failed to initialize War Room');
        } finally {
            setIsLoading(false);
        }
    }, [buildNegotiationApiUrl, enableDebate, fetchIssuesForVersion, fetchVersions, getAuthToken]);

    const { isConnected: isSSEConnected, isFallbackPolling } = useContractSSE({
        contractId,
        enabled: true,
        pollFallback: async () => {
            if (!diffResult || waitingForRealtime) {
                await loadData();
            }
        },
        onPipelineProgress: (event) => {
            if (!diffResult) {
                setWaitingForRealtime(true);
                setLoadingStage(String(event.data.message || 'Contract pipeline is still running...'));
            }
        },
        onPipelineCompleted: async () => {
            if (!diffResult) {
                setWaitingForRealtime(true);
                setLoadingStage('Contract review complete. Initializing Smart Diff...');
                await loadData();
            }
        },
        onPipelineFailed: (event) => {
            setWaitingForRealtime(false);
            setRealtimeError(String(event.data.error || 'Contract processing failed before Smart Diff completed'));
        },
        onDiffStarted: (event) => {
            setWaitingForRealtime(true);
            setLoadingStage(String(event.data.message || 'Smart Diff analysis in progress...'));
        },
        onDiffCompleted: async (event) => {
            setWaitingForRealtime(false);
            setLoadingStage('Loading Smart Diff results...');
            await loadData();
            toast.success(`Analysis complete: ${Number(event.data.deviations_count || 0)} deviations found`);
        },
        onDiffFailed: (event) => {
            setWaitingForRealtime(false);
            setRealtimeError(String(event.data.error || 'Smart Diff execution failed'));
            toast.error(String(event.data.error || 'Smart Diff execution failed'));
        },
        onStatusChanged: async (event) => {
            const nextStatus = String(event.data.new_status || '').toLowerCase();
            if (nextStatus === 'failed') {
                setWaitingForRealtime(false);
                setRealtimeError('AI processing failed before Smart Diff could complete');
            } else if (nextStatus === 'reviewed' && !diffResult) {
                setLoadingStage('Contract review complete. Checking Smart Diff cache...');
                await loadData();
            }
        },
        onNegotiationIssueUpdated: (event) => {
            if (event.data.issue_id && event.data.new_status) {
                setIssues((prev) => prev.map((issue) => issue.id === String(event.data.issue_id)
                    ? { ...issue, status: String(event.data.new_status) }
                    : issue));
            }
        },
    });

    const handleDecision = useCallback(async (
        issueId: string,
        newStatus: 'accepted' | 'rejected' | 'countered' | 'open' | 'escalated',
        reason: string,
        successTitle: string,
        successDescription: string,
    ) => {
        await applyOptimisticIssueStatus({
            issueId,
            newStatus,
            reason,
            successTitle,
            successDescription,
        });
    }, [applyOptimisticIssueStatus]);

    const handleVersionUploaded = useCallback(async () => {
        setLoadingStage('Initializing Next Version Smart Diff...');
        setIsLoading(true);
        router.refresh();
        await loadData();
    }, [loadData, router]);

    const openComposerFromWarRoom = useCallback(async ({ focusFindingId }: { focusFindingId?: string } = {}) => {
        try {
            const token = await getAuthToken();
            let { workingDraftVersion } = resolveWarRoomVersions(versions);

            if (!workingDraftVersion?.id) {
                const firstIssue = issues[0];
                if (!firstIssue) {
                    throw new Error('No working draft is available to edit.');
                }

                await patchIssueStatus(token, firstIssue.id, 'under_review', 'Opening in Composer for manual editing');
                const freshVersions = await refreshVersions(token);
                workingDraftVersion = resolveWarRoomVersions(freshVersions).workingDraftVersion;
            } else {
                const freshVersions = await refreshVersions(token);
                workingDraftVersion = resolveWarRoomVersions(freshVersions).workingDraftVersion || workingDraftVersion;
            }

            if (!workingDraftVersion?.id) {
                throw new Error('No working draft is available to edit.');
            }

            const rawDraftText = workingDraftVersion.raw_text?.trim();
            persistComposerPrefill(rawDraftText ? {
                text: rawDraftText,
                source: 'war_room',
                contractId,
                matterId,
                title: contractTitle || 'War Room Draft',
                versionLabel: 'V3 Working Draft',
            } : null);

            const params = new URLSearchParams({
                mode: 'warroom',
                contract_id: contractId,
                draft_id: workingDraftVersion.id,
                source: 'war_room',
            });
            if (focusFindingId) {
                params.set('focus_finding', focusFindingId);
            }

            const draftingUrl = `/dashboard/drafting/${matterId}?${params.toString()}`;

            toast.success('Opening Smart Composer with V3 Working Draft...');
            router.push(draftingUrl);
        } catch (e: any) {
            toast.error(e.message || 'Failed to open Composer');
        }
    }, [
        contractId,
        contractTitle,
        getAuthToken,
        issues,
        matterId,
        patchIssueStatus,
        persistComposerPrefill,
        refreshVersions,
        router,
        versions,
    ]);

    const handleEditInComposer = useCallback(() => {
        void openComposerFromWarRoom({ focusFindingId: selectedDevId || undefined });
    }, [openComposerFromWarRoom, selectedDevId]);

    const { baselineVersion: v1, counterpartyVersion: v2, workingDraftVersion: v3_working } = useMemo(
        () => resolveWarRoomVersions(versions),
        [versions]
    );

    const effectiveDiffResult = useMemo(() => {
        if (diffResult?.deviations?.length) {
            return diffResult;
        }
        return buildFallbackDiffResult(issues);
    }, [diffResult, issues]);

    const deviations = effectiveDiffResult?.deviations || [];
    const batnaFallbacks = effectiveDiffResult?.batna_fallbacks || [];

    useEffect(() => {
        setSelectedDevId((prev) => deviations.some((deviation) => deviation.deviation_id === prev)
            ? prev
            : (deviations[0]?.deviation_id ?? null));
    }, [deviations]);

    const issuesById = useMemo(() => {
        const map: Record<string, NegotiationIssue> = {};
        for (const issue of issues) {
            // Index under every possible identifier so deviation→issue lookup
            // succeeds regardless of whether the backend rewrote the diff IDs.
            if (issue.id) map[issue.id] = issue;
            if (issue.deviation_id) map[issue.deviation_id] = issue;
            if (issue.finding_id) map[issue.finding_id] = issue;
        }
        return map;
    }, [issues]);

    const issueStatuses = useMemo(() => {
        const map: Record<string, string> = {};
        for (const issue of issues) {
            const status = issue.status || 'open';
            if (issue.id) map[issue.id] = status;
            if (issue.deviation_id) map[issue.deviation_id] = status;
            if (issue.finding_id) map[issue.finding_id] = status;
        }
        return map;
    }, [issues]);

    const allResolved = useMemo(() => {
        if (!issues.length) return false;
        return issues.every((issue) => isIssueFinalizeResolved(issue));
    }, [issues]);

    const unresolvedCritical = useMemo(() => {
        return issues.filter((issue) => !isIssueFinalizeResolved(issue) && issue.severity === 'critical').length;
    }, [issues]);

    const pendingIssueCount = useMemo(() => {
        return issues.filter((issue) => !isIssueFinalizeResolved(issue)).length;
    }, [issues]);

    const unresolvedCount = useMemo(() => {
        return issues.filter((issue) => (issue.status || 'open') === 'open').length;
    }, [issues]);

    const underReviewCount = useMemo(() => {
        return issues.filter((issue) => issue.status === 'under_review' || issue.status === 'escalated').length;
    }, [issues]);

    const resolvedCount = useMemo(() => {
        return issues.filter((issue) => RESOLVED_STATUSES.has(issue.status)).length;
    }, [issues]);

    const resolutionPct = useMemo(() => {
        if (!issues.length) return 0;
        return Math.round((resolvedCount / issues.length) * 100);
    }, [issues, resolvedCount]);

    const sortedDeviations = useMemo(() => {
        if (!deviations.length) return [];
        let sorted = [...deviations];

        // Enhance: filter by severity pills
        // [FILTER REMOVED FOR DEBUGGING]

        // Enhance: filter by status
        // [FILTER REMOVED FOR DEBUGGING]

        sorted.sort((a, b) => {
            const priority = { critical: 0, warning: 1, info: 2 };
            if (priority[a.severity] !== priority[b.severity]) {
                return priority[a.severity] - priority[b.severity];
            }
            return (a.v2_coordinates?.start_char || 0) - (b.v2_coordinates?.start_char || 0);
        });
        return sorted;
    }, [deviations, issueStatuses, severityFilters, statusFilter]);
    const structuralChangeDeviationIds = useMemo(() => new Set(
        deviations
            .filter((deviation) => deviation.category === 'Modified')
            .filter((deviation) => isStructuralChangeDetected(deviation.v1_text, deviation.v2_text))
            .map((deviation) => deviation.deviation_id)
    ), [deviations]);

    const selectedDev = sortedDeviations.find(d => d.deviation_id === selectedDevId) || sortedDeviations[0];
    const selectedIssue = selectedDev ? issuesById[selectedDev.deviation_id] || null : null;
    const selectedIssueStatus = selectedIssue?.status || 'open';
    const selectedIssueAuditLog = selectedIssue?.reasoning_log || [];
    const isSelectedIssuePending = pendingDecision?.issueId === selectedIssue?.id;
    const isSelectedIssueLocked = selectedIssue ? (TERMINAL_STATUSES.has(selectedIssue.status) || selectedIssue.status === 'escalated') : false;
    const selectedBATNA = batnaFallbacks.find(b => b.deviation_id === selectedDevId);
    const selectedDebate = selectedDev
        ? (effectiveDiffResult?.debate_protocol?.debate_results?.find(d => d.deviation_id === selectedDev.deviation_id) || null)
        : null;

    const buildRelatedLawsCoverageNote = (payload: LawSearchResponse): string | null => {
        const explicitNote = payload.corpus_status?.query_coverage_note?.trim();
        if (explicitNote) {
            return explicitNote;
        }

        const categoryCoverage = Object.values(payload.corpus_status?.category_coverage || {}) as Array<Record<string, unknown>>;
        const activeCoverage = categoryCoverage.filter((item) => Number(item?.ingested_laws || 0) > 0);
        if (activeCoverage.length !== 1) {
            return null;
        }

        const row = activeCoverage[0];
        const label = String(row.category_label_en || row.category || 'the current legal category');
        const ingested = Number(row.ingested_laws || 0);
        const planned = Number(row.total_planned_laws || 0) || ingested;

        return `Current regulations corpus only covers ${label} (${ingested} of ${planned} planned law(s) ingested). The selected deviation does not appear to match that coverage yet.`;
    };

    const loadRelatedLaws = async () => {
        if (!selectedDev) {
            toast.error('Select a deviation before loading related regulations.');
            return;
        }

        const query = `${selectedDev.v2_text?.slice(0, 150) || ''} ${selectedDev.impact_analysis?.slice(0, 150) || ''}`.trim();
        if (!query) {
            toast.error('No deviation context is available for a regulation lookup.');
            return;
        }

        setShowRelatedLawsPanel(true);
        setIsLoadingRelatedLaws(true);
        setRelatedLawsError(null);
        setRelatedLawsCoverageNote(null);
        const result = await searchLaws(
            query,
            { contract_relevance: 'high' },
            undefined,
            3,
            {
                source_type: 'war_room_deviation',
                title: selectedDev.title || null,
                impact_analysis: selectedDev.impact_analysis || null,
                v1_text: selectedDev.v1_text || null,
                v2_text: selectedDev.v2_text || null,
                severity: selectedDev.severity || null,
                playbook_violation: selectedDev.playbook_violation || null,
            },
        );
        setIsLoadingRelatedLaws(false);

        if (!result.success || !result.data) {
            setRelatedLawResults([]);
            setRelatedLawsError(result.error || 'Unable to load related regulations.');
            return;
        }

        const payload = result.data as LawSearchResponse;
        setRelatedLawsCoverageNote(buildRelatedLawsCoverageNote(payload));
        setRelatedLawResults(payload.results || []);
    };

    // ── Derived state that MUST be above early returns (hooks cannot be conditional) ──
    const v1Score = v1?.risk_score || 0;
    const v2Score = v3_working?.risk_score || v2?.risk_score || 0;

    const criticalCount = deviations.filter(d => d.severity === 'critical').length;
    const warningCount = deviations.filter(d => d.severity === 'warning').length;

    const roundSummary = useMemo(() => ({
        totalChanges: sortedDeviations.length,
        highRiskCount: sortedDeviations.filter(d => d.severity === 'critical').length,
        pendingCount: issues.filter(i => ['open', 'under_review'].includes(i.status)).length,
        acceptedCount: issues.filter(i => i.status === 'accepted').length,
        conflictCount: issues.filter(i => i.status === 'escalated').length,
    }), [sortedDeviations, issues]);

    const v2Version = versions.find(v => v.version_number === 2) ?? versions[versions.length - 1];
    const pendingCount = roundSummary.pendingCount;
    const nextVersionNumber = useMemo(() => {
        if (!versions.length) return 1;
        return Math.max(...versions.map((version) => version.version_number || 0)) + 1;
    }, [versions]);

    // ── Early returns (safe — all hooks are above) ──
    if (isLoading) {
        return (
            <WarRoomStateScreen variant="loading" />
        );
    }

    if (realtimeError) {
        return (
            <WarRoomStateScreen
                variant="error"
                realtimeError={realtimeError}
                onRetry={() => { void loadData(); }}
                onReturn={() => router.push(`/dashboard/contracts/${contractId}`)}
            />
        );
    }

    if (!effectiveDiffResult) {
        return (
            <WarRoomStateScreen
                variant={waitingForRealtime ? "waiting" : "empty"}
                loadingStage={loadingStage}
                waitingForRealtime={waitingForRealtime}
                isSSEConnected={isSSEConnected}
                isFallbackPolling={isFallbackPolling}
            />
        );
    }
    // Derive V1 file URL by replacing the V2 safe name in the storage path with the V1 safe name
    const v2SafeName = v2Version?.uploaded_filename?.replace(/[^a-zA-Z0-9.-]/g, '_');
    const v1SafeName = v1?.uploaded_filename?.replace(/[^a-zA-Z0-9.-]/g, '_');
    let v1FileUrl: string | undefined = undefined;
    if (fileUrl && v2SafeName && v1SafeName && fileUrl.endsWith(v2SafeName)) {
        v1FileUrl = fileUrl.substring(0, fileUrl.length - v2SafeName.length) + v1SafeName;
    } else if (fileUrl && v1SafeName) {
        // Fallback: extract the directory and reconstruct with contractId prefix
        const dirPath = fileUrl.substring(0, fileUrl.lastIndexOf('/') + 1);
        v1FileUrl = `${dirPath}${contractId.substring(0, 8)}_${v1SafeName}`;
    }

    return (
        <div className="flex flex-col h-screen bg-[#0A0A0F] text-zinc-100 overflow-hidden">
            {/* Header */}
            <WarRoomHeader
                contractTitle={contractTitle || 'Untitled Contract'}
                documentTitle={v2Version?.uploaded_filename?.split('/').pop() || contractTitle || 'Contract Document'}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onBack={() => router.push(`/dashboard/contracts/${contractId}`)}
                allResolved={allResolved}
                pendingIssueCount={pendingIssueCount}
                onFinalizeClick={() => setIsFinalizeRoundModalOpen(true)}
                onEditMode={() => openComposerFromWarRoom()}
            />

            {/* 3-column body */}
            <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Left sidebar — fixed 280px */}
                <LeftSidebar
                    contractId={contractId}
                    matterId={matterId}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    v3Working={v3_working}
                    allResolved={allResolved}
                    unresolvedCritical={unresolvedCritical}
                    pendingIssueCount={pendingIssueCount}
                    onVersionUploaded={handleVersionUploaded}
                    onAfterFinalize={loadData}
                    sortedDeviations={sortedDeviations}
                    selectedDevId={selectedDevId}
                    onSelectDeviation={setSelectedDevId}
                    issueStatuses={issueStatuses}
                    severityFilters={severityFilters}
                    setSeverityFilters={setSeverityFilters}
                    statusFilter={statusFilter}
                    setStatusFilter={setStatusFilter}
                    criticalCount={criticalCount}
                    warningCount={warningCount}
                    unresolvedCount={unresolvedCount}
                    underReviewCount={underReviewCount}
                    resolvedCount={resolvedCount}
                    roundSummary={roundSummary}
                    resolutionPct={resolutionPct}
                    acceptedCount={roundSummary.acceptedCount}
                    pendingCount={roundSummary.pendingCount}
                    conflictCount={roundSummary.conflictCount}
                />

                {/* Center — flex-1 */}
                <main className="flex-1 flex flex-col overflow-hidden bg-[#0A0A0F] min-w-0">
                    <WarRoomCenterPanel
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        v1RawText={v1?.raw_text}
                        v2RawText={v2?.raw_text}
                        deviations={sortedDeviations}
                        selectedDeviationId={selectedDevId}
                        onDeviationSelect={setSelectedDevId}
                        issueStatuses={issueStatuses}
                        batnaFallbacks={batnaFallbacks}
                        severityFilters={severityFilters}
                        statusFilter={statusFilter}
                        versions={versions}
                        pendingCount={pendingCount}
                        contractTitle={contractTitle}
                    />
                </main>

                {/* Right panel — fixed 380px */}
                <aside className="w-[380px] flex-shrink-0 flex flex-col overflow-hidden border-l border-zinc-800/60 min-h-0">
                    {showClauseAssistant ? (
                        <div className="flex flex-col h-full bg-[#0D0D14] overflow-hidden">
                            {/* Header with back button */}
                            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60 flex-shrink-0">
                                <button
                                    onClick={() => setShowClauseAssistant(false)}
                                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                                    Back to Analysis
                                </button>
                                <span className="ml-auto text-xs font-medium text-zinc-500">Clause Assistant</span>
                            </div>
                            
                            {/* ClauseAssistant fills remaining height */}
                            <div className="flex-1 overflow-y-auto min-h-0">
                                <ClauseAssistant
                                    key={selectedDevId || 'default'}
                                    contractId={contractId}
                                    matterId={matterId}
                                    context={selectedDev ? {
                                        deviationId: selectedDev.deviation_id,
                                        title: selectedDev.title,
                                        v1Text: selectedDev.v1_text,
                                        v2Text: selectedDev.v2_text,
                                        impactAnalysis: selectedDev.impact_analysis,
                                        severity: selectedDev.severity,
                                        playbookViolation: selectedDev.playbook_violation,
                                    } : undefined}
                                />
                            </div>
                        </div>
                    ) : (
                        <DeviationAssistantPanel
                            contractId={contractId}
                            matterId={matterId}
                            selectedDev={selectedDev}
                            selectedIssue={selectedIssue || null}
                            selectedBATNA={selectedBATNA}
                            selectedDebate={selectedDebate}
                            enableDebate={enableDebate}
                            isSelectedIssuePending={isSelectedIssuePending}
                            isSelectedIssueLocked={isSelectedIssueLocked}
                            selectedIssueStatus={selectedIssueStatus}
                            selectedIssueAuditLog={selectedIssueAuditLog}
                            onAccept={() => void handleDecision(
                                selectedIssue!.id,
                                'accepted',
                                'Accepted in War Room',
                                'Accepted',
                                'Deviation moved to accepted.'
                            )}
                            onReject={() => void handleDecision(
                                selectedIssue!.id,
                                'rejected',
                                'Rejected in War Room',
                                'Rejected',
                                'Deviation moved to rejected.'
                            )}
                            onCounter={() => void handleDecision(
                                selectedIssue!.id,
                                'countered',
                                'Countered with BATNA fallback',
                                'Countered',
                                'BATNA fallback applied to the working draft.'
                            )}
                            onEscalate={() => void handleDecision(
                                selectedIssue!.id,
                                'escalated',
                                'Escalated to internal team for review',
                                'Escalated',
                                'Deviation escalated for internal review.'
                            )}
                            onUndo={() => void handleDecision(
                                selectedIssue!.id,
                                'open',
                                'Reopened in War Room',
                                'Reopened',
                                'Deviation moved back to open.'
                            )}
                            onEditInComposer={handleEditInComposer}
                            onShowRelatedLaws={() => void loadRelatedLaws()}
                            onOpenClauseAssistant={() => setShowClauseAssistant(true)}
                        />
                    )}
                </aside>
            </div>


            <RelatedLawsPanel
                open={showRelatedLawsPanel}
                results={relatedLawResults}
                loading={isLoadingRelatedLaws}
                error={relatedLawsError}
                coverageNote={relatedLawsCoverageNote}
                onClose={() => setShowRelatedLawsPanel(false)}
                onOpenNodeDetail={(nodeId) => openNodeDetail(nodeId)}
            />

            <FinalizeRoundButton
                contractId={contractId}
                contractStatus={contractStatus}
                allResolved={allResolved}
                pendingIssueCount={pendingIssueCount}
                nextVersionNumber={nextVersionNumber}
                externalOpen={isFinalizeRoundModalOpen}
                onExternalOpenChange={setIsFinalizeRoundModalOpen}
                hideTrigger
            />
        </div>
    );
}
