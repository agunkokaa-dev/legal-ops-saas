export interface DiffDeviation {
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

export interface AuditLogEntry {
    action: string;
    actor: string;
    reason: string;
    timestamp: string;
    previous_status?: string;
    generated_response?: string;
}

export interface BATNAFallback {
    deviation_id: string;
    fallback_clause: string;
    reasoning: string;
    leverage_points: string[];
}

export type DebatePerspective = "client_advocate" | "counterparty_advocate" | "neutral_arbiter";

export interface DebateArgument {
    perspective: DebatePerspective;
    position: "upgrade_severity" | "downgrade_severity" | "maintain_severity";
    recommended_severity: "critical" | "warning" | "info";
    reasoning: string;
    key_points: string[];
    legal_basis?: string | null;
    risk_quantification?: string | null;
    confidence: number;
}

export interface DebateVerdict {
    original_severity: string;
    final_severity: string;
    severity_changed: boolean;
    consensus_level: "unanimous" | "majority" | "split";
    verdict_reasoning: string;
    adjusted_impact_analysis: string;
    adjusted_batna?: string | null;
    confidence_score: number;
}

export interface DeviationDebateResult {
    deviation_id: string;
    debate_triggered: boolean;
    arguments: DebateArgument[];
    verdict?: DebateVerdict | null;
    debate_duration_ms: number;
    tokens_used: number;
}

export interface DebateProtocolResult {
    debate_results: DeviationDebateResult[];
    total_deviations: number;
    debated_count: number;
    skipped_count: number;
    severity_changes: number;
    total_duration_ms: number;
    total_tokens_used: number;
    model_versions: Record<string, string>;
}

export interface SmartDiffResult {
    deviations: DiffDeviation[];
    batna_fallbacks: BATNAFallback[];
    risk_delta: number;
    summary: string;
    rounds?: Array<unknown>;
    debate_protocol?: DebateProtocolResult | null;
}

export interface ContractVersion {
    id: string;
    version_number: number;
    risk_score: number;
    risk_delta: number;
    created_at: string;
    raw_text?: string;
    uploaded_filename?: string | null;
    risk_level?: string;
    source?: string | null;
    finalized_at?: string | null;
    finalized_by?: string | null;
    parent_version_id?: string | null;
}

export interface NegotiationIssue {
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

export type LooseRecord = Record<string, unknown>;
