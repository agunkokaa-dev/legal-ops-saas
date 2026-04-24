'use client'

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { getPublicApiBase } from '@/lib/public-api-base';

interface FinalizeForSigningCardProps {
    contractId: string;
    allResolved: boolean;
    unresolvedCritical: number;
    pendingIssueCount: number;
    onAfterFinalize: () => Promise<void> | void;
}

export default function FinalizeForSigningCard({
    contractId,
    allResolved,
    unresolvedCritical,
    pendingIssueCount,
    onAfterFinalize,
}: FinalizeForSigningCardProps) {
    const { getToken } = useAuth();
    const router = useRouter();
    const [isFinalizing, setIsFinalizing] = useState(false);

    const buildNegotiationApiUrl = (suffix = '') => {
        const apiBase = getPublicApiBase();
        const negotiationBase = apiBase.endsWith('/api/v1')
            ? `${apiBase}/negotiation/${contractId}`
            : `${apiBase}/api/v1/negotiation/${contractId}`;
        return suffix ? `${negotiationBase}/${suffix.replace(/^\/+/, '')}` : negotiationBase;
    };

    const getAuthToken = async () => {
        const token = await getToken();
        if (!token) {
            throw new Error('Authentication failed');
        }
        return token;
    };

    const handleFinalizeForSigning = async () => {
        setIsFinalizing(true);
        try {
            const token = await getAuthToken();
            const res = await fetch(buildNegotiationApiUrl('finalize-for-signing'), {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to finalize contract');

            if (data.ready) {
                toast.success('Contract finalized. Proceeding to signing preparation.');
                router.push(`/dashboard/contracts/${contractId}/signing`);
                return;
            }

            toast.error(data.reason || 'Cannot finalize yet.');
            await onAfterFinalize();
        } catch (error: any) {
            toast.error(error.message || 'Failed to finalize contract');
        } finally {
            setIsFinalizing(false);
        }
    };

    return (
        <div className="rounded-xl border border-zinc-800/50 bg-[#0f0f0f] p-4">
            {allResolved ? (
                <button
                    id="finalize-round"
                    onClick={handleFinalizeForSigning}
                    disabled={isFinalizing}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <span className="material-symbols-outlined text-sm">
                        {isFinalizing ? 'progress_activity' : 'check_circle'}
                    </span>
                    {isFinalizing ? 'Finalizing...' : 'Finalize for Signing'}
                </button>
            ) : (
                <div className="w-full bg-zinc-900 text-zinc-400 py-3 px-4 rounded-lg text-center text-xs">
                    {unresolvedCritical > 0
                        ? `${unresolvedCritical} critical issue(s) must be resolved before signing`
                        : `${pendingIssueCount} issue(s) still pending`}
                </div>
            )}
        </div>
    );
}
