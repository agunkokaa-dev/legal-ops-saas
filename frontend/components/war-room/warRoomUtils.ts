import DiffMatchPatch from 'diff-match-patch';
import type {
    AuditLogEntry,
    BATNAFallback,
    ContractVersion,
    DebateVerdict,
    DeviationDebateResult,
    DiffDeviation,
    LooseRecord,
    NegotiationIssue,
    SmartDiffResult,
} from './warRoomTypes';

export const RESOLVED_STATUSES = new Set(['accepted', 'rejected', 'countered', 'resolved']);
export const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'countered', 'resolved', 'dismissed']);

export function encodeWordTokens(
    text: string,
    tokenMap: Map<string, number>,
    tokenArray: string[]
): string {
    let encoded = '';
    const tokens = text.match(/\S+|\s+/g) || [];

    for (const token of tokens) {
        const existing = tokenMap.get(token);
        if (existing !== undefined) {
            encoded += String.fromCharCode(existing);
            continue;
        }

        const nextIndex = tokenArray.length;
        tokenArray.push(token);
        tokenMap.set(token, nextIndex);
        encoded += String.fromCharCode(nextIndex);
    }

    return encoded;
}

export function calculateStructuralChangeRatio(previousText: string, nextText: string): number {
    if (!previousText && !nextText) return 0;

    const tokenMap = new Map<string, number>();
    const tokenArray: string[] = [];
    const encodedPrevious = encodeWordTokens(previousText || '', tokenMap, tokenArray);
    const encodedNext = encodeWordTokens(nextText || '', tokenMap, tokenArray);

    const dmp = new DiffMatchPatch();
    const encodedDiffs = dmp.diff_main(encodedPrevious, encodedNext);
    dmp.diff_cleanupSemantic(encodedDiffs);

    let changedChars = 0;
    let totalChars = 0;

    for (const [operation, chunk] of encodedDiffs) {
        let decodedLength = 0;
        for (let index = 0; index < chunk.length; index += 1) {
            decodedLength += tokenArray[chunk.charCodeAt(index)]?.length ?? 0;
        }

        totalChars += decodedLength;
        if (operation !== 0) {
            changedChars += decodedLength;
        }
    }

    return totalChars > 0 ? changedChars / totalChars : 0;
}

export function isStructuralChangeDetected(previousText: string, nextText: string): boolean {
    return calculateStructuralChangeRatio(previousText, nextText) > 0.8;
}

export function asRecord(value: unknown): LooseRecord | null {
    return value && typeof value === 'object' ? value as LooseRecord : null;
}

export function readString(record: LooseRecord, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return undefined;
}

export function readNumber(record: LooseRecord, ...keys: string[]): number | undefined {
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

export function readBoolean(record: LooseRecord, ...keys: string[]): boolean | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'boolean') {
            return value;
        }
    }
    return undefined;
}

export function readArray<T = unknown>(record: LooseRecord, ...keys: string[]): T[] {
    for (const key of keys) {
        const value = record[key];
        if (Array.isArray(value)) {
            return value as T[];
        }
    }
    return [];
}

export function normalizeVersion(input: unknown): ContractVersion | null {
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
        source: readString(record, 'source'),
        finalized_at: readString(record, 'finalized_at', 'finalizedAt') || null,
        finalized_by: readString(record, 'finalized_by', 'finalizedBy') || null,
        parent_version_id: readString(record, 'parent_version_id', 'parentVersionId') || null,
    };
}

export function normalizeSeverity(value: unknown): 'critical' | 'warning' | 'info' {
    const normalized = typeof value === 'string' ? value.toLowerCase() : '';
    if (normalized === 'critical' || normalized === 'warning') {
        return normalized;
    }
    return 'info';
}

export function normalizeStatus(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.toLowerCase() : 'open';
}

export function normalizeDeviation(input: unknown): DiffDeviation | null {
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

export function normalizeBATNA(input: unknown): BATNAFallback | null {
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

export function normalizeDebateResult(input: unknown): DeviationDebateResult | null {
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
        arguments: readArray(record, 'arguments'),
        verdict,
        debate_duration_ms: readNumber(record, 'debate_duration_ms', 'debateDurationMs') ?? 0,
        tokens_used: readNumber(record, 'tokens_used', 'tokensUsed') ?? 0,
    };
}

export function normalizeDiffResult(input: unknown): SmartDiffResult | null {
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

export function buildFallbackDiffResult(issues: NegotiationIssue[]): SmartDiffResult | null {
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

export function isWorkingDraftVersion(version: ContractVersion): boolean {
    return /working[_ -]?draft/i.test(version.uploaded_filename || '');
}

export function resolveWarRoomVersions(versionList: ContractVersion[]) {
    const sorted = [...versionList].sort((a, b) => a.version_number - b.version_number);
    const diffVersions = sorted.filter((version) => !isWorkingDraftVersion(version));
    const workingDraftVersions = sorted.filter(isWorkingDraftVersion);

    return {
        baselineVersion: diffVersions.length > 1 ? diffVersions[diffVersions.length - 2] : diffVersions[0] || null,
        counterpartyVersion: diffVersions[diffVersions.length - 1] || null,
        workingDraftVersion: workingDraftVersions[workingDraftVersions.length - 1] || null,
    };
}

export function isIssueFinalizeResolved(issue: NegotiationIssue): boolean {
    return TERMINAL_STATUSES.has(issue.status) || (issue.status === 'escalated' && issue.linked_task_status === 'done');
}

export function replaceLastAuditEntry(entries: AuditLogEntry[] | undefined, nextEntry: AuditLogEntry): AuditLogEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [nextEntry];
    }
    return [...entries.slice(0, -1), nextEntry];
}

export function normalizeIssue(issue: unknown): NegotiationIssue | null {
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
