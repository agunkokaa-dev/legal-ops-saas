'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { uploadDocument } from '@/app/actions/documentActions';
import ReactMarkdown from 'react-markdown';
import WordDiff from './WordDiff';
import DebatePanel from './DebatePanel';
import { useContractSSE } from '@/hooks/useContractSSE';
import { SSEStatusBadge } from '@/components/status/SSEStatusBadge';
import { getPublicApiBase } from '@/lib/public-api-base';
import CounselChat from './CounselChat';

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
    pre_debate_severity?: string;
    debate_verdict?: DebateVerdict;
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

type DebatePerspective = "client_advocate" | "counterparty_advocate" | "neutral_arbiter";

interface DebateArgument {
    perspective: DebatePerspective;
    position: "upgrade_severity" | "downgrade_severity" | "maintain_severity";
    recommended_severity: "critical" | "warning" | "info";
    reasoning: string;
    key_points: string[];
    legal_basis?: string | null;
    risk_quantification?: string | null;
    confidence: number;
}

interface DebateVerdict {
    original_severity: string;
    final_severity: string;
    severity_changed: boolean;
    consensus_level: "unanimous" | "majority" | "split";
    verdict_reasoning: string;
    adjusted_impact_analysis: string;
    adjusted_batna?: string | null;
    confidence_score: number;
}

interface DeviationDebateResult {
    deviation_id: string;
    debate_triggered: boolean;
    arguments: DebateArgument[];
    verdict?: DebateVerdict | null;
    debate_duration_ms: number;
    tokens_used: number;
}

interface DebateProtocolResult {
    debate_results: DeviationDebateResult[];
    total_deviations: number;
    debated_count: number;
    skipped_count: number;
    severity_changes: number;
    total_duration_ms: number;
    total_tokens_used: number;
    model_versions: Record<string, string>;
}

interface SmartDiffResult {
    deviations: DiffDeviation[];
    batna_fallbacks: BATNAFallback[];
    risk_delta: number;
    summary: string;
    rounds?: Array<unknown>;
    debate_protocol?: DebateProtocolResult | null;
}

interface ContractVersion {
    id: string;
    version_number: number;
    risk_score: number;
    risk_delta: number;
    created_at: string;
    raw_text?: string;
    uploaded_filename?: string | null;
    risk_level?: string;
}

interface NegotiationIssue {
    id: string;
    contract_id: string;
    version_id?: string | null;
    deviation_id?: string | null;
    finding_id?: string | null;
    title: string;
    description?: string | null;
    status: string;
    severity: 'critical' | 'warning' | 'info';
    category?: string | null;
    linked_task_id?: string | null;
    linked_task_status?: string | null;
    reasoning_log?: AuditLogEntry[];
    decided_at?: string | null;
}

const RESOLVED_STATUSES = new Set(['accepted', 'rejected', 'countered', 'resolved']);
const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'countered', 'resolved', 'dismissed']);
type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
    return value && typeof value === 'object' ? value as LooseRecord : null;
}

function readString(record: LooseRecord, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return undefined;
}

function readNumber(record: LooseRecord, ...keys: string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return undefined;
}

function readBoolean(record: LooseRecord, ...keys: string[]): boolean | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'boolean') {
            return value;
        }
    }
    return undefined;
}

function readArray<T = unknown>(record: LooseRecord, ...keys: string[]): T[] {
    for (const key of keys) {
        const value = record[key];
        if (Array.isArray(value)) {
            return value as T[];
        }
    }
    return [];
}

function normalizeVersion(input: unknown): ContractVersion | null {
    const record = asRecord(input);
    if (!record) return null;

    const id = readString(record, 'id');
    if (!id) return null;

    return {
        id,
        version_number: readNumber(record, 'version_number', 'versionNumber') ?? 0,
        risk_score: readNumber(record, 'risk_score', 'riskScore') ?? 0,
        risk_delta: readNumber(record, 'risk_delta', 'riskDelta') ?? 0,
        created_at: readString(record, 'created_at', 'createdAt') || '',
        raw_text: readString(record, 'raw_text', 'rawText'),
        uploaded_filename: readString(record, 'uploaded_filename', 'uploadedFilename') || null,
        risk_level: readString(record, 'risk_level', 'riskLevel'),
    };
}

function normalizeSeverity(value: unknown): 'critical' | 'warning' | 'info' {
    const normalized = typeof value === 'string' ? value.toLowerCase() : '';
    if (normalized === 'critical' || normalized === 'warning') {
        return normalized;
    }
    return 'info';
}

function normalizeStatus(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.toLowerCase() : 'open';
}

function normalizeDeviation(input: unknown): DiffDeviation | null {
    const record = asRecord(input);
    if (!record) return null;

    const deviationId = readString(record, 'deviation_id', 'deviationId', 'id', 'finding_id', 'findingId');
    if (!deviationId) return null;

    const coordsRecord = asRecord(record.v2_coordinates ?? record.v2Coordinates);
    const v2Coordinates = coordsRecord ? {
        start_char: readNumber(coordsRecord, 'start_char', 'startChar') ?? 0,
        end_char: readNumber(coordsRecord, 'end_char', 'endChar') ?? 0,
        source_text: readString(coordsRecord, 'source_text', 'sourceText') || '',
    } : undefined;

    const debateVerdictRecord = asRecord(record.debate_verdict ?? record.debateVerdict);
    const debateVerdict = debateVerdictRecord ? {
        original_severity: readString(debateVerdictRecord, 'original_severity', 'originalSeverity') || '',
        final_severity: readString(debateVerdictRecord, 'final_severity', 'finalSeverity') || normalizeSeverity(record.severity),
        severity_changed: readBoolean(debateVerdictRecord, 'severity_changed', 'severityChanged') ?? false,
        consensus_level: (readString(debateVerdictRecord, 'consensus_level', 'consensusLevel') || 'split') as DebateVerdict['consensus_level'],
        verdict_reasoning: readString(debateVerdictRecord, 'verdict_reasoning', 'verdictReasoning') || '',
        adjusted_impact_analysis: readString(debateVerdictRecord, 'adjusted_impact_analysis', 'adjustedImpactAnalysis') || '',
        adjusted_batna: readString(debateVerdictRecord, 'adjusted_batna', 'adjustedBatna') || null,
        confidence_score: readNumber(debateVerdictRecord, 'confidence_score', 'confidenceScore') ?? 0,
    } : undefined;

    return {
        deviation_id: deviationId,
        title: readString(record, 'title') || readString(record, 'name') || 'Untitled Deviation',
        category: readString(record, 'category') || 'Negotiation',
        severity: normalizeSeverity(record.severity),
        v1_text: readString(record, 'v1_text', 'v1Text', 'original_text', 'originalText') || '',
        v2_text: readString(record, 'v2_text', 'v2Text', 'updated_text', 'updatedText', 'description') || '',
        v2_coordinates: v2Coordinates,
        impact_analysis: readString(record, 'impact_analysis', 'impactAnalysis', 'description') || '',
        playbook_violation: readString(record, 'playbook_violation', 'playbookViolation'),
        counterparty_intent: readString(record, 'counterparty_intent', 'counterpartyIntent'),
        pre_debate_severity: readString(record, 'pre_debate_severity', 'preDebateSeverity'),
        debate_verdict: debateVerdict,
    };
}

