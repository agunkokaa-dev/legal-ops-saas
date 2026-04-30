'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { 
    ChevronUp, AlertTriangle, Lightbulb, Zap, 
    CheckCircle, ArrowLeftRight, GitFork, ChevronRight 
} from 'lucide-react';
import CounselChat from './CounselChat';
import DebatePanel from './DebatePanel';
import ClauseAssistant from '../contract-detail/ClauseAssistant';
import { getStatusColor } from './warRoomStatus';
import { assertSafeLlmText } from '@/lib/sanitize';
import type {
    AuditLogEntry,
    BATNAFallback,
    DeviationDebateResult,
    DiffDeviation,
    NegotiationIssue,
} from './warRoomTypes';

interface DeviationAssistantPanelProps {
    contractId: string;
    matterId: string | null;
    selectedDev?: DiffDeviation;
    selectedIssue: NegotiationIssue | null;
    selectedBATNA?: BATNAFallback;
    selectedDebate: DeviationDebateResult | null;
    enableDebate: boolean;
    isSelectedIssuePending: boolean;
    isSelectedIssueLocked: boolean;
    selectedIssueStatus: string;
    selectedIssueAuditLog: AuditLogEntry[];
    onAccept: () => void;
    onReject: () => void;
    onCounter: () => void;
    onEscalate: () => void;
    onUndo: () => void;
    onEditInComposer: () => void;
    onShowRelatedLaws: () => void;
    onOpenClauseAssistant: () => void;
}

