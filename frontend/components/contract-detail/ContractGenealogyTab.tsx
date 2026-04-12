'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { getPublicApiBase } from '@/lib/public-api-base';

interface ContractVersion {
    id: string;
    version_number: number;
    risk_score: number;
    risk_level: string;
    uploaded_filename: string;
    created_at: string;
}

export default function ContractGenealogyTab({ contractId }: { contractId: string }) {
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
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                <div className="w-8 h-8 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin mb-4" />
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
                                <span className={`text-[10px] font-bold ${isLatest ? 'text-[#D4AF37]' : 'text-zinc-500'}`}>
                                    V{v.version_number}
                                </span>
                            </div>

                            {/* Node Card */}
                            <div 
                                onClick={() => router.push(`/dashboard/contracts/${contractId}/war-room`)}
                                className={`flex-1 p-4 rounded-xl cursor-pointer transition-all duration-300 group
                                    ${isLatest 
                                        ? 'bg-[#141414] border border-[#D4AF37]/40 shadow-[0_0_15px_rgba(212,175,55,0.05)] hover:border-[#D4AF37]' 
                                        : 'bg-[#0a0a0a] border border-white/5 hover:border-white/20 hover:bg-[#141414]'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className={`text-xs font-bold ${isLatest ? 'text-white' : 'text-zinc-300'} group-hover:text-[#D4AF37] transition-colors truncate max-w-[180px]`} title={v.uploaded_filename || 'Unknown Document'}>
                                        {v.uploaded_filename || 'Unknown Document'}
                                    </h4>
                                    {isLatest && versions.length === 1 ? (
                                        <span className="bg-[#D4AF37]/10 text-[#D4AF37] text-[9px] px-2 py-0.5 rounded uppercase font-bold tracking-wider shrink-0">
                                            Current Baseline
                                        </span>
                                    ) : isLatest ? (
                                        <span className="bg-[#D4AF37]/10 text-[#D4AF37] text-[9px] px-2 py-0.5 rounded uppercase font-bold tracking-wider shrink-0">
                                            Active
                                        </span>
                                    ) : null}
                                </div>
                                
                                <div className="flex items-center justify-between mt-3">
                                    <span className="text-[10px] text-zinc-500">
                                        {formatDate(v.created_at)}
                                    </span>
                                    
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
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {versions.length > 1 && (
                <div className="mt-8 p-4 bg-[#D4AF37]/5 border border-[#D4AF37]/20 rounded-lg flex items-center justify-between cursor-pointer hover:bg-[#D4AF37]/10 transition-colors"
                     onClick={() => router.push(`/dashboard/contracts/${contractId}/war-room`)}>
                    <div className="flex flex-col">
                        <span className="text-[#D4AF37] text-xs font-bold">Open War Room</span>
                        <span className="text-zinc-500 text-[10px]">Compare {versions.length} versions</span>
                    </div>
                    <span className="material-symbols-outlined text-[#D4AF37]">chevron_right</span>
                </div>
            )}
        </div>
    );
}