function normalizeBATNA(input: unknown): BATNAFallback | null {
    const record = asRecord(input);
    if (!record) return null;

    const deviationId = readString(record, 'deviation_id', 'deviationId', 'id');
    if (!deviationId) return null;

    return {
        deviation_id: deviationId,
        fallback_clause: readString(record, 'fallback_clause', 'fallbackClause') || '',
        reasoning: readString(record, 'reasoning') || '',
        leverage_points: readArray<string>(record, 'leverage_points', 'leveragePoints').filter((value): value is string => typeof value === 'string'),
    };
}

function normalizeDebateResult(input: unknown): DeviationDebateResult | null {
    const record = asRecord(input);
    if (!record) return null;

    const deviationId = readString(record, 'deviation_id', 'deviationId', 'id');
    if (!deviationId) return null;
    const verdictRecord = asRecord(record.verdict);
    const verdict = verdictRecord ? {
        original_severity: readString(verdictRecord, 'original_severity', 'originalSeverity') || '',
        final_severity: readString(verdictRecord, 'final_severity', 'finalSeverity') || 'info',
        severity_changed: readBoolean(verdictRecord, 'severity_changed', 'severityChanged') ?? false,
        consensus_level: (readString(verdictRecord, 'consensus_level', 'consensusLevel') || 'split') as DebateVerdict['consensus_level'],
        verdict_reasoning: readString(verdictRecord, 'verdict_reasoning', 'verdictReasoning') || '',
        adjusted_impact_analysis: readString(verdictRecord, 'adjusted_impact_analysis', 'adjustedImpactAnalysis') || '',
        adjusted_batna: readString(verdictRecord, 'adjusted_batna', 'adjustedBatna') || null,
        confidence_score: readNumber(verdictRecord, 'confidence_score', 'confidenceScore') ?? 0,
    } : undefined;

    return {
        deviation_id: deviationId,
        debate_triggered: readBoolean(record, 'debate_triggered', 'debateTriggered') ?? false,
        arguments: readArray<DebateArgument>(record, 'arguments'),
        verdict,
        debate_duration_ms: readNumber(record, 'debate_duration_ms', 'debateDurationMs') ?? 0,
        tokens_used: readNumber(record, 'tokens_used', 'tokensUsed') ?? 0,
    };
}

function normalizeDiffResult(input: unknown): SmartDiffResult | null {
    const baseRecord = asRecord(input);
    const record = asRecord(baseRecord?.diff_result ?? baseRecord?.diffResult ?? baseRecord?.data) || baseRecord;
    if (!record) return null;

    const deviations = readArray(record, 'deviations', 'findings')
        .map(normalizeDeviation)
        .filter((item): item is DiffDeviation => Boolean(item));

    const batnaFallbacks = readArray(record, 'batna_fallbacks', 'batnaFallbacks')
        .map(normalizeBATNA)
        .filter((item): item is BATNAFallback => Boolean(item));

    const debateProtocolRecord = asRecord(record.debate_protocol ?? record.debateProtocol);
    const modelVersionsRecord = asRecord(debateProtocolRecord?.model_versions ?? debateProtocolRecord?.modelVersions);

    return {
        deviations,
        batna_fallbacks: batnaFallbacks,
        risk_delta: readNumber(record, 'risk_delta', 'riskDelta') ?? 0,
        summary: readString(record, 'summary') || '',
        rounds: readArray(record, 'rounds'),
        debate_protocol: debateProtocolRecord ? {
            debate_results: readArray(debateProtocolRecord, 'debate_results', 'debateResults')
                .map(normalizeDebateResult)
                .filter((item): item is DeviationDebateResult => Boolean(item)),
            total_deviations: readNumber(debateProtocolRecord, 'total_deviations', 'totalDeviations') ?? deviations.length,
            debated_count: readNumber(debateProtocolRecord, 'debated_count', 'debatedCount') ?? 0,
            skipped_count: readNumber(debateProtocolRecord, 'skipped_count', 'skippedCount') ?? 0,
            severity_changes: readNumber(debateProtocolRecord, 'severity_changes', 'severityChanges') ?? 0,
            total_duration_ms: readNumber(debateProtocolRecord, 'total_duration_ms', 'totalDurationMs') ?? 0,
            total_tokens_used: readNumber(debateProtocolRecord, 'total_tokens_used', 'totalTokensUsed') ?? 0,
            model_versions: modelVersionsRecord ? Object.fromEntries(
                Object.entries(modelVersionsRecord).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            ) : {},
        } : null,
    };
}

function buildFallbackDiffResult(issues: NegotiationIssue[]): SmartDiffResult | null {
    if (!issues.length) return null;

    return {
        deviations: issues.map((issue) => ({
            deviation_id: issue.deviation_id || issue.id,
            title: issue.title || 'Untitled Issue',
            category: issue.category || 'Negotiation',
            severity: normalizeSeverity(issue.severity),
            v1_text: '',
            v2_text: issue.description || issue.title || '',
            impact_analysis: issue.description || '',
        })),
        batna_fallbacks: [],
        risk_delta: 0,
        summary: 'Issue records loaded while Smart Diff content is still pending.',
        rounds: [],
        debate_protocol: null,
    };
}

function isWorkingDraftVersion(version: ContractVersion): boolean {
    return /working[_ -]?draft/i.test(version.uploaded_filename || '');
}

function resolveWarRoomVersions(versionList: ContractVersion[]) {
    const sorted = [...versionList].sort((a, b) => a.version_number - b.version_number);
    const diffVersions = sorted.filter((version) => !isWorkingDraftVersion(version));
    const workingDraftVersions = sorted.filter(isWorkingDraftVersion);

    return {
        baselineVersion: diffVersions.length > 1 ? diffVersions[diffVersions.length - 2] : diffVersions[0] || null,
        counterpartyVersion: diffVersions[diffVersions.length - 1] || null,
        workingDraftVersion: workingDraftVersions[workingDraftVersions.length - 1] || null,
    };
}

function isIssueFinalizeResolved(issue: NegotiationIssue): boolean {
    return TERMINAL_STATUSES.has(issue.status) || (issue.status === 'escalated' && issue.linked_task_status === 'done');
}

function replaceLastAuditEntry(entries: AuditLogEntry[] | undefined, nextEntry: AuditLogEntry): AuditLogEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [nextEntry];
    }
    return [...entries.slice(0, -1), nextEntry];
}

