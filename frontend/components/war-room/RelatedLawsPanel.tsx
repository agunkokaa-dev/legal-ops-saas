import type { LawSearchResult } from '@/types/laws';

interface RelatedLawsPanelProps {
    open: boolean;
    results: LawSearchResult[];
    loading: boolean;
    error: string | null;
    coverageNote: string | null;
    onClose: () => void;
    onOpenNodeDetail?: (nodeId: string) => void;
}

export default function RelatedLawsPanel({
    open,
    results,
    loading,
    error,
    coverageNote,
    onClose,
    onOpenNodeDetail,
}: RelatedLawsPanelProps) {
    if (!open) {
        return null;
    }

    return (
        <aside className="w-[360px] bg-[#0a0a0a] border-l border-zinc-800/40 flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800/40 px-5 py-4">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-[#B8B8B8]">Related Regulations</p>
                    <p className="mt-1 text-xs text-zinc-500">Top 3 articles derived from the selected deviation.</p>
                </div>
                <button
                    onClick={onClose}
                    className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400 transition hover:border-white/20 hover:text-white"
                >
                    Close
                </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
                {loading ? (
                    <div className="text-sm text-zinc-400">Loading related regulations…</div>
                ) : error ? (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
                ) : results.length ? (
                    results.map((result) => (
                        <button
                            key={result.node_id}
                            onClick={() => void onOpenNodeDetail?.(result.node_id)}
                            className="block w-full rounded-xl border border-white/8 bg-white/[0.02] p-4 text-left transition hover:border-white/15 hover:bg-white/[0.04]"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-white">{result.law_short} · {result.identifier_full}</p>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">{result.category}</p>
                                </div>
                                <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-zinc-400">
                                    {result.legal_status}
                                </span>
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-zinc-300">{result.body_snippet}</p>
                        </button>
                    ))
                ) : coverageNote ? (
                    <div className="rounded-xl border border-[#2A2A2A] bg-[#1C1C1C] p-4 text-sm text-[#E8E8E8]">
                        {coverageNote}
                    </div>
                ) : (
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-sm text-zinc-500">
                        No related regulations were returned for this deviation.
                    </div>
                )}
            </div>
        </aside>
    );
}
