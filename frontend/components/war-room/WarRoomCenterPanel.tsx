'use client';

import { useMemo } from 'react';
import V2ContextualDiffView from './V2ContextualDiffView';
import V3WorkingDraftView from './V3WorkingDraftView';
import { RESOLVED_STATUSES } from './warRoomUtils';
import type { DiffDeviation, BATNAFallback, ContractVersion } from './warRoomTypes';

interface WarRoomCenterPanelProps {
    // View control
    viewMode: 'v1' | 'v2' | 'v3';
    onViewModeChange: (mode: 'v1' | 'v2' | 'v3') => void;

    // Contract text content
    v1RawText?: string;
    v2RawText?: string;

    // Diff data
    deviations: DiffDeviation[];
    selectedDeviationId: string | null;
    onDeviationSelect: (id: string) => void;
    issueStatuses: Record<string, string>;
    batnaFallbacks: BATNAFallback[];
    severityFilters: Record<string, boolean>;
    statusFilter: string | null;

    // Metadata
    versions: ContractVersion[];
    pendingCount: number;
    contractTitle?: string;
}

export function WarRoomCenterPanel({
    viewMode, onViewModeChange,
    v1RawText, v2RawText,
    deviations, selectedDeviationId, onDeviationSelect,
    issueStatuses, batnaFallbacks, severityFilters, statusFilter,
    versions, pendingCount, contractTitle,
}: WarRoomCenterPanelProps) {

    const v2Version = versions.find(v => v.version_number === 2);
    const displayFilename = v2Version?.uploaded_filename?.split('/').pop()
        || contractTitle
        || 'Contract Document';

    const structuralChangeDeviationIds = useMemo(() => {
        return new Set(
            deviations
                .filter(d => d.category === 'Modified' || d.category === 'Added')
                .map(d => d.deviation_id)
        );
    }, [deviations]);

    const totalChanges = deviations.length;

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0A0A0F]">
            {/* Version tabs */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/60 flex-shrink-0">
                <button
                    onClick={() => onViewModeChange('v1')}
                    className={`flex flex-col items-center px-5 py-2 rounded-lg text-xs transition-all ${viewMode === 'v1' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 border border-transparent'}`}
                >
                    <span className="font-semibold">V1</span>
                    <span className="text-[10px] opacity-70">Baseline</span>
                </button>

                <button
                    onClick={() => onViewModeChange('v2')}
                    className={`flex flex-col items-center px-5 py-2 rounded-lg text-xs transition-all ${viewMode === 'v2' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 border border-transparent'}`}
                >
                    <span className="font-semibold">V2</span>
                    <span className="text-[10px] opacity-70">Counterparty</span>
                </button>

                <button
                    onClick={() => onViewModeChange('v3')}
                    className={`flex flex-col items-center px-5 py-2 rounded-lg text-xs transition-all ${viewMode === 'v3' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 border border-transparent'}`}
                >
                    <span className="font-semibold">V3</span>
                    <span className="text-[10px] opacity-70">Draft</span>
                </button>

                {/* Version metadata */}
                <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                    {viewMode === 'v2' && v2Version && (
                        <>
                            <span>Counterparty Version — Under Review</span>
                            <span className="text-zinc-700">•</span>
                            <span>
                                {v2Version.created_at
                                    ? new Date(v2Version.created_at).toLocaleDateString('id-ID', {
                                        day: 'numeric', month: 'short', year: 'numeric'
                                    })
                                    : ''}
                            </span>
                        </>
                    )}
                    {viewMode === 'v1' && (
                        <span>Baseline Version</span>
                    )}
                    {viewMode === 'v3' && (
                        <span>Working Draft</span>
                    )}
                </div>
            </div>

            {/* Main content area — scrollable */}
            <div className="flex-1 min-h-0 overflow-auto bg-[#0A0A0F]">
                {viewMode === 'v1' && (
                    /* V1 Baseline — plain text, no diff */
                    <div className="mx-auto max-w-4xl p-6">
                        {v1RawText ? (
                            <div className="whitespace-pre-wrap font-['Georgia',serif] text-sm leading-relaxed text-zinc-200">
                                {v1RawText}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-40">
                                <span className="text-zinc-500 text-sm">
                                    Baseline text not available
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {viewMode === 'v2' && (
                    /* V2 Counterparty — inline diff with Removed/Added highlighting */
                    <div className="w-full min-w-0 px-6">
                        <V2ContextualDiffView
                            v2RawText={v2RawText || ''}
                            deviations={deviations}
                            selectedDevId={selectedDeviationId}
                            onSelectDeviation={onDeviationSelect}
                            issueStatuses={issueStatuses}
                            severityFilters={severityFilters}
                            statusFilter={statusFilter}
                            batnaFallbacks={batnaFallbacks}
                            structuralChangeDeviationIds={structuralChangeDeviationIds}
                            viewMode="v2"
                            resolvedStatuses={RESOLVED_STATUSES}
                        />
                    </div>
                )}

                {viewMode === 'v3' && (
                    /* V3 Working Draft — shows decisions applied */
                    <div className="w-full min-w-0 px-6">
                        <V3WorkingDraftView
                            v2RawText={v2RawText || ''}
                            deviations={deviations}
                            issueStatuses={issueStatuses}
                            batnaFallbacks={batnaFallbacks}
                        />
                    </div>
                )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-zinc-800/60 bg-[#0D0D14] px-4 py-2 text-xs text-zinc-500">
                <span>
                    {viewMode === 'v2' ? `${totalChanges} changes detected` : `${pendingCount} pending issues`}
                </span>
                <span>100%</span>
            </div>
        </div>
    );
}