function normalizeIssue(issue: unknown): NegotiationIssue | null {
    const rawIssue = asRecord(issue);
    if (!rawIssue) return null;

    const reasoningLog = rawIssue.reasoning_log ?? rawIssue.reasoningLog;
    const id = readString(rawIssue, 'id');
    if (!id) return null;

    return {
        ...(rawIssue as Partial<NegotiationIssue>),
        id,
        contract_id: readString(rawIssue, 'contract_id', 'contractId') || '',
        version_id: readString(rawIssue, 'version_id', 'versionId') || null,
        finding_id: readString(rawIssue, 'finding_id', 'findingId') || null,
        deviation_id: readString(rawIssue, 'deviation_id', 'deviationId', 'finding_id', 'findingId', 'id') || id,
        title: readString(rawIssue, 'title') || 'Untitled Issue',
        description: readString(rawIssue, 'description', 'impact_analysis', 'impactAnalysis') || null,
        status: normalizeStatus(rawIssue.status),
        severity: normalizeSeverity(rawIssue.severity),
        category: readString(rawIssue, 'category') || null,
        linked_task_id: readString(rawIssue, 'linked_task_id', 'linkedTaskId') || null,
        linked_task_status: readString(rawIssue, 'linked_task_status', 'linkedTaskStatus') || null,
        decided_at: readString(rawIssue, 'decided_at', 'decidedAt') || null,
        reasoning_log: Array.isArray(reasoningLog) ? reasoningLog as AuditLogEntry[] : [],
    };
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

    // Toggles central view between the Smart Diff (V2) vs the Baseline text (V1)
    const [viewMode, setViewMode] = useState<'v1' | 'v2' | 'v3'>('v2');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);

    // ── STATUS MANAGEMENT STATE ──
    const [issues, setIssues] = useState<NegotiationIssue[]>([]);
    const [pendingDecision, setPendingDecision] = useState<{ issueId: string; status: string } | null>(null);
    const [isFinalizing, setIsFinalizing] = useState(false);

    // ── FILTERS ──
    const [severityFilters, setSeverityFilters] = useState<Record<string, boolean>>({});
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    const [waitingForRealtime, setWaitingForRealtime] = useState(false);
    const [realtimeError, setRealtimeError] = useState<string | null>(null);
    const [enableDebate, setEnableDebate] = useState(false);

    const [counselOpen, setCounselOpen] = useState(false);
    const [counselSessionType, setCounselSessionType] = useState<"deviation" | "general_strategy">("deviation");
    const [counselDeviationId, setCounselDeviationId] = useState<string | null>(null);

    const openCounselChat = (type: "deviation" | "general_strategy", devId?: string) => {
        setCounselSessionType(type);
        setCounselDeviationId(devId || null);
        setCounselOpen(true);
    };

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

    // ── EDIT IN COMPOSER: Ensure V3 draft exists, then redirect to Drafting page ──
    const handleEditInComposer = useCallback(async () => {
        try {
            const token = await getAuthToken();
            const { workingDraftVersion } = resolveWarRoomVersions(versions);

            // 1. Check if V3 working draft already exists (derive from versions state)
            let targetVersionId: string | null = workingDraftVersion?.id || null;

            if (!targetVersionId) {
                // 2. Trigger a lightweight status patch to force V3 creation
                const firstIssue = issues[0];
                if (firstIssue) {
                    await patchIssueStatus(token, firstIssue.id, 'under_review', 'Opening in Composer for manual editing');
                }

                // 3. Re-fetch versions to get the newly created V3 id
                const freshVersions = await refreshVersions(token);
                targetVersionId = resolveWarRoomVersions(freshVersions).workingDraftVersion?.id || null;
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
    }, [contractId, getToken, issues, patchIssueStatus, refreshVersions, router, versions]);

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

    const handleFinalizeForSigning = async () => {
        setIsFinalizing(true);
        try {
            const token = await getAuthToken();
            const res = await fetch(buildNegotiationApiUrl('finalize-for-signing'), {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to finalize contract');

            if (data.ready) {
                toast.success('Contract finalized. Proceeding to signing preparation.');
                router.push(`/dashboard/contracts/${contractId}/signing`);
                return;
            }

            toast.error(data.reason || 'Cannot finalize yet.');
            await loadData();
        } catch (error: any) {
            toast.error(error.message || 'Failed to finalize contract');
        } finally {
            setIsFinalizing(false);
        }
    };

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

    if (realtimeError) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] h-[calc(100vh-70px)]">
                <div className="bg-[#111] border border-rose-900/50 p-8 rounded-2xl shadow-[0_0_30px_rgba(225,29,72,0.1)] flex flex-col items-center max-w-md text-center">
                    <span className="text-4xl mb-4">❌</span>
                    <h3 className="text-rose-400 font-serif font-bold text-lg mb-3 tracking-wide">AI Processing Failed</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                        {realtimeError}
                    </p>
                    <div className="flex gap-4">
                        <button onClick={() => { void loadData(); }} className="bg-rose-900/20 hover:bg-rose-900/40 text-rose-300 border border-rose-900/50 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                            Try Again
                        </button>
                        <button onClick={() => router.push(`/dashboard/contracts/${contractId}`)} className="text-zinc-500 hover:text-zinc-300 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                            Return to Workspace
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!effectiveDiffResult) {
        return (
            <div className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] text-[#e5e2e1] overflow-hidden">
                {/* Skeleton Header */}
                <section className="w-full h-14 bg-[#0a0a0a] border-b border-zinc-800/60 flex items-center justify-between px-8 shrink-0">
                    <div className="flex items-center gap-4">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">Negotiation War Room</p>
                            <p className="text-xs text-zinc-400 mt-1">{loadingStage}</p>
                        </div>
                    </div>
                    <SSEStatusBadge isConnected={isSSEConnected} isFallbackPolling={isFallbackPolling} />
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
                                <h3 className="font-serif text-[#D4AF37] text-lg tracking-wide animate-pulse">{waitingForRealtime ? 'Waiting for live updates...' : 'AI Co-Counsel is finalizing the War Room Diff...'}</h3>
                            </div>
                            <p className="text-xs text-zinc-500 uppercase tracking-widest max-w-sm text-center">{loadingStage}</p>
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

    const v1Score = v1?.risk_score || 0;
    const v2Score = v3_working?.risk_score || v2?.risk_score || 0;

    const criticalCount = deviations.filter(d => d.severity === 'critical').length;
    const warningCount = deviations.filter(d => d.severity === 'warning').length;

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

    const renderV2WithContextualDeviations = () => {
        if (!v2?.raw_text) return <p className="text-zinc-500 italic">No raw text available for V2.</p>;

        const deviationsWithCoords = deviations.filter(d => d.v2_coordinates);
        const unmappedDeviations = deviations.filter(d => !d.v2_coordinates);

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
                        const isSelected = selectedDevId === dev.deviation_id;

                        let severityColorHex = dev.severity === 'critical' ? '#EF4444' : dev.severity === 'warning' ? '#F59E0B' : '#3B82F6';
                        let borderColor = severityColorHex;
                        let bgColor = `${severityColorHex}10`;

                        if (dev.category === 'Added') {
                            borderColor = '#10B981';
                            bgColor = '#10B98110';
                        } else if (dev.category === 'Unchanged-Risk') {
                            borderColor = '#8B5CF6';
                            bgColor = '#8B5CF610';
                        }

                        // Removed ones go here, let's style them with red if not handled
                        if (dev.category === 'Removed') {
                            borderColor = '#EF4444';
                            bgColor = '#EF444410';
                        }

                        const severityIcon = dev.category === 'Added' ? '🟢' : dev.severity === 'critical' ? '🔴' : dev.severity === 'warning' ? '🟡' : '🔵';
                        const dStatus = viewMode === 'v3' ? issueStatuses[dev.deviation_id] : null;

                        return (
                            <div
                                key={`dev-${dev.deviation_id}`}
                                id={`dev-${dev.deviation_id}`}
                                onClick={(e) => { e.stopPropagation(); setSelectedDevId(dev.deviation_id); }}
                                className={`deviation-block transition-all duration-300 ${isSelected ? `ring-2 ring-opacity-50 pulse-ring shadow-md scale-[1.01] z-10` : 'opacity-80 hover:opacity-100'} ${(!isSelected && Object.values(severityFilters).some(v => v) && !severityFilters[dev.severity]) ||
                                        (!isSelected && statusFilter === 'unresolved' && RESOLVED_STATUSES.has(issueStatuses[dev.deviation_id] || 'open')) ||
                                        (!isSelected && statusFilter && statusFilter !== 'unresolved' && issueStatuses[dev.deviation_id] !== statusFilter)
                                        ? 'opacity-30 grayscale' : ''
                                    }`}
                                style={{
                                    borderLeft: `4px solid ${borderColor}`,
                                    backgroundColor: bgColor,
                                    padding: '16px 20px',
                                    margin: '12px 0',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    ...(isSelected ? { boxShadow: `0 0 0 2px ${borderColor}50` } : {})
                                }}
                            >
                                {/* Deviation Header */}
                                <div className="deviation-header flex justify-between items-center mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[12px]">{severityIcon}</span>
                                        <span className="deviation-title text-zinc-100 font-semibold text-[13px]">{dev.title}</span>
                                    </div>
                                    <span className="category-badge uppercase tracking-widest" style={{
                                        padding: '3px 10px',
                                        borderRadius: '12px',
                                        fontSize: '9px',
                                        fontWeight: 700,
                                        backgroundColor: borderColor,
                                        color: '#fff'
                                    }}>
                                        {dev.category}
                                    </span>
                                </div>

                                {dev.category === 'Removed' ? (
                                    <div className="mt-2 text-[13px] text-zinc-400">
                                        <p className="italic mb-2">This clause was removed from the document.</p>
                                        <p className="line-through decoration-rose-500/50">{dev.v1_text}</p>
                                    </div>
                                ) : (
                                    <div className="mt-2">
                                        {(() => {
                                            if (dStatus === 'accepted') {
                                                return (
                                                    <div className="bg-emerald-900/20 border border-emerald-500/30 p-3 rounded-md mt-2">
                                                        <div className="text-[10px] font-bold text-emerald-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                                            <span className="material-symbols-outlined text-[14px]">check_circle</span> Accepted (V2 Merged)
                                                        </div>
                                                        <p className="font-sans text-[13px] text-emerald-300 italic">{dev.v2_text}</p>
                                                    </div>
                                                );
                                            } else if (dStatus === 'rejected') {
                                                return (
                                                    <div className="bg-rose-900/20 border border-rose-500/30 p-3 rounded-md mt-2">
                                                        <div className="text-[10px] font-bold text-rose-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                                            <span className="material-symbols-outlined text-[14px]">cancel</span> Rejected (Reverted to V1)
                                                        </div>
                                                        <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-rose-500/50 mb-2">{dev.v2_text}</p>
                                                        <p className="font-sans text-[13px] text-rose-300">{dev.v1_text || 'Removed Clause'}</p>
                                                    </div>
                                                );
                                            } else if (dStatus === 'countered') {
                                                const resolvedBatna = batnaFallbacks.find(b => b.deviation_id === dev.deviation_id);
                                                return (
                                                    <div className="bg-amber-900/20 border border-amber-500/30 p-3 rounded-md mt-2">
                                                        <div className="text-[10px] font-bold text-amber-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                                            <span className="material-symbols-outlined text-[14px]">reply</span> Countered (BATNA Inserted)
                                                        </div>
                                                        <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-amber-500/50 mb-2">{dev.v2_text}</p>
                                                        <p className="font-sans text-[13px] text-amber-300 font-medium">{resolvedBatna?.fallback_clause || dev.v1_text}</p>
                                                    </div>
                                                );
                                            } else if (dStatus === 'escalated') {
                                                return (
                                                    <div className="bg-purple-900/20 border border-purple-500/30 p-3 rounded-md mt-2">
                                                        <div className="text-[10px] font-bold text-purple-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                                            <span className="material-symbols-outlined text-[14px]">link</span> Escalated to Task
                                                        </div>
                                                        <p className="font-sans text-[13px] text-purple-200">{dev.v2_text}</p>
                                                    </div>
                                                );
                                            }

                                            // Default State (v2 or v3 Unresolved)
                                            return (
                                                <div>
                                                    {dev.category === 'Modified' ? (
                                                        <div className="bg-[#111] p-3 rounded border border-zinc-800">
                                                            <span className="text-[9px] uppercase tracking-widest text-zinc-500 block mb-2 font-bold">Word-Level Diff</span>
                                                            <WordDiff oldText={dev.v1_text} newText={dev.v2_text} />
                                                        </div>
                                                    ) : (
                                                        <div className="deviation-text font-sans text-[14px] leading-[1.6] text-zinc-200">
                                                            {dev.v2_text}
                                                        </div>
                                                    )}

                                                    {viewMode === 'v3' && (!dStatus || dStatus === 'open' || dStatus === 'under_review') && (
                                                        <div className="status-indicator mt-3 text-[10px] uppercase font-bold tracking-widest text-zinc-500 flex items-center gap-1">
                                                            <span className="material-symbols-outlined text-[14px]">hourglass_empty</span> ⏳ Pending Decision
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
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

            let severityColorHex = dev.severity === 'critical' ? '#EF4444' : dev.severity === 'warning' ? '#F59E0B' : '#3B82F6';
            let borderColor = severityColorHex;
            let bgColor = `${severityColorHex}10`;

            if (dev.category === 'Added') {
                borderColor = '#10B981';
                bgColor = '#10B98110';
            } else if (dev.category === 'Unchanged-Risk') {
                borderColor = '#8B5CF6';
                bgColor = '#8B5CF610';
            }

            const severityIcon = dev.category === 'Added' ? '🟢' : dev.severity === 'critical' ? '🔴' : dev.severity === 'warning' ? '🟡' : '🔵';

            const dStatus = viewMode === 'v3' ? issueStatuses[dev.deviation_id] : null;

            // Contextual Deviation Box
            elements.push(
                <div
                    key={`dev-${dev.deviation_id}`}
                    id={`dev-${dev.deviation_id}`}
                    onClick={(e) => { e.stopPropagation(); setSelectedDevId(dev.deviation_id); }}
                    className={`deviation-block transition-all duration-300 ${isSelected ? `ring-2 ring-opacity-50 pulse-ring shadow-lg scale-[1.01] z-10` : 'opacity-80 hover:opacity-100'} ${(!isSelected && Object.values(severityFilters).some(v => v) && !severityFilters[dev.severity]) ||
                            (!isSelected && statusFilter === 'unresolved' && RESOLVED_STATUSES.has(issueStatuses[dev.deviation_id] || 'open')) ||
                            (!isSelected && statusFilter && statusFilter !== 'unresolved' && issueStatuses[dev.deviation_id] !== statusFilter)
                            ? 'opacity-30 grayscale' : ''
                        }`}
                    style={{
                        borderLeft: `4px solid ${borderColor}`,
                        backgroundColor: bgColor,
                        padding: '16px 20px',
                        margin: '16px 0',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        ...(isSelected ? { boxShadow: `0 0 0 2px ${borderColor}50` } : {})
                    }}
                >
                    {/* Deviation Header */}
                    <div className="deviation-header flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[12px]">{severityIcon}</span>
                            <span className="deviation-title text-zinc-100 font-semibold text-[13px]">{dev.title}</span>
                        </div>
                        <span className="category-badge uppercase tracking-widest" style={{
                            padding: '3px 10px',
                            borderRadius: '12px',
                            fontSize: '9px',
                            fontWeight: 700,
                            backgroundColor: borderColor,
                            color: '#fff'
                        }}>
                            {dev.category}
                        </span>
                    </div>

                    <div className="mt-2">
                        {(() => {
                            if (dStatus === 'accepted') {
                                return (
                                    <div className="bg-emerald-900/20 border border-emerald-500/30 p-3 rounded-md mt-2">
                                        <div className="text-[10px] font-bold text-emerald-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[14px]">check_circle</span> Accepted (V2 Merged)
                                        </div>
                                        <p className="font-sans text-[13px] text-emerald-300 italic">{dev.v2_text}</p>
                                    </div>
                                );
                            } else if (dStatus === 'rejected') {
                                return (
                                    <div className="bg-rose-900/20 border border-rose-500/30 p-3 rounded-md mt-2">
                                        <div className="text-[10px] font-bold text-rose-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[14px]">cancel</span> Rejected (Reverted to V1)
                                        </div>
                                        <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-rose-500/50 mb-2">{dev.v2_text}</p>
                                        <p className="font-sans text-[13px] text-rose-300">{dev.v1_text || 'Removed Clause'}</p>
                                    </div>
                                );
                            } else if (dStatus === 'countered') {
                                const resolvedBatna = batnaFallbacks.find(b => b.deviation_id === dev.deviation_id);
                                return (
                                    <div className="bg-amber-900/20 border border-amber-500/30 p-3 rounded-md mt-2">
                                        <div className="text-[10px] font-bold text-amber-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[14px]">reply</span> Countered (BATNA Inserted)
                                        </div>
                                        <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-amber-500/50 mb-2">{dev.v2_text}</p>
                                        <p className="font-sans text-[13px] text-amber-300 font-medium">{resolvedBatna?.fallback_clause || dev.v1_text}</p>
                                    </div>
                                );
                            } else if (dStatus === 'escalated') {
                                return (
                                    <div className="bg-purple-900/20 border border-purple-500/30 p-3 rounded-md mt-2">
                                        <div className="text-[10px] font-bold text-purple-400 mb-2 tracking-wider uppercase flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[14px]">link</span> Escalated to Task
                                        </div>
                                        <p className="font-sans text-[13px] text-purple-200">{dev.v2_text}</p>
                                    </div>
                                );
                            }

                            // Default State (v2 or v3 Unresolved)
                            return (
                                <div>
                                    {dev.category === 'Modified' ? (
                                        <div className="bg-[#111] p-3 rounded border border-zinc-800">
                                            <span className="text-[9px] uppercase tracking-widest text-zinc-500 block mb-2 font-bold">Word-Level Diff</span>
                                            <WordDiff oldText={dev.v1_text} newText={dev.v2_text} />
                                        </div>
                                    ) : (
                                        <div className="deviation-text font-sans text-[14px] leading-[1.6] text-zinc-200">
                                            {dev.v2_text}
                                        </div>
                                    )}

                                    {viewMode === 'v3' && (!dStatus || dStatus === 'open' || dStatus === 'under_review') && (
                                        <div className="status-indicator mt-3 text-[10px] uppercase font-bold tracking-widest text-zinc-500 flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[14px]">hourglass_empty</span> ⏳ Pending Decision
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
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

    const renderV3WorkingDraft = () => {
        if (!v2?.raw_text) {
            return renderV2WithContextualDeviations();
        }

        const mappedDeviations = [...deviations]
            .filter((deviation) => deviation.v2_coordinates)
            .sort((a, b) => (b.v2_coordinates?.start_char || 0) - (a.v2_coordinates?.start_char || 0));
        const unmappedDeviations = deviations.filter((deviation) => !deviation.v2_coordinates);

        let cursor = v2.raw_text.length;
        const fragments: React.ReactNode[] = [];

        for (const deviation of mappedDeviations) {
            const coords = deviation.v2_coordinates!;
            const trailingText = v2.raw_text.slice(coords.end_char, cursor);
            if (trailingText) {
                fragments.unshift(<span key={`text-${coords.end_char}`}>{trailingText}</span>);
            }

            const status = issueStatuses[deviation.deviation_id] || 'open';
            const fallback = batnaFallbacks.find((batna) => batna.deviation_id === deviation.deviation_id);

            let replacementText = deviation.v2_text || '';
            let replacementClass = 'bg-zinc-700/20 text-zinc-400';

            if (status === 'accepted') {
                replacementText = deviation.v2_text || '';
                replacementClass = 'bg-emerald-500/20 text-emerald-200';
            } else if (status === 'rejected') {
                replacementText = deviation.v1_text || deviation.v2_text || '';
                replacementClass = 'bg-rose-500/20 text-rose-200';
            } else if (status === 'countered') {
                replacementText = fallback?.fallback_clause || deviation.v1_text || deviation.v2_text || '';
                replacementClass = 'bg-amber-500/20 text-amber-200';
            } else if (status === 'escalated') {
                replacementClass = 'bg-blue-500/20 text-blue-200';
            }

            fragments.unshift(
                <span key={`replacement-${deviation.deviation_id}`} className={`rounded px-1 py-0.5 transition-all duration-300 ${replacementClass}`}>
                    {replacementText}
                </span>
            );
            cursor = coords.start_char;
        }

        if (cursor > 0) {
            fragments.unshift(<span key="text-start">{v2.raw_text.slice(0, cursor)}</span>);
        }

        return (
            <div className="max-w-none pb-[20vh] space-y-8">
                {unmappedDeviations.length > 0 && (
                    <div className="bg-[#111] p-6 rounded-xl border border-zinc-800/60 space-y-4 shadow-xl">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800/60 pb-2">
                            Global Deviations
                        </h3>
                        {unmappedDeviations.map((deviation) => {
                            const status = issueStatuses[deviation.deviation_id] || 'open';
                            const fallback = batnaFallbacks.find((batna) => batna.deviation_id === deviation.deviation_id);
                            const displayText = status === 'rejected'
                                ? deviation.v1_text || deviation.v2_text
                                : status === 'countered'
                                    ? fallback?.fallback_clause || deviation.v1_text || deviation.v2_text
                                    : deviation.v2_text || deviation.v1_text;

                            return (
                                <div key={`v3-unmapped-${deviation.deviation_id}`} className="rounded-lg border border-zinc-800 bg-[#0d0d0d] p-4">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-xs font-semibold text-zinc-200">{deviation.title}</span>
                                        <span className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${getStatusColor(status)}`}>
                                            {status.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <p className="text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap">{displayText}</p>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="whitespace-pre-wrap font-serif text-[15px] leading-[1.85] text-zinc-300">
                    {fragments}
                </div>
            </div>
        );
    };

    console.log('🔥 FINAL RENDER STATE:', { issues, diffResult });
    return (
        <main className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] text-[#e5e2e1] overflow-hidden font-sans">

            {/* MAIN WORKSPACE: 3 COLUMNS */}
            <section className="flex-1 flex overflow-hidden">

                {/* COLUMN A: Version & Deviations */}
                <aside className="w-[280px] bg-[#0a0a0a] border-r border-zinc-800/40 p-6 flex flex-col gap-8 shrink-0 overflow-y-auto custom-scrollbar">
                    <div>
                        <button className="text-[#D4AF37] text-[9px] hover:text-[#f2ca50] font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5 mb-8" onClick={() => router.push(`/dashboard/contracts/${contractId}`)}>
                            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                            Back to Contract
                        </button>
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
                                        className={`bg-[#141414] border-y border-r border-zinc-800/40 border-l-2 border-l-emerald-900/60 rounded-lg p-3 flex justify-between items-center cursor-pointer transition-all ${viewMode === 'v3' ? 'shadow-[0_0_15px_rgba(16,185,129,0.05)] bg-[#141414]' : 'opacity-80 hover:opacity-100'}`}
                                        onClick={() => setViewMode('v3')}
                                    >
                                        <div>
                                            <span className="text-xs text-zinc-300 font-medium block break-words max-w-[120px]">Working Draft (V3)</span>
                                            <span className="text-[10px] text-zinc-500 uppercase tracking-widest block">MERGED</span>
                                        </div>
                                        <span className="bg-emerald-950/20 text-emerald-500/80 text-[10px] uppercase px-2 py-0.5 rounded border border-emerald-900/30 flex-shrink-0 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 animate-pulse"></span>
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

                    <div className="rounded-xl border border-zinc-800/50 bg-[#0f0f0f] p-4">
                        {allResolved ? (
                            <button
                                onClick={handleFinalizeForSigning}
                                disabled={isFinalizing}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <span className="material-symbols-outlined text-sm">
                                    {isFinalizing ? 'progress_activity' : 'check_circle'}
                                </span>
                                {isFinalizing ? 'Finalizing...' : 'Finalize for Signing'}
                            </button>
                        ) : (
                            <div className="w-full bg-zinc-900 text-zinc-400 py-3 px-4 rounded-lg text-center text-xs">
                                {unresolvedCritical > 0
                                    ? `${unresolvedCritical} critical issue(s) must be resolved before signing`
                                    : `${pendingIssueCount} issue(s) still pending`}
                            </div>
                        )}
                    </div>

                    {/* DEVIATION NAVIGATOR */}
                    <div>
                        <div className="flex justify-between items-end mb-4">
                            <h4 className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase font-bold">Deviations ({sortedDeviations.length})</h4>
                        </div>

                        {/* SEVERITY FILTERS */}
                        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 custom-scrollbar">
                            <button
                                onClick={() => setSeverityFilters({})}
                                className={`text-[9px] px-2 py-1 rounded font-bold uppercase tracking-widest border transition-colors shrink-0 ${Object.values(severityFilters).every(v => !v) ? 'bg-zinc-800 text-zinc-200 border-zinc-700' : 'bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-700'}`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setSeverityFilters(p => ({ ...p, critical: !p.critical }))}
                                className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded font-bold uppercase tracking-widest border transition-colors shrink-0 ${severityFilters.critical ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' : 'bg-transparent text-rose-500/60 border-rose-900/40 hover:border-rose-800/60'}`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 block"></span>
                                Critical ({criticalCount})
                            </button>
                            <button
                                onClick={() => setSeverityFilters(p => ({ ...p, warning: !p.warning }))}
                                className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded font-bold uppercase tracking-widest border transition-colors shrink-0 ${severityFilters.warning ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'bg-transparent text-amber-500/60 border-amber-900/40 hover:border-amber-800/60'}`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 block"></span>
                                Warning ({warningCount})
                            </button>
                            <button
                                onClick={() => setSeverityFilters(p => ({ ...p, info: !p.info }))}
                                className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded font-bold uppercase tracking-widest border transition-colors shrink-0 ${severityFilters.info ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-transparent text-blue-500/60 border-blue-900/40 hover:border-blue-800/60'}`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 block"></span>
                                Info
                            </button>
                        </div>

                        <div className="space-y-3">
                            {sortedDeviations.length === 0 ? (
                                <p className="text-xs text-zinc-600 italic px-2">No deviations match filters.</p>
                            ) : sortedDeviations.map((dev) => {
                                const status = issueStatuses[dev.deviation_id] || 'open';
                                const isSelected = selectedDevId === dev.deviation_id;
                                const severityTone = dev.severity === 'critical'
                                    ? {
                                        dot: 'bg-rose-500',
                                        text: 'text-rose-400/80',
                                        selected: 'border-rose-500/60 ring-rose-500/30',
                                    }
                                    : dev.severity === 'warning'
                                        ? {
                                            dot: 'bg-amber-500',
                                            text: 'text-amber-400/80',
                                            selected: 'border-amber-500/60 ring-amber-500/30',
                                        }
                                        : {
                                            dot: 'bg-blue-500',
                                            text: 'text-blue-400/80',
                                            selected: 'border-blue-500/60 ring-blue-500/30',
                                        };
                                const statusMeta = status === 'accepted' || status === 'resolved'
                                    ? { border: 'border-l-emerald-500', text: 'text-emerald-400', label: `✓ ${status.toUpperCase()}`, dim: true }
                                    : status === 'rejected'
                                        ? { border: 'border-l-rose-500', text: 'text-rose-400', label: '✗ REJECTED', dim: true }
                                        : status === 'countered'
                                            ? { border: 'border-l-amber-500', text: 'text-amber-400', label: '↩ COUNTERED', dim: false }
                                            : status === 'under_review'
                                                ? { border: 'border-l-blue-500', text: 'text-blue-400', label: '● UNDER REVIEW', dim: false }
                                                : status === 'escalated'
                                                    ? { border: 'border-l-blue-500', text: 'text-blue-400', label: '⬆ ESCALATED', dim: false }
                                                    : status === 'dismissed'
                                                    ? { border: 'border-l-zinc-600', text: 'text-zinc-500', label: 'DISMISSED', dim: true }
                                                        : { border: 'border-l-zinc-500', text: 'text-zinc-400', label: 'OPEN', dim: false };

                                return (
                                    <div
                                        key={dev.deviation_id}
                                        onClick={() => {
                                            setSelectedDevId(dev.deviation_id);
                                            const el = document.getElementById(`dev-${dev.deviation_id}`);
                                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        }}
                                        className={`border-l-4 ${statusMeta.border} p-3 rounded-lg cursor-pointer transition-all ${statusMeta.dim ? 'opacity-60' : 'opacity-100'} ${isSelected
                                                ? `bg-[#1a1a1a] shadow-sm ring-1 ${severityTone.selected}`
                                                : 'bg-[#0f0f0f] border border-zinc-800/40 hover:border-zinc-700/60'
                                            }`}
                                    >
                                        <div className="flex items-start gap-2 mb-2">
                                            <span className={`w-2 h-2 mt-1 rounded-full shrink-0 ${severityTone.dot}`}></span>
                                            <div className="flex-1 min-w-0">
                                                <h5 className="text-xs font-semibold text-zinc-200 leading-tight block mb-1">{dev.title}</h5>
                                                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[9px] uppercase tracking-widest text-zinc-500">
                                                    <span>{dev.category}</span>
                                                    <span>·</span>
                                                    <span className={severityTone.text}>{dev.severity}</span>
                                                    {dev.pre_debate_severity && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="text-[#D4AF37]">⚖️</span>
                                                            {dev.pre_debate_severity !== dev.severity ? (
                                                                <span className={dev.severity === 'critical' || (dev.severity === 'warning' && dev.pre_debate_severity === 'info')
                                                                    ? 'text-rose-400'
                                                                    : 'text-emerald-400'
                                                                }>
                                                                    {dev.severity === 'critical' || (dev.severity === 'warning' && dev.pre_debate_severity === 'info') ? '↑' : '↓'}
                                                                </span>
                                                            ) : (
                                                                <span className="text-zinc-500">•</span>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-2 text-[9px] uppercase tracking-widest font-bold flex items-center gap-1.5">
                                            <span className="text-zinc-600">STATUS:</span>
                                            <span className={`${statusMeta.text} flex items-center gap-1`}>{statusMeta.label}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* MOMENTUM TRACKER */}
                    <div className="mt-2 p-4 bg-[#0f0f0f] border border-zinc-800/40 rounded-xl flex flex-col gap-2">
                        <h4 className="text-[10px] text-zinc-500 tracking-widest uppercase mb-3 font-bold">Momentum Tracker (Filter)</h4>

                        <div
                            className={`flex justify-between items-center cursor-pointer p-1.5 -mx-1.5 rounded transition-colors ${statusFilter === 'unresolved' ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'}`}
                            onClick={() => setStatusFilter(prev => prev === 'unresolved' ? null : 'unresolved')}
                        >
                            <span className="text-xs text-zinc-400 flex items-center gap-2"><span className="text-rose-500 text-[10px]">▲</span> UNRESOLVED</span>
                            <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded transition-all duration-300 ${unresolvedCount > 0 ? 'text-rose-500/80 bg-rose-950/30' : 'text-zinc-600'}`}>
                                {unresolvedCount}
                            </span>
                        </div>

                        <div
                            className={`flex justify-between items-center cursor-pointer p-1.5 -mx-1.5 rounded transition-colors ${statusFilter === 'under_review' ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'}`}
                            onClick={() => setStatusFilter(prev => prev === 'under_review' ? null : 'under_review')}
                        >
                            <span className="text-xs text-zinc-400 flex items-center gap-2"><span className="text-blue-500 text-[10px]">●</span> UNDER REVIEW</span>
                            <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded transition-all duration-300 ${underReviewCount > 0 ? 'text-blue-400/80 bg-blue-950/30' : 'text-zinc-600'}`}>
                                {underReviewCount}
                            </span>
                        </div>

                        <div
                            className={`flex justify-between items-center cursor-pointer p-1.5 -mx-1.5 rounded transition-colors ${statusFilter === 'resolved' ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'}`}
                            onClick={() => setStatusFilter(prev => prev === 'resolved' ? null : 'resolved')}
                        >
                            <span className="text-xs text-zinc-400 flex items-center gap-2"><span className="text-emerald-500 text-[10px]">✓</span> RESOLVED</span>
                            <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded transition-all duration-300 ${resolvedCount > 0 ? 'text-emerald-500/80 bg-emerald-950/30' : 'text-zinc-600'}`}>
                                {resolvedCount}
                            </span>
                        </div>
                    </div>
                </aside>

                {/* COLUMN B: The Document (Smart Diff) */}
                <section className="flex-1 bg-[#0a0a0a] overflow-y-auto p-12 custom-scrollbar relative">
                    <div className="max-w-3xl mx-auto bg-[#0f0f0f] border border-zinc-800/60 rounded-xl p-16 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]">
                        <header className="mb-12 text-center">
                            <h1 className="font-serif text-2xl font-light text-zinc-100 tracking-tight mb-2">{contractTitle}</h1>
                            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500 mb-6">Negotiation War Room Diff</p>
                            <div className="mb-4 flex items-center justify-center gap-3">
                                <SSEStatusBadge isConnected={isSSEConnected} isFallbackPolling={isFallbackPolling} />
                                {(waitingForRealtime || isLoading) && (
                                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">{loadingStage}</span>
                                )}
                            </div>

                            {/* ENHANCEMENT 3: VIEW MODE TOGGLE */}
                            <div className="inline-flex bg-[#141414] border border-zinc-800/80 rounded-lg p-1.5 shadow-inner mx-auto mb-4">
                                <button
                                    onClick={() => setViewMode('v1')}
                                    className={`px-6 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${viewMode === 'v1'
                                            ? 'bg-zinc-800 text-zinc-200 shadow-sm'
                                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                                        }`}
                                >
                                    V1 Original
                                </button>
                                <button
                                    onClick={() => setViewMode('v2')}
                                    className={`px-6 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${viewMode === 'v2'
                                            ? 'bg-[#1a1410] text-[#D4AF37] border border-[#D4AF37]/20 shadow-sm'
                                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                                        }`}
                                >
                                    V2 Counterparty
                                </button>
                                <button
                                    onClick={() => setViewMode('v3')}
                                    className={`px-6 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${viewMode === 'v3'
                                            ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50 shadow-sm'
                                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                                        }`}
                                >
                                    V3 Draft
                                </button>
                            </div>
                            <div className="text-[11px] text-zinc-400">
                                {viewMode === 'v1' && "BASELINE — Original Contract"}
                                {viewMode === 'v2' && "COUNTERPARTY VERSION — Under Review"}
                                {viewMode === 'v3' && (
                                    <span className="flex items-center justify-center gap-2">
                                        WORKING DRAFT — Reflects Your Decisions
                                        <span className="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full text-[9px] tabular-nums">
                                            {resolvedCount} of {Math.max(issues.length, deviations.length)} deviations resolved ({resolutionPct}%)
                                        </span>
                                    </span>
                                )}
                            </div>
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
                                    {renderV3WorkingDraft()}
                                </div>
                            ) : (
                                renderV2WithContextualDeviations()
                            )}
                        </article>
                    </div>
                </section>

                {/* COLUMN C: Clause Assistant & BATNA Center */}
                <aside className="w-[420px] bg-[#0a0a0a] border-l border-zinc-800/40 flex flex-col shrink-0 overflow-hidden">
                    {counselOpen ? (
                        <CounselChat
                            contractId={contractId}
                            sessionType={counselSessionType}
                            deviationId={counselDeviationId}
                            deviationTitle={counselSessionType === 'general_strategy' ? "General Strategy" : (selectedDev?.title || "Deviation")}
                            onClose={() => setCounselOpen(false)}
                        />
                    ) : (
                        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
                            {selectedDev ? (
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

                                    {/* Playbook Citation (Moved UP to Top) */}
                                    {selectedDev.playbook_violation && (
                                        <div className="mb-4 flex items-start gap-2.5 bg-rose-900/15 border border-rose-500/40 p-3 rounded-lg shadow-inner">
                                            <span className="shrink-0 text-rose-500 mt-0.5 material-symbols-outlined text-lg">gavel</span>
                                            <div className="flex-1">
                                                <span className="text-rose-400 font-bold uppercase tracking-widest flex items-center gap-2 mb-1.5" style={{ fontSize: '10px' }}>
                                                    Playbook Violation
                                                    <span className="uppercase tracking-widest text-[8px] bg-rose-500 text-white px-1.5 py-0.5 rounded font-black">ALERT</span>
                                                </span>
                                                <p className="italic leading-relaxed text-[12px] text-rose-200">"{selectedDev.playbook_violation}"</p>
                                            </div>
                                        </div>
                                    )}

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

                                    {enableDebate && selectedDebate && (
                                        <div className="mb-4">
                                            <DebatePanel
                                                debateResult={selectedDebate}
                                                selectedDeviation={selectedDev}
                                            />
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
                                                onClick={() => {
                                                    if (!selectedIssue) {
                                                        toast.error('No negotiation issue found for this deviation.');
                                                        return;
                                                    }
                                                    if (!selectedBATNA.fallback_clause) {
                                                        toast.error('No BATNA available for this counter-proposal.');
                                                        return;
                                                    }
                                                    void handleDecision(
                                                        selectedIssue.id,
                                                        'countered',
                                                        'Countered with BATNA fallback',
                                                        'Countered',
                                                        'BATNA fallback applied to the working draft.'
                                                    );
                                                }}
                                                disabled={!selectedIssue || !selectedBATNA.fallback_clause || isSelectedIssuePending}
                                                className="w-full mt-2 mb-3 py-2 bg-[#D4AF37] hover:brightness-110 text-black text-[10px] uppercase font-bold tracking-widest rounded flex justify-center items-center gap-1 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">bolt</span>
                                                Apply Strategy as V3 Draft
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

                                    {/* ── NEGOTIATION STATE ACTIONS ── */}
                                    <div className="mb-4">
                                        <button
                                            onClick={() => openCounselChat("deviation", selectedDev?.deviation_id)}
                                            className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg hover:bg-zinc-700/50 transition text-sm text-zinc-300"
                                        >
                                            Clause Assistant
                                        </button>

                                        <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold block mb-2">Negotiation Decision</span>
                                        {selectedIssue ? (
                                            <>
                                                {isSelectedIssueLocked ? (
                                                    <div className={`mt-2 rounded-lg border px-3 py-3 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 ${getStatusColor(selectedIssueStatus)} ${isSelectedIssuePending ? 'animate-pulse' : ''}`}>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span>
                                                                {selectedIssueStatus === 'escalated'
                                                                    ? 'Escalated to Task'
                                                                    : `Current Decision: ${selectedIssueStatus.replace('_', ' ')}`}
                                                            </span>
                                                            <button
                                                                onClick={() => void handleDecision(
                                                                    selectedIssue.id,
                                                                    'open',
                                                                    'Reopened in War Room',
                                                                    'Reopened',
                                                                    'Deviation moved back to open.'
                                                                )}
                                                                disabled={isSelectedIssuePending}
                                                                className="text-[9px] font-bold uppercase tracking-widest text-zinc-200 underline underline-offset-2 disabled:opacity-40"
                                                            >
                                                                Undo
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <button
                                                            onClick={() => void handleDecision(
                                                                selectedIssue.id,
                                                                'accepted',
                                                                'Accepted in War Room',
                                                                'Accepted',
                                                                'Deviation moved to accepted.'
                                                            )}
                                                            disabled={isSelectedIssuePending}
                                                            className="py-2.5 px-3 border border-white/[0.03] bg-white/[0.02] text-[#8ba291] hover:bg-white/[0.04] hover:border-white/[0.05] text-[9px] font-light uppercase tracking-[0.2em] active:scale-[0.98] transition-all duration-300 rounded-[4px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                        >
                                                            <span className="material-symbols-outlined text-[13px] font-extralight">check</span>
                                                            Accept
                                                        </button>
                                                        <button
                                                            onClick={() => void handleDecision(
                                                                selectedIssue.id,
                                                                'rejected',
                                                                'Rejected in War Room',
                                                                'Rejected',
                                                                'Deviation moved to rejected.'
                                                            )}
                                                            disabled={isSelectedIssuePending}
                                                            className="py-2.5 px-3 border border-white/[0.03] bg-white/[0.02] text-[#ad7f7f] hover:bg-white/[0.04] hover:border-white/[0.05] text-[9px] font-light uppercase tracking-[0.2em] active:scale-[0.98] transition-all duration-300 rounded-[4px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                        >
                                                            <span className="material-symbols-outlined text-[13px] font-extralight">close</span>
                                                            Reject
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (!selectedBATNA?.fallback_clause) {
                                                                    toast.error('No BATNA available for this counter-proposal.');
                                                                    return;
                                                                }
                                                                void handleDecision(
                                                                    selectedIssue.id,
                                                                    'countered',
                                                                    'Countered with BATNA fallback',
                                                                    'Countered',
                                                                    'BATNA fallback applied to the working draft.'
                                                                );
                                                            }}
                                                            disabled={isSelectedIssuePending || !selectedBATNA?.fallback_clause}
                                                            className="py-2.5 px-3 border border-white/[0.03] bg-white/[0.02] text-[#b4a58b] hover:bg-white/[0.04] hover:border-white/[0.05] text-[9px] font-light uppercase tracking-[0.2em] active:scale-[0.98] transition-all duration-300 rounded-[4px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                        >
                                                            <span className="material-symbols-outlined text-[13px] font-extralight">reply</span>
                                                            Counter
                                                        </button>
                                                        <button
                                                            onClick={() => void handleDecision(
                                                                selectedIssue.id,
                                                                'escalated',
                                                                'Escalated to internal team for review',
                                                                'Escalated',
                                                                'Deviation escalated for internal review.'
                                                            )}
                                                            disabled={isSelectedIssuePending}
                                                            className="py-2.5 px-3 border border-white/[0.03] bg-white/[0.02] text-[#8a9bb2] hover:bg-white/[0.04] hover:border-white/[0.05] text-[9px] font-light uppercase tracking-[0.2em] active:scale-[0.98] transition-all duration-300 rounded-[4px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                        >
                                                            <span className="material-symbols-outlined text-[13px] font-extralight">arrow_upward</span>
                                                            Escalate
                                                        </button>
                                                    </div>
                                                )}

                                                <button
                                                    onClick={handleEditInComposer}
                                                    className="mt-3 w-full py-2 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/60 text-[9px] font-bold uppercase tracking-wider transition-all rounded flex items-center justify-center gap-1"
                                                >
                                                    Edit in Composer
                                                </button>
                                            </>
                                        ) : (
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[10px] text-zinc-500">
                                                Issue record unavailable for this deviation.
                                            </div>
                                        )}
                                    </div>

                                    {/* ── AUDIT TRAIL ── */}
                                    {selectedIssueAuditLog.length > 0 && (
                                        <div className="mb-4">
                                            <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold block mb-2">Audit Trail</span>
                                            <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                                                {selectedIssueAuditLog.map((entry, idx) => (
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
                                </div>

                            </div>
                        </div>
                    ) : (
                        <div className="p-6 text-center text-zinc-500 text-sm">
                            No deviation selected.
                        </div>
                    )}
                </div>
            )}
        </aside>

            </section>
        </main>
    );
}
