import type { BATNAFallback, DiffDeviation } from './warRoomTypes';
import { getStatusColor } from './warRoomStatus';

interface V3WorkingDraftViewProps {
    v2RawText: string;
    deviations: DiffDeviation[];
    issueStatuses: Record<string, string>;
    batnaFallbacks: BATNAFallback[];
}

export default function V3WorkingDraftView({
    v2RawText,
    deviations,
    issueStatuses,
    batnaFallbacks,
}: V3WorkingDraftViewProps) {
    const mappedDeviations = [...deviations]
        .filter((deviation) => deviation.v2_coordinates)
        .sort((a, b) => (b.v2_coordinates?.start_char || 0) - (a.v2_coordinates?.start_char || 0));
    const unmappedDeviations = deviations.filter((deviation) => !deviation.v2_coordinates);

    let cursor = v2RawText.length;
    const fragments: React.ReactNode[] = [];

    for (const deviation of mappedDeviations) {
        const coords = deviation.v2_coordinates!;
        const trailingText = v2RawText.slice(coords.end_char, cursor);
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
        fragments.unshift(<span key="text-start">{v2RawText.slice(0, cursor)}</span>);
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
}
