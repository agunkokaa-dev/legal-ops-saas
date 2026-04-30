import { getContractById } from '@/app/actions/documentActions';
import { notFound } from 'next/navigation';
import ContractReviewClient from '@/components/contract-review/ContractReviewClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ContractReviewPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = await params;
    const contractId = resolvedParams.id;

    // Fetch the contract record (for matter_id, title, metadata)
    const { data: contract, error } = await getContractById(contractId);

    if (error || !contract) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4 bg-[#0a0a0a]">
                <span className="material-symbols-outlined text-4xl text-red-400">error</span>
                <p className="text-sm">Failed to load contract for review.</p>
                <Link
                    href={`/dashboard/contracts/${contractId}`}
                    className="text-xs text-[#B8B8B8] hover:underline"
                >
                    ← Back to Contract Detail
                </Link>
            </div>
        );
    }

    return (
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0a0a] relative w-full">
            <ContractReviewClient
                contractId={contractId}
                matterId={contract.matter_id}
                contractTitle={contract.title || 'Untitled Contract'}
                contractStatus={contract.status}
            />
        </main>
    );
}
