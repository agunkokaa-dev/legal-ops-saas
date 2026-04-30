import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

    let workingDraftText = v2RawText;

    for (const deviation of mappedDeviations) {
        const coords = deviation.v2_coordinates!;
        const status = issueStatuses[deviation.deviation_id] || 'open';
        const fallback = batnaFallbacks.find((batna) => batna.deviation_id === deviation.deviation_id);

        let replacementText = deviation.v2_text || '';

        if (status === 'accepted') {
            replacementText = deviation.v2_text || '';
        } else if (status === 'rejected') {
            replacementText = deviation.v1_text || deviation.v2_text || '';
        } else if (status === 'countered') {
            replacementText = fallback?.fallback_clause || deviation.v1_text || deviation.v2_text || '';
        }

        workingDraftText = (
            workingDraftText.slice(0, coords.start_char)
            + replacementText
            + workingDraftText.slice(coords.end_char)
        );
    }

    return (
        <div className="max-w-none pb-[20vh] space-y-8">
            {unmappedDeviations.length > 0 && (
                <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-6 shadow-sm">
                    <h3 className="border-b border-zinc-200 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
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
                            <div key={`v3-unmapped-${deviation.deviation_id}`} className="rounded-lg border border-zinc-200 bg-white p-4">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-xs font-semibold text-[#0A0A0A]">{deviation.title}</span>
                                    <span className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${getStatusColor(status)}`}>
                                        {status.replace('_', ' ')}
                                    </span>
                                </div>
                                <div className="prose prose-zinc prose-sm max-w-none prose-headings:text-[#0A0A0A] prose-headings:font-semibold prose-p:text-zinc-700 prose-p:text-[12px] prose-p:leading-relaxed prose-strong:text-[#0A0A0A] prose-li:text-zinc-700">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {displayText || ''}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="prose prose-zinc prose-sm max-w-none font-serif prose-headings:text-[#0A0A0A] prose-p:text-zinc-800 prose-p:leading-[1.85] prose-strong:text-[#0A0A0A] prose-li:text-zinc-800 prose-table:text-zinc-800 prose-th:text-[#0A0A0A] prose-td:border-zinc-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {workingDraftText}
                </ReactMarkdown>
            </div>
        </div>
    );
}
