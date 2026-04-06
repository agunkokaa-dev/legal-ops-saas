import { notFound } from 'next/navigation'
import { getContractById } from '@/app/actions/documentActions'
import { getSigningStatus, runPresignChecklist } from '@/app/actions/signingActions'
import SigningCenterClient from './SigningCenterClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SigningCenterPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id: contractId } = await params

    const { data: contract, error } = await getContractById(contractId)
    if (error || !contract) return notFound()

    const { data: signingStatus } = await getSigningStatus(contractId)
    const { data: checklist } = await runPresignChecklist(contractId)

    return (
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-background w-full">
            <SigningCenterClient
                contract={contract}
                signingStatus={signingStatus}
                initialChecklist={checklist}
            />
        </main>
    )
}
