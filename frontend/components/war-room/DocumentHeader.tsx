import FinalizeRoundButton from './FinalizeRoundButton';
import { SSEStatusBadge } from '@/components/status/SSEStatusBadge';

interface DocumentHeaderProps {
    contractId: string;
    contractTitle: string;
    contractStatus?: string | null;
    isSSEConnected: boolean;
    isFallbackPolling: boolean;
    waitingForRealtime: boolean;
    isLoading: boolean;
    loadingStage: string;
    allResolved: boolean;
    pendingIssueCount: number;
    nextVersionNumber: number;
    viewMode: 'v1' | 'v2' | 'v3';
    onViewModeChange: (mode: 'v1' | 'v2' | 'v3') => void;
    resolvedCount: number;
    totalCount: number;
    resolutionPct: number;
}

export default function DocumentHeader({
    contractId,
    contractTitle,
    contractStatus,
    isSSEConnected,
    isFallbackPolling,
    waitingForRealtime,
    isLoading,
    loadingStage,
    allResolved,
    pendingIssueCount,
    nextVersionNumber,
    viewMode,
    onViewModeChange,
    resolvedCount,
    totalCount,
    resolutionPct,
}: DocumentHeaderProps) {
    return (
        <header className="mb-12 text-center">
            <h1 className="font-serif text-2xl font-light text-zinc-100 tracking-tight mb-2">{contractTitle}</h1>
            <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500 mb-6">Negotiation War Room Diff</p>
            <div className="mb-4 flex items-center justify-center gap-3">
                <SSEStatusBadge isConnected={isSSEConnected} isFallbackPolling={isFallbackPolling} />
                {(waitingForRealtime || isLoading) && (
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">{loadingStage}</span>
                )}
            </div>

            <div className="mb-6 flex items-center justify-center">
                <FinalizeRoundButton
                    contractId={contractId}
                    contractStatus={contractStatus}
                    allResolved={allResolved}
                    pendingIssueCount={pendingIssueCount}
                    nextVersionNumber={nextVersionNumber}
                />
            </div>

            {/* ENHANCEMENT 3: VIEW MODE TOGGLE */}
            <div className="inline-flex bg-[#141414] border border-zinc-800/80 rounded-lg p-1.5 shadow-inner mx-auto mb-4">
                <button
                    onClick={() => onViewModeChange('v1')}
                    className={`px-6 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${viewMode === 'v1'
                            ? 'bg-zinc-800 text-zinc-200 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                >
                    V1 Original
                </button>
                <button
                    onClick={() => onViewModeChange('v2')}
                    className={`px-6 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${viewMode === 'v2'
                            ? 'bg-[#1a1410] text-[#D4AF37] border border-[#D4AF37]/20 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                >
                    V2 Counterparty
                </button>
                <button
                    onClick={() => onViewModeChange('v3')}
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
                            {resolvedCount} of {totalCount} deviations resolved ({resolutionPct}%)
                        </span>
                    </span>
                )}
            </div>
        </header>
    );
}
