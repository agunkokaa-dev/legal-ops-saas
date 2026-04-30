import Link from 'next/link'
import DownloadButton from '@/components/war-room/DownloadButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function WarRoomFinalizedPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ versionId?: string; versionNumber?: string }>
}) {
    const resolvedParams = await params
    const resolvedSearchParams = await searchParams

    const contractId = resolvedParams.id
    const versionId = resolvedSearchParams.versionId || ''
    const versionNumber = Number(resolvedSearchParams.versionNumber || '0') || null

    return (
        <main className="min-h-screen bg-[#0a0a0a] px-6 py-12 text-zinc-100">
            <div className="mx-auto max-w-3xl rounded-3xl border border-zinc-800 bg-[#0f0f0f] p-8 shadow-[0_25px_80px_-30px_rgba(0,0,0,0.8)]">
                <div className="mb-6 flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
                        <span className="material-symbols-outlined text-emerald-400">task_alt</span>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Finalize Complete</p>
                        <h1 className="mt-2 text-2xl font-semibold text-zinc-50">
                            {versionNumber ? `Round V${versionNumber} Berhasil Difinalisasi` : 'Round Berhasil Difinalisasi'}
                        </h1>
                    </div>
                </div>

                <div className="mb-6 rounded-2xl border border-zinc-800 bg-[#121212] p-6">
                    <h2 className="mb-4 text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">Download Untuk Dikirim</h2>
                    <div className="grid gap-3 md:grid-cols-2">
                        <DownloadButton
                            contractId={contractId}
                            versionId={versionId}
                            versionNumber={versionNumber}
                            format="docx"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-sm font-semibold text-zinc-100 transition hover:border-[#B8B8B8]/40 hover:bg-zinc-800"
                        />
                        <DownloadButton
                            contractId={contractId}
                            versionId={versionId}
                            versionNumber={versionNumber}
                            format="pdf"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-sm font-semibold text-zinc-100 transition hover:border-[#B8B8B8]/40 hover:bg-zinc-800"
                        />
                    </div>
                </div>

                <div className="mb-8 rounded-2xl border border-zinc-800 bg-[#111] p-6">
                    <h2 className="mb-4 text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">Langkah Selanjutnya</h2>
                    <ol className="space-y-2 text-sm text-zinc-300">
                        <li>1. Kirim versi finalized ini ke counterparty melalui email.</li>
                        <li>2. Tunggu versi balasan dari counterparty.</li>
                        <li>3. Upload response berikutnya untuk memulai round negosiasi baru.</li>
                    </ol>
                </div>

                <div className="flex flex-wrap gap-3">
                    <Link
                        href={`/dashboard/contracts/${contractId}`}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
                    >
                        Lihat Detail Kontrak
                    </Link>
                    <Link
                        href={`/dashboard/contracts/${contractId}`}
                        className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
                    >
                        Upload Counterparty Response
                    </Link>
                </div>
            </div>
        </main>
    )
}
