'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { getPublicApiBase } from '@/lib/public-api-base';
import DownloadButton from '@/components/war-room/DownloadButton';

interface ContractVersion {
    id: string;
    version_number: number;
    risk_score: number;
    risk_level: string;
    uploaded_filename: string;
    created_at: string;
    source?: string | null;
    finalized_at?: string | null;
    finalized_by?: string | null;
}

function sourceLabel(source?: string | null) {
    switch (source) {
        case 'internal_finalized':
            return { label: 'Finalized by us', className: 'border border-emerald-700/50 text-emerald-300 bg-emerald-950/30' };
        case 'counterparty_upload':
            return { label: 'Counterparty', className: 'border border-[#3A3A3A] text-[#D4D4D4] bg-[#1C1C1C]' };
        default:
            return { label: 'Uploaded', className: 'border border-zinc-700 text-zinc-300 bg-zinc-900' };
    }
}

export default function ContractGenealogyTab({
    contractId,
    contractStatus,
}: {
    contractId: string
    contractStatus?: string | null
}) {
    const { getToken } = useAuth();
    const router = useRouter();
    
    const [versions, setVersions] = useState<ContractVersion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!contractId) return;
        
        const fetchVersions = async () => {
            try {
                const token = await getToken();
                const apiUrl = getPublicApiBase();
                
                const res = await fetch(`${apiUrl}/api/v1/negotiation/${contractId}/versions`, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });

                if (!res.ok) throw new Error('Failed to fetch version genealogy');
                
                const data = await res.json();
                
                // Sort descending to show newest version at the top of the timeline
                const sorted = (data.versions || []).sort((a: ContractVersion, b: ContractVersion) => b.version_number - a.version_number);
                setVersions(sorted);
            } catch (err: any) {
                setError(err.message || 'An error occurred');
            } finally {
                setIsLoading(false);
            }
        };

        fetchVersions();
    }, [contractId, getToken]);

    // Format date string beautifully
    const formatDate = (ds: string) => {
        if (!ds) return 'Unknown Date';
        const d = new Date(ds);
        return new Intl.DateTimeFormat('id-ID', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                <div className="w-8 h-8 border-2 border-[#B8B8B8]/20 border-t-[#B8B8B8] rounded-full animate-spin mb-4" />
                <p className="text-xs uppercase tracking-widest font-bold">Tracing Lineage...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-red-500">
                <span className="material-symbols-outlined text-4xl mb-4 opacity-50">error</span>
                <p className="text-xs">{error}</p>
            </div>
        );
    }

    if (versions.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                <span className="material-symbols-outlined text-4xl mb-4 opacity-50">account_tree</span>
                <p className="text-xs">No version lineage found.</p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-5 relative custom-scrollbar">
            <h3 className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase font-bold mb-6">Contract Lineage</h3>
            
            <div className="flex flex-col relative">
                {versions.map((v, index) => {
                    const isLatest = index === 0;
                    
                    return (
                        <div key={v.id} className="relative flex gap-4 mb-4 z-10">
                            
                            {/* Connector Line (drawn behind from current node to the next) */}
                            {index < versions.length - 1 && (
                                <div className="absolute left-[15px] top-6 bottom-[-32px] w-[2px] border-l border-dashed border-zinc-700 -z-10" />
                            )}

                            {/* Node Bubble */}
                            <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-zinc-800 flex items-center justify-center shrink-0 mt-1 z-10 shadow-lg">
                                <span className={`text-[10px] font-bold ${isLatest ? 'text-[#B8B8B8]' : 'text-zinc-500'}`}>
                                    V{v.version_number}
                                </span>
                            </div>

                            {/* Node Card */}
                            <div
                                className={`flex-1 p-4 rounded-xl transition-all duration-300 group
                                    ${isLatest 
                                        ? 'bg-[#141414] border border-[#B8B8B8]/40 shadow-[0_0_15px_rgba(184, 184, 184,0.05)] hover:border-[#B8B8B8]'
                                        : 'bg-[#0a0a0a] border border-white/5 hover:border-white/20 hover:bg-[#141414]'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="pr-3">
                                        <h4 className={`text-xs font-bold ${isLatest ? 'text-white' : 'text-zinc-300'} group-hover:text-[#B8B8B8] transition-colors truncate max-w-[180px]`} title={v.uploaded_filename || 'Unknown Document'}>
                                            V{v.version_number} {v.uploaded_filename || 'Unknown Document'}
                                        </h4>
                                        <p className="mt-1 text-[10px] text-zinc-500">
                                            {v.source === 'internal_finalized' && v.finalized_at
                                                ? `Finalized ${formatDate(v.finalized_at)}`
                                                : `Uploaded ${formatDate(v.created_at)}`}
                                            {v.finalized_by ? ` • ${v.finalized_by}` : ''}
                                        </p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${sourceLabel(v.source).className}`}>
                                        {sourceLabel(v.source).label}
                                    </span>
                                </div>
                                
                                <div className="mt-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded">
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                            v.risk_level === 'High' ? 'bg-rose-500' :
                                            v.risk_level === 'Medium' ? 'bg-amber-500' :
                                            'bg-emerald-500'
                                        }`} />
                                        <span className={`text-[9px] font-bold uppercase tracking-wider ${
                                            v.risk_level === 'High' ? 'text-rose-400' :
                                            v.risk_level === 'Medium' ? 'text-amber-400' :
                                            'text-emerald-400'
                                        }`}>
                                            Risk: {Math.round(v.risk_score)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/dashboard/contracts/${contractId}/war-room`)}
                                        className="text-[10px] uppercase tracking-widest text-[#B8B8B8] transition hover:text-[#B8B8B8]"
                                    >
                                        War Room
                                    </button>
                                </div>

                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    <DownloadButton
                                        contractId={contractId}
                                        versionId={v.id}
                                        versionNumber={v.version_number}
                                        format="docx"
                                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
                                    />
                                    <DownloadButton
                                        contractId={contractId}
                                        versionId={v.id}
                                        versionNumber={v.version_number}
                                        format="pdf"
                                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {versions.length > 1 && (
                <div className="mt-8 p-4 bg-[#B8B8B8]/5 border border-[#B8B8B8]/20 rounded-lg flex items-center justify-between cursor-pointer hover:bg-[#B8B8B8]/10 transition-colors"
                     onClick={() => router.push(`/dashboard/contracts/${contractId}/war-room`)}>
                    <div className="flex flex-col">
                        <span className="text-[#B8B8B8] text-xs font-bold">Open War Room</span>
                        <span className="text-zinc-500 text-[10px]">Compare {versions.length} versions</span>
                    </div>
                    <span className="material-symbols-outlined text-[#B8B8B8]">chevron_right</span>
                </div>
            )}

            {String(contractStatus || '').toLowerCase() === 'awaiting_counterparty' && (
                <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('contract-detail:upload-next-version'))}
                    className="mt-4 w-full rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 text-left transition hover:bg-emerald-950/30"
                >
                    <span className="block text-xs font-semibold text-emerald-300">Upload Counterparty Response</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-widest text-emerald-400/70">
                        Start the next negotiation round
                    </span>
                </button>
            )}
        </div>
    );
}
