import ReactMarkdown from 'react-markdown';
import WordDiff from './WordDiff';
import type { BATNAFallback, DiffDeviation } from './warRoomTypes';

interface V2ContextualDiffViewProps {
    v2RawText?: string;
    deviations: DiffDeviation[];
    selectedDevId: string | null;
    onSelectDeviation: (id: string) => void;
    issueStatuses: Record<string, string>;
    severityFilters: Record<string, boolean>;
    statusFilter: string | null;
    batnaFallbacks: BATNAFallback[];
    structuralChangeDeviationIds: Set<string>;
    viewMode: 'v2' | 'v3';
    resolvedStatuses: Set<string>;
}

const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 className="mb-4 text-2xl font-bold leading-tight text-white">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 className="mt-6 mb-3 text-base font-semibold text-white">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 className="mt-5 mb-2 text-sm font-semibold text-white">{children}</h3>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
        <p className="mb-3 text-sm leading-relaxed text-zinc-300">{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-300">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-zinc-300">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
        <li className="text-sm leading-relaxed text-zinc-300">{children}</li>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-semibold text-white">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
        <em className="italic text-zinc-200">{children}</em>
    ),
    hr: () => <hr className="my-5 border-zinc-800/60" />,
    blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="my-4 border-l-2 border-zinc-700/60 pl-4 text-sm text-zinc-400">
            {children}
        </blockquote>
    ),
};

function getCategoryBadgeClass(category: string): string {
    if (category === 'Added') {
        return 'bg-emerald-500/20 text-emerald-400';
    }
    if (category === 'Removed') {
        return 'bg-red-500/20 text-red-400';
    }
    if (category === 'Modified') {
        return 'bg-[#1C1C1C] text-[#B8B8B8]';
    }
    if (category === 'Unchanged-Risk') {
        return 'bg-violet-500/20 text-violet-400';
    }
    return 'bg-zinc-800 text-zinc-300';
}

function renderMarkdownSegment(markdown: string, key: string) {
    return (
        <div key={key} className="my-4">
            <ReactMarkdown components={markdownComponents}>
                {markdown}
            </ReactMarkdown>
        </div>
    );
}

