import { getContractById, getGraphData } from '@/app/actions/documentActions';
import { getObligationsByMatter } from '@/app/actions/obligationActions';
import { getNotesByContract } from '@/app/actions/noteActions';
import { getMatterById } from '@/app/actions/matterActions';
import ContractDetailClient from '@/components/contract-detail/ContractDetailClient';
import ContractHeader from '@/components/contract-detail/ContractHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
    // Await params for Next 15+ compatibility
    const resolvedParams = await params;
    const contractId = resolvedParams.id;

    // Fetch contract
    const { data: contract, error } = await getContractById(contractId);

    if (error || !contract) {
        return (
            <div className="h-full flex items-center justify-center text-text-muted">
                Failed to load contract details.
            </div>
        );
    }

    console.log("🔥 [DEBUG] RAW CONTRACT DATA FROM SUPABASE:", JSON.stringify(contract, null, 2));

    // Fetch associated matter to get client name
    const { data: matter } = await getMatterById(contract.matter_id);
    const clientName = matter?.client_name || contract.counterparty_name || 'Unknown Client';

    // Fetch obligations
    const { data: allObligations } = await getObligationsByMatter(contract.matter_id);
    const obligations = allObligations?.filter((o: any) => o.contract_id === contract.id) || [];

    // Fetch notes
    const { data: allNotes } = await getNotesByContract(contract.id);
    const notes = allNotes || [];

    // Fetch genealogy
    const { documents, relationships } = await getGraphData(contract.matter_id);
    const graphDocs = documents || [];
    const graphRels = relationships || [];

    // Safely format date
    const formattedDate = contract.created_at
        ? new Date(contract.created_at).toISOString().split('T')[0]
        : 'Unknown Date';

    // Resolve Supabase Storage public address
    let pdfUrl = contract.file_url;
    if (pdfUrl && !pdfUrl.startsWith('http') && !pdfUrl.startsWith('/')) {
        pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/matter-files/${pdfUrl}`;
    }

    return (
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-background relative w-full">
            {/* Header */}
            <ContractHeader initialContract={contract} formattedDate={formattedDate} />

            {/* Main Content Area */}
            <ContractDetailClient
                pdfUrl={pdfUrl}
                contract={contract}
                obligations={obligations}
                notes={notes}
                clientName={clientName}
                graphDocs={graphDocs}
                graphRels={graphRels}
            />
        </main>
    );
}
