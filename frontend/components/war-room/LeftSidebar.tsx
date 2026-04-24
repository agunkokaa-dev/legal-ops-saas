'use client'


import FinalizeForSigningCard from './FinalizeForSigningCard';
import UploadNextVersionButton from './UploadNextVersionButton';
import type { ContractVersion, DiffDeviation } from './warRoomTypes';

interface LeftSidebarProps {
    contractId: string;
    matterId: string;
    viewMode: 'v1' | 'v2' | 'v3';
    onViewModeChange: (mode: 'v1' | 'v2' | 'v3') => void;
    v3Working?: ContractVersion | null;
    allResolved: boolean;
    unresolvedCritical: number;
    pendingIssueCount: number;
    onVersionUploaded: () => Promise<void> | void;
    onAfterFinalize: () => Promise<void> | void;
    sortedDeviations: DiffDeviation[];
    selectedDevId: string | null;
    onSelectDeviation: (id: string) => void;
    issueStatuses: Record<string, string>;
    severityFilters: Record<string, boolean>;
    setSeverityFilters: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    statusFilter: string | null;
    setStatusFilter: React.Dispatch<React.SetStateAction<string | null>>;
    criticalCount: number;
    warningCount: number;
    unresolvedCount: number;
    underReviewCount: number;
    resolvedCount: number;
    roundSummary: {
        totalChanges: number;
        highRiskCount: number;
        pendingCount: number;
        acceptedCount: number;
        conflictCount: number;
    };
    resolutionPct: number;
    acceptedCount: number;
    pendingCount: number;
    conflictCount: number;
}

export default function LeftSidebar({
    contractId,
    matterId,
    viewMode,
    onViewModeChange,
    v3Working,
    allResolved,
    unresolvedCritical,
    pendingIssueCount,
    onVersionUploaded,
    onAfterFinalize,
    sortedDeviations,
    selectedDevId,
    onSelectDeviation,
    issueStatuses,
    severityFilters,
    setSeverityFilters,
    statusFilter,
    setStatusFilter,
    criticalCount,
    warningCount,
    unresolvedCount,
    underReviewCount,
    resolvedCount,
    roundSummary,
    resolutionPct,
    acceptedCount,
    pendingCount,
    conflictCount,
}: LeftSidebarProps) {

    return (
        <aside className="w-[280px] flex-shrink-0 border-r border-zinc-800/60 overflow-y-auto flex flex-col bg-[#0D0D14] custom-scrollbar">
            <div className="p-6 pb-4">
                <h4 className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase font-bold mb-4">Lineage Overview</h4>
                <div className="space-y-3 mb-6">
                    <div
                        className={`p-3 rounded flex justify-between items-center opacity-70 cursor-pointer transition-all ${viewMode === 'v1' ? 'bg-[#141414] border-2 border-[#D4AF37]/40 shadow-[0_0_15px_rgba(212,175,55,0.05)]' : 'bg-[#111] border border-zinc-800/60 hover:opacity-100 hover:border-zinc-600'}`}
                        onClick={() => onViewModeChange('v1')}
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
                        onClick={() => onViewModeChange('v2')}
                    >
                        <div>
                            <span className={`text-xs font-bold font-serif block break-words max-w-[120px] ${viewMode === 'v2' ? 'text-[#D4AF37]' : 'text-zinc-500'}`}>Round 1 (V2)</span>
                            <span className="text-[9px] text-zinc-500 uppercase">Counterparty Upload</span>
                        </div>
                        <span className="text-[10px] bg-[#D4AF37]/10 text-[#D4AF37] px-2 flex-shrink-0 py-0.5 rounded border border-[#D4AF37]/20">Active Diff</span>
                    </div>

                    {v3Working && (
                        <>
                            <div className="w-0.5 h-4 bg-[#D4AF37]/40 ml-6"></div>
                            <div
                                className={`bg-[#141414] border-y border-r border-zinc-800/40 border-l-2 border-l-emerald-900/60 rounded-lg p-3 flex justify-between items-center cursor-pointer transition-all ${viewMode === 'v3' ? 'shadow-[0_0_15px_rgba(16,185,129,0.05)] bg-[#141414]' : 'opacity-80 hover:opacity-100'}`}
                                onClick={() => onViewModeChange('v3')}
                            >
                                <div>
                                    <span className="text-xs text-zinc-300 font-medium block break-words max-w-[120px]">Working Draft (V3)</span>
                                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest block">MERGED</span>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Round Summary — directly after Lineage, always in viewport */}
            <div className="px-5 py-4 border-y border-zinc-800/60 bg-[#0D0D14]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                    Round 1 Summary
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                    {[
                        { label: 'Total', value: roundSummary.totalChanges, color: 'text-white' },
                        { label: 'High Risk', value: roundSummary.highRiskCount, color: 'text-red-400' },
                        { label: 'Pending', value: roundSummary.pendingCount, color: 'text-amber-400' },
                        { label: 'Accepted', value: roundSummary.acceptedCount, color: 'text-emerald-400' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="text-center bg-zinc-800/40 rounded-lg py-2 px-1">
                            <div className={`text-lg font-bold leading-none ${color}`}>{value}</div>
                            <div className="text-[9px] text-zinc-600 mt-0.5 leading-tight">{label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Progress to Finalization */}
            <div className="px-5 py-4 border-b border-zinc-800/60 bg-[#0D0D14]">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Progress to Finalization
                    </p>
                    <span className="text-sm font-bold text-white">{resolutionPct}%</span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                            width: `${resolutionPct}%`,
                            background: 'linear-gradient(to right, #f59e0b, #10b981)',
                        }}
                    />
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {acceptedCount} Accepted
                    </span>
                    <span className="flex items-center gap-1 text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {pendingCount} Pending
                    </span>
                    {conflictCount > 0 && (
                        <span className="flex items-center gap-1 text-red-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            {conflictCount} Conflict
                        </span>
                    )}
                </div>
            </div>

            <UploadNextVersionButton
                matterId={matterId}
                contractId={contractId}
                onUploaded={onVersionUploaded}
            />

            <FinalizeForSigningCard
                contractId={contractId}
                allResolved={allResolved}
                unresolvedCritical={unresolvedCritical}
                pendingIssueCount={pendingIssueCount}
                onAfterFinalize={onAfterFinalize}
            />

            {/* DEVIATION NAVIGATOR */}
            <div className="p-6 pt-4 flex-1 flex flex-col min-h-0">
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
                                    onSelectDeviation(dev.deviation_id);
                                    const el = document.getElementById(`dev-${dev.deviation_id}`);
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }}
                                className={`border-l-4 ${statusMeta.border} p-3 rounded-lg cursor-pointer transition-all ${statusMeta.dim ? 'opacity-60' : 'opacity-100'} ${isSelected
                                    ? `bg-[#1a1a1a] shadow-sm ring-1 ${severityTone.selected}`
                                    : 'bg-[#0f0f0f] border border-zinc-800/40 hover:border-zinc-700/60'
                                    }`}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${severityTone.dot}`}></span>
                                    <h5 className="text-xs font-semibold text-zinc-200 truncate flex-1">{dev.title}</h5>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border border-zinc-800 bg-zinc-900/50 ${severityTone.text}`}>
                                            {dev.category} - {dev.severity}
                                        </span>
                                        <span className="text-[10px]" title="War Room Context"></span>
                                    </div>
                                </div>
                                <div className="mt-2 text-[10px] text-zinc-400">
                                    STATUS: <span className="uppercase tracking-wider">{statusMeta.label.replace(/^[✓✗↩●⬆]\s*/, '')}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>


        </aside>
    );
}