export default function V2ContextualDiffView({
    v2RawText,
    deviations,
    selectedDevId,
    onSelectDeviation,
    issueStatuses,
    severityFilters,
    statusFilter,
    batnaFallbacks,
    structuralChangeDeviationIds,
    viewMode,
    resolvedStatuses,
}: V2ContextualDiffViewProps) {
    const renderModifiedDeviationDiff = (deviation: DiffDeviation) => {
        const showStructuralChange = structuralChangeDeviationIds.has(deviation.deviation_id);

        return (
            <div className="mb-4 text-left">
                <WordDiff
                    oldText={deviation.v1_text}
                    newText={deviation.v2_text}
                    title={deviation.title}
                    category={deviation.category}
                    roundNumber={1}
                    showStructuralChangeBadge={showStructuralChange}
                />
            </div>
        );
    };

    const getDeviationCardClass = (isSelected: boolean, deviation: DiffDeviation) =>
        `deviation-block my-3 overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900/60 transition-all duration-300 ${
            isSelected ? 'ring-1 ring-white/20' : 'opacity-90 hover:opacity-100'
        } ${
            (!isSelected && Object.values(severityFilters).some(v => v) && !severityFilters[deviation.severity]) ||
            (!isSelected && statusFilter === 'unresolved' && resolvedStatuses.has(issueStatuses[deviation.deviation_id] || 'open')) ||
            (!isSelected && statusFilter && statusFilter !== 'unresolved' && issueStatuses[deviation.deviation_id] !== statusFilter)
                ? 'opacity-30 grayscale'
                : ''
        }`;

    if (!v2RawText) return <p className="text-zinc-500 italic">No raw text available for V2.</p>;

    const deviationsWithCoords = deviations.filter(d => d.v2_coordinates);
    const unmappedDeviations = deviations.filter(d => !d.v2_coordinates);

    deviationsWithCoords.sort((a, b) => (a.v2_coordinates?.start_char || 0) - (b.v2_coordinates?.start_char || 0));

    let lastIndex = 0;
    const elements: React.ReactNode[] = [];

    // Render unmapped deviations at the top (e.g. Removed categories without V2 coordinates)
    if (unmappedDeviations.length > 0) {
        elements.push(
            <div key="unmapped" className="mb-8 space-y-6 rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-6 shadow-xl">
                <h3 className="flex items-center gap-2 border-b border-zinc-800/60 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    <span className="material-symbols-outlined text-xs">playlist_remove</span>
                    Unmapped / Global Deviations
                </h3>
                {unmappedDeviations.map(dev => {
                    const isSelected = selectedDevId === dev.deviation_id;
                    const severityIcon = dev.category === 'Added' ? '🟢' : dev.severity === 'critical' ? '🔴' : dev.severity === 'warning' ? '🟡' : '🔵';
                    const dStatus = viewMode === 'v3' ? issueStatuses[dev.deviation_id] : null;

                    return (
                        <div
                            key={`dev-${dev.deviation_id}`}
                            id={`dev-${dev.deviation_id}`}
                            onClick={(e) => { e.stopPropagation(); onSelectDeviation(dev.deviation_id); }}
                            className={getDeviationCardClass(isSelected, dev)}
                            style={{ cursor: 'pointer' }}
                        >
                            {/* Deviation Header */}
                            <div className="deviation-header flex items-center justify-between gap-3 border-b border-zinc-800/60 px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-[12px]">{severityIcon}</span>
                                    <span className="deviation-title text-[13px] font-semibold text-zinc-100">{dev.title}</span>
                                </div>
                                <span className={`category-badge rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${getCategoryBadgeClass(dev.category)}`}>
                                    {dev.category}
                                </span>
                            </div>

                            {dev.category === 'Removed' ? (
                                <div className="px-4 py-3">
                                    <div className="flex items-start gap-3 rounded-lg border border-zinc-800/60 bg-black/10 px-4 py-3">
                                        <span className="mr-1 mt-0.5 text-xs font-mono text-zinc-500">-</span>
                                        <div className="flex-1">
                                            <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Removed clause</p>
                                            <p className="text-sm leading-relaxed text-red-400 line-through decoration-red-400/70">
                                                {dev.v1_text}
                                            </p>
                                        </div>
                                        <span className="shrink-0 rounded bg-red-500/20 px-2 py-1 text-[10px] font-semibold text-red-400">
                                            Removed
                                        </span>
                                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                                    </div>
                                </div>
                            ) : (
                                <div className="px-4 py-3">
                                    {(() => {
                                        if (dStatus === 'accepted') {
                                            return (
                                                <div className="mt-3">
                                                    <div className="text-[10px] font-bold text-emerald-500/90 mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                                        <span className="material-symbols-outlined text-[13px]">check_circle</span> Accepted (V2 Merged)
                                                    </div>
                                                    <p className="font-sans text-[13px] text-zinc-300 italic">{dev.v2_text}</p>
                                                </div>
                                            );
                                        } else if (dStatus === 'rejected') {
                                            return (
                                                <div className="mt-3">
                                                    <div className="text-[10px] font-bold text-rose-500/90 mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                                        <span className="material-symbols-outlined text-[13px]">cancel</span> Rejected (Reverted to V1)
                                                    </div>
                                                    <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-rose-500/30 mb-2">{dev.v2_text}</p>
                                                    <p className="font-sans text-[13px] text-zinc-300">{dev.v1_text || 'Removed Clause'}</p>
                                                </div>
                                            );
                                        } else if (dStatus === 'countered') {
                                            const resolvedBatna = batnaFallbacks.find(b => b.deviation_id === dev.deviation_id);
                                            return (
                                                <div className="mt-3">
                                                    <div className="text-[10px] font-bold text-[#B8B8B8] mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                                        <span className="material-symbols-outlined text-[13px]">reply</span> Countered (BATNA Inserted)
                                                    </div>
                                                    <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-zinc-600 mb-2">{dev.v2_text}</p>
                                                    <p className="font-sans text-[13px] text-zinc-300 font-medium">{resolvedBatna?.fallback_clause || dev.v1_text}</p>
                                                </div>
                                            );
                                        } else if (dStatus === 'escalated') {
                                            return (
                                                <div className="mt-3">
                                                    <div className="text-[10px] font-bold text-violet-400/90 mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                                        <span className="material-symbols-outlined text-[13px]">link</span> Escalated to Task
                                                    </div>
                                                    <p className="font-sans text-[13px] text-zinc-300">{dev.v2_text}</p>
                                                </div>
                                            );
                                        }

                                        // Default State (v2 or v3 Unresolved)
                                        return (
                                            <div>
                                                {dev.category === 'Modified' ? (
                                                    renderModifiedDeviationDiff(dev)
                                                ) : (
                                                    <div className="deviation-text font-sans text-[14px] leading-[1.6] text-emerald-400">
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
            elements.push(renderMarkdownSegment(v2RawText.slice(lastIndex, start), `text-${lastIndex}`));
        }

        const isSelected = selectedDevId === dev.deviation_id;
        const severityIcon = dev.category === 'Added' ? '🟢' : dev.severity === 'critical' ? '🔴' : dev.severity === 'warning' ? '🟡' : '🔵';

        const dStatus = viewMode === 'v3' ? issueStatuses[dev.deviation_id] : null;

        // Contextual Deviation Box
        elements.push(
            <div
                key={`dev-${dev.deviation_id}`}
                id={`dev-${dev.deviation_id}`}
                onClick={(e) => { e.stopPropagation(); onSelectDeviation(dev.deviation_id); }}
                className={getDeviationCardClass(isSelected, dev)}
                style={{ cursor: 'pointer' }}
            >
                {/* Deviation Header */}
                <div className="deviation-header flex items-center justify-between gap-3 border-b border-zinc-800/60 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-[12px]">{severityIcon}</span>
                        <span className="deviation-title text-zinc-100 font-semibold text-[13px]">{dev.title}</span>
                    </div>
                    <span className={`category-badge rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${getCategoryBadgeClass(dev.category)}`}>
                        {dev.category}
                    </span>
                </div>

                <div className="px-4 py-3">
                    {(() => {
                        if (dStatus === 'accepted') {
                            return (
                                <div className="mt-3">
                                    <div className="text-[10px] font-bold text-emerald-500/90 mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[13px]">check_circle</span> Accepted (V2 Merged)
                                    </div>
                                    <p className="font-sans text-[13px] text-zinc-300 italic">{dev.v2_text}</p>
                                </div>
                            );
                        } else if (dStatus === 'rejected') {
                            return (
                                <div className="mt-3">
                                    <div className="text-[10px] font-bold text-rose-500/90 mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[13px]">cancel</span> Rejected (Reverted to V1)
                                    </div>
                                    <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-rose-500/30 mb-2">{dev.v2_text}</p>
                                    <p className="font-sans text-[13px] text-zinc-300">{dev.v1_text || 'Removed Clause'}</p>
                                </div>
                            );
                        } else if (dStatus === 'countered') {
                            const resolvedBatna = batnaFallbacks.find(b => b.deviation_id === dev.deviation_id);
                            return (
                                <div className="mt-3">
                                    <div className="text-[10px] font-bold text-[#B8B8B8] mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[13px]">reply</span> Countered (BATNA Inserted)
                                    </div>
                                    <p className="font-sans text-[13px] text-zinc-500 italic line-through decoration-zinc-600 mb-2">{dev.v2_text}</p>
                                    <p className="font-sans text-[13px] text-zinc-300 font-medium">{resolvedBatna?.fallback_clause || dev.v1_text}</p>
                                </div>
                            );
                        } else if (dStatus === 'escalated') {
                            return (
                                <div className="mt-3">
                                    <div className="text-[10px] font-bold text-violet-400/90 mb-2 tracking-wider uppercase flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[13px]">link</span> Escalated to Task
                                    </div>
                                    <p className="font-sans text-[13px] text-zinc-300">{dev.v2_text}</p>
                                </div>
                            );
                        }

                        // Default State (v2 or v3 Unresolved)
                        return (
                            <div>
                                {dev.category === 'Modified' ? (
                                    renderModifiedDeviationDiff(dev)
                                ) : (
                                    <div className={`deviation-text font-sans text-[14px] leading-[1.6] ${
                                        dev.category === 'Added'
                                            ? 'text-emerald-400'
                                            : dev.category === 'Removed'
                                                ? 'text-red-400 line-through'
                                                : 'text-zinc-200'
                                    }`}>
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
    if (lastIndex < v2RawText.length) {
        elements.push(renderMarkdownSegment(v2RawText.slice(lastIndex), `text-${lastIndex}`));
    }

    return (
        <div className="mx-auto max-w-3xl bg-[#0A0A0F] px-8 py-8 pb-[20vh] text-zinc-200">
            {elements}
        </div>
    );
}
