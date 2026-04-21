import { notFound } from 'next/navigation';
import WarRoomClient from '@/components/war-room/WarRoomClient';
import { getContractById } from '@/app/actions/documentActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function WarRoomPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = await params;
    const contractId = resolvedParams.id;

    // Fetch the contract record for basic context
    const { data: contract, error } = await getContractById(contractId);

    if (error || !contract) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4 bg-[#0a0a0a]">
                <span className="material-symbols-outlined text-4xl text-red-400">error</span>
                <p className="text-sm">Failed to load contract for War Room.</p>
            </div>
        );
    }

    return (
        <WarRoomClient 
            contractId={contractId} 
            matterId={contract.matter_id}
            contractTitle={contract.title || 'Untitled Contract'}
            contractStatus={contract.status || null}
        />
    );
}