export default function DeviationAssistantPanel({
    contractId,
    matterId,
    selectedDev,
    selectedIssue,
    selectedBATNA,
    selectedDebate,
    enableDebate,
    isSelectedIssuePending,
    isSelectedIssueLocked,
    selectedIssueStatus,
    selectedIssueAuditLog,
    onAccept,
    onReject,
    onCounter,
    onEscalate,
    onUndo,
    onEditInComposer,
    onShowRelatedLaws,
    onOpenClauseAssistant,
}: DeviationAssistantPanelProps) {
    const [counselOpen, setCounselOpen] = useState(false);
    const [counselSessionType, setCounselSessionType] = useState<"deviation" | "general_strategy">("deviation");
    const [counselDeviationId, setCounselDeviationId] = useState<string | null>(null);

    const openCounselChat = (type: "deviation" | "general_strategy", devId?: string) => {
        setCounselSessionType(type);
        setCounselDeviationId(devId || null);
        setCounselOpen(true);
    };

    const safeImpactAnalysis = selectedDev
        ? assertSafeLlmText(selectedDev.impact_analysis, 'impact_analysis')
        : '';
    const safeCounterpartyIntent = selectedDev?.counterparty_intent
        ? assertSafeLlmText(selectedDev.counterparty_intent, 'counterparty_intent')
        : '';
    const safeBatnaReasoning = selectedBATNA
        ? assertSafeLlmText(selectedBATNA.reasoning, 'reasoning')
        : '';
    const safeFallbackClause = selectedBATNA
        ? assertSafeLlmText(selectedBATNA.fallback_clause, 'fallback_clause')
        : '';

    const handleApplyBATNA = (batna: BATNAFallback) => {
        if (!selectedIssue) {
            toast.error('No negotiation issue found for this deviation.');
            return;
        }
        if (!batna.fallback_clause) {
            toast.error('No BATNA available for this counter-proposal.');
            return;
        }
        onCounter();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#0D0D14]">
            {counselOpen ? (
                <CounselChat
                    contractId={contractId}
                    sessionType={counselSessionType}
                    deviationId={counselDeviationId}
                    deviationTitle={counselSessionType === 'general_strategy' ? "General Strategy" : (selectedDev?.title || "Deviation")}
                    onClose={() => setCounselOpen(false)}
                />
            ) : (
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
                        <div className="flex items-center">
                            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                                Clause Counsel
                            </span>
                        </div>
                        <button className="text-zinc-600 hover:text-zinc-400 disabled:opacity-50" disabled>
                            <ChevronUp className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                        {!selectedDev ? (
                            <div className="text-center text-zinc-500 text-sm mt-10">
                                Select a deviation to analyze.
                            </div>
                        ) : (
                            <>
                                {/* Risk Card */}
                                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0">
                                            <AlertTriangle className="w-4 h-4 text-red-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-sm font-semibold text-white truncate max-w-[180px]" title={selectedDev.category || ''}>
                                                    Risk: {selectedDev.category || 'N/A'}
                                                </span>
                                                <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold
                                                    ${selectedDev.severity === 'critical'
                                                        ? 'bg-red-500/20 text-red-400'
                                                        : 'bg-orange-500/20 text-orange-400'}`}>
                                                    {selectedDev.severity === 'critical' ? 'High' : 'Medium'}
                                                </span>
                                            </div>
                                            <p className="text-sm text-zinc-400 leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                                                {safeImpactAnalysis || 'No specific impact analysis provided.'}
                                            </p>

                                            {/* Impact / Confidence / Category grid */}
                                            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-zinc-800/60">
                                                <div className="text-center">
                                                    <div className="text-[10px] text-zinc-600 mb-0.5">Impact</div>
                                                    <div className="text-xs font-semibold text-red-400">High</div>
                                                </div>
                                                <div className="text-center border-x border-zinc-800/60">
                                                    <div className="text-[10px] text-zinc-600 mb-0.5">Confidence</div>
                                                    <div className="text-xs font-semibold text-white">82%</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-[10px] text-zinc-600 mb-0.5">Category</div>
                                                    <div className="text-xs font-semibold text-zinc-300 truncate px-1" title={selectedDev.category || ''}>
                                                        {selectedDev.category?.slice(0, 8) || 'N/A'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Why This Changed */}
                                {safeCounterpartyIntent && (
                                    <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/30 p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Lightbulb className="w-3.5 h-3.5 text-indigo-400" />
                                            <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">
                                                Why This Changed?
                                            </span>
                                        </div>
                                        <p className="text-sm text-zinc-300 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
                                            {safeCounterpartyIntent}
                                        </p>
                                    </div>
                                )}

                                {/* BATNA Strategy */}
                                {selectedBATNA && (
                                    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Zap className="w-3.5 h-3.5 text-[#B8B8B8]" />
                                            <span className="text-[10px] font-semibold text-[#B8B8B8] uppercase tracking-wider">
                                                BATNA Strategy
                                            </span>
                                        </div>
                                        <p className="text-xs text-zinc-400 italic leading-relaxed mb-3">
                                            {safeBatnaReasoning}
                                        </p>
                                        <div className="rounded-lg bg-zinc-800/60 p-3 mb-3">
                                            <div className="text-[10px] font-semibold text-zinc-500 mb-1">
                                                Strategy: Modify & Cap Scope
                                            </div>
                                            <p className="text-[11px] text-zinc-300 leading-relaxed overflow-hidden" 
                                               style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                                                {safeFallbackClause}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleApplyBATNA(selectedBATNA)}
                                            disabled={!selectedIssue || isSelectedIssuePending}
                                            className="w-full flex items-center justify-center gap-2 py-2
                                                       bg-[#1C1C1C] hover:bg-[#1C1C1C] border border-[#3A3A3A]
                                                       text-[#B8B8B8] text-xs font-semibold rounded-lg transition
                                                       disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Zap className="w-3 h-3" />
                                            Use as V3 Draft →
                                        </button>
                                    </div>
                                )}

                                {/* Suggested Actions */}
                                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
                                    <div className="flex justify-between items-center mb-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                            Suggested Actions
                                        </p>
                                        {isSelectedIssueLocked && (
                                            <button onClick={onUndo} disabled={isSelectedIssuePending} className="text-[10px] underline text-zinc-400 hover:text-white">
                                                Undo Decision
                                            </button>
                                        )}
                                    </div>
                                    
                                    {isSelectedIssueLocked ? (
                                        <div className={`rounded-lg border px-3 py-3 text-xs font-bold uppercase tracking-wider ${getStatusColor(selectedIssueStatus)}`}>
                                            Current Decision: {selectedIssueStatus.replace('_', ' ')}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {[
                                                {
                                                    icon: CheckCircle,
                                                    color: 'text-emerald-400',
                                                    bg: 'bg-emerald-500/15',
                                                    label: 'Accept with Clarification',
                                                    sublabel: 'Terima dengan batasan dan definisi jelas',
                                                    action: onAccept,
                                                },
                                                {
                                                    icon: ArrowLeftRight,
                                                    color: 'text-[#B8B8B8]',
                                                    bg: 'bg-[#1C1C1C]',
                                                    label: 'Counter & Negotiate',
                                                    sublabel: 'Tolak perluasan scope ini',
                                                    action: () => {
                                                        if (!selectedBATNA?.fallback_clause) {
                                                            toast.error('No BATNA available for this counter-proposal.');
                                                            return;
                                                        }
                                                        onCounter();
                                                    },
                                                },
                                                {
                                                    icon: GitFork,
                                                    color: 'text-purple-400',
                                                    bg: 'bg-purple-500/15',
                                                    label: 'Split into Phase 2',
                                                    sublabel: 'Pekerjaan tambahan masuk fase berikutnya',
                                                    action: onEscalate,
                                                },
                                            ].map(({ icon: Icon, color, bg, label, sublabel, action }) => (
                                                <button
                                                    key={label}
                                                    onClick={action}
                                                    disabled={!selectedIssue || isSelectedIssuePending}
                                                    className="w-full flex items-center gap-3 p-3 rounded-lg
                                                               bg-zinc-800/40 hover:bg-zinc-800/70 border border-zinc-700/40
                                                               hover:border-zinc-600/60 transition-all text-left
                                                               disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0`}>
                                                        <Icon className={`w-3.5 h-3.5 ${color}`} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs text-white font-medium">{label}</div>
                                                        <div className="text-[10px] text-zinc-500">{sublabel}</div>
                                                    </div>
                                                    <ChevronRight className="w-3.5 h-3.5 text-zinc-700 flex-shrink-0" />
                                                </button>
                                            ))}
                                            
                                            <button
                                                onClick={onReject}
                                                disabled={!selectedIssue || isSelectedIssuePending}
                                                className="w-full mt-2 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                                            >
                                                Straight Reject
                                            </button>
                                        </div>
                                    )}

                                    <div className="mt-3 border-t border-zinc-800/60 pt-3">
                                        <button
                                            type="button"
                                            onClick={onOpenClauseAssistant}
                                            disabled={!selectedDev}
                                            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium
                                                       text-zinc-300 hover:text-white
                                                       border border-zinc-700/60 hover:border-zinc-600
                                                       bg-zinc-800/40 hover:bg-zinc-800/70
                                                       transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Clause Assistant
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
