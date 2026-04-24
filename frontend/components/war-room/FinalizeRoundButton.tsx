'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { finalizeRound, previewFinalizeRound } from '@/app/actions/backend'

type BlockingIssue = {
    issue_id: string
    deviation_id: string
    title: string
    severity: string
    status: string
}

type FinalizePreview = {
    can_finalize: boolean
    blocking_issues: BlockingIssue[]
    decisions_summary: Record<string, number>
    v3_text_preview: string
    v3_text_length: number
    v2_text_length: number
    estimated_changes: number
}

const ALLOWED_STATUSES = new Set([
    'review',
    'reviewed',
    'negotiating',
    'in_negotiation',
])

function DecisionRow({
    label,
    count,
    tone,
}: {
    label: string
    count: number
    tone: string
}) {
    return (
        <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#111] px-3 py-2">
            <span className="text-xs text-zinc-300">{label}</span>
            <span className={`text-xs font-semibold ${tone}`}>{count}</span>
        </div>
    )
}

export default function FinalizeRoundButton({
    contractId,
    contractStatus,
    allResolved,
    pendingIssueCount,
    nextVersionNumber,
    variant = 'default',
    externalOpen,
    onExternalOpenChange,
    hideTrigger = false,
}: {
    contractId: string
    contractStatus?: string | null
    allResolved: boolean
    pendingIssueCount: number
    nextVersionNumber: number
    variant?: 'default' | 'header'
    externalOpen?: boolean
    onExternalOpenChange?: (open: boolean) => void
    hideTrigger?: boolean
}) {
    const router = useRouter()
    const normalizedStatus = String(contractStatus || '').toLowerCase()
    const canRender = ALLOWED_STATUSES.has(normalizedStatus)

    const [internalOpen, setInternalOpen] = useState(false)
    const [isLoadingPreview, setIsLoadingPreview] = useState(false)
    const [preview, setPreview] = useState<FinalizePreview | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [allowPartial, setAllowPartial] = useState(false)
    const [confirmationNote, setConfirmationNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const isOpen = externalOpen ?? internalOpen
    const setIsOpen = onExternalOpenChange ?? setInternalOpen
    const closeModal = () => setIsOpen(false)

    useEffect(() => {
        if (!isOpen) {
            setPreview(null)
            setPreviewError(null)
            setAllowPartial(false)
            setConfirmationNote('')
            setSubmitError(null)
            return
        }

        let cancelled = false
        const loadPreview = async () => {
            setIsLoadingPreview(true)
            setPreviewError(null)
            setSubmitError(null)

            try {
                const result = await previewFinalizeRound(contractId)
                if (cancelled) return

                if (!result.success || !result.data) {
                    const message = result.error || 'Failed to load finalize preview.'
                    setPreview(null)
                    setPreviewError(message)
                    toast.error(message)
                    return
                }

                const nextPreview = result.data as FinalizePreview
                setPreview(nextPreview)
                setAllowPartial(Boolean(nextPreview.blocking_issues?.length))
            } catch (error: unknown) {
                if (cancelled) return
                const message = error instanceof Error ? error.message : 'Failed to load finalize preview.'
                setPreview(null)
                setPreviewError(message)
                toast.error(message)
            } finally {
                if (!cancelled) {
                    setIsLoadingPreview(false)
                }
            }
        }

        void loadPreview()

        return () => {
            cancelled = true
        }
    }, [contractId, isOpen])

    useEffect(() => {
        if (!isOpen) {
            document.body.style.overflow = ''
            return
        }

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = previousOverflow || ''
        }
    }, [isOpen])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                setIsOpen(false)
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen])

    if (!canRender) {
        return null
    }

    const summary = preview?.decisions_summary || {}
    const hasBlockingIssues = Boolean(preview?.blocking_issues?.length)
    // When backend says can_finalize=true (e.g. all-accepted round), trust it
    const hasNoEffectiveChanges = Boolean(preview) && Number(preview?.estimated_changes || 0) === 0 && !preview?.can_finalize
    const isFinalizeDisabled =
        isLoadingPreview ||
        isSubmitting ||
        !preview ||
        Boolean(previewError) ||
        (!allowPartial && hasBlockingIssues) ||
        (hasNoEffectiveChanges && !allowPartial)
    const isHeaderVariant = variant === 'header'

    const handleFinalize = async () => {
        if (!preview || previewError) {
            const message = previewError || 'Finalize preview is unavailable. Try again after reloading the modal.'
            setSubmitError(message)
            toast.error(message)
            return
        }

        if (hasNoEffectiveChanges && !allowPartial) {
            const message = 'Finalize would not change the active draft. Review the negotiation decisions first.'
            setSubmitError(message)
            toast.error(message)
            return
        }

        setIsSubmitting(true)
        setSubmitError(null)

        try {
            const result = await finalizeRound(contractId, allowPartial, confirmationNote || undefined)
            if (!result.success || !result.data) {
                const message = result.error || 'Finalisasi gagal.'
                setSubmitError(message)
                toast.error(message)
                return
            }

            toast.success(`Round V${result.data.version_number} berhasil difinalisasi.`)
            closeModal()
            router.push(
                `/dashboard/contracts/${contractId}/war-room/finalized?versionId=${result.data.version_id}&versionNumber=${result.data.version_number}`,
            )
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Finalisasi gagal.'
            setSubmitError(message)
            toast.error(message)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <>
            {!hideTrigger && (
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className={isHeaderVariant
                        ? `inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all ${allResolved
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500'
                            : 'bg-amber-500 text-black shadow-lg shadow-amber-500/20 hover:bg-amber-400'
                        }`
                        : `inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] transition ${allResolved
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30 hover:bg-emerald-500'
                            : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                        }`}
                >
                    <span className={`material-symbols-outlined text-sm ${isHeaderVariant && !allResolved ? 'text-black' : ''}`}>task_alt</span>
                    {isHeaderVariant
                        ? 'Finalize Round'
                        : (allResolved ? `Finalize Round V${nextVersionNumber}` : `Finalize Round (${pendingIssueCount} pending)`)}
                    {isHeaderVariant && pendingIssueCount > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-xs ${allResolved ? 'bg-black/20 text-white' : 'bg-black/20 text-black'}`}>
                            {pendingIssueCount}
                        </span>
                    )}
                </button>
            )}

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
                        onClick={closeModal}
                    />
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 pointer-events-none">
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="finalize-round-title"
                            className="pointer-events-auto flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-800 bg-[#0d0d0d] shadow-2xl"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex flex-shrink-0 items-start justify-between border-b border-zinc-800 px-6 py-5">
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Finalize Round</p>
                                    <h2 id="finalize-round-title" className="mt-2 text-xl font-semibold text-zinc-100">
                                        Finalisasi Round V{nextVersionNumber}
                                    </h2>
                                    <p className="mt-2 text-sm text-zinc-400">
                                        Ini akan menyimpan versi finalized baru untuk dikirim ke counterparty.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
                                >
                                    Tutup
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6">
                                {isLoadingPreview ? (
                                    <div className="py-12 text-center">
                                        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-[#D4AF37]" />
                                        <p className="text-sm text-zinc-400">Memuat preview finalisasi...</p>
                                    </div>
                                ) : previewError ? (
                                    <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 px-4 py-3 text-sm text-rose-200">
                                        {previewError}
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        {submitError && (
                                            <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 px-4 py-3 text-sm text-rose-200">
                                                {submitError}
                                            </div>
                                        )}

                                        <div className="grid gap-3 md:grid-cols-2">
                                            <DecisionRow label="Diterima" count={summary.accepted || 0} tone="text-emerald-400" />
                                            <DecisionRow label="Ditolak" count={summary.rejected || 0} tone="text-rose-400" />
                                            <DecisionRow label="Counter BATNA" count={summary.countered || 0} tone="text-amber-400" />
                                            <DecisionRow label="Eskalasi" count={summary.escalated || 0} tone="text-blue-400" />
                                        </div>

                                        {hasBlockingIssues ? (
                                            <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
                                                <div className="mb-3 flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-sm text-amber-400">warning</span>
                                                    <span className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">
                                                        {preview?.blocking_issues.length} Deviation Masih Pending
                                                    </span>
                                                </div>
                                                <div className="space-y-2">
                                                    {preview?.blocking_issues.map((issue) => (
                                                        <div key={issue.issue_id} className="rounded-lg border border-zinc-800 bg-[#111] px-3 py-2">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <span className="text-sm text-zinc-200">{issue.title}</span>
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${issue.severity === 'critical'
                                                                    ? 'border border-rose-900/50 text-rose-300'
                                                                    : 'border border-amber-900/50 text-amber-300'
                                                                    }`}>
                                                                    {issue.severity}
                                                                </span>
                                                            </div>
                                                            <p className="mt-1 text-xs text-zinc-500">Status: {issue.status.replace('_', ' ')}</p>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="mt-4 space-y-2">
                                                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 px-3 py-3">
                                                        <input
                                                            type="radio"
                                                            name="finalize-mode"
                                                            checked={!allowPartial}
                                                            onChange={() => setAllowPartial(false)}
                                                            className="mt-1"
                                                        />
                                                        <div>
                                                            <p className="text-sm font-medium text-zinc-100">Selesaikan dulu deviation yang masih open</p>
                                                            <p className="text-xs text-zinc-500">Finalisasi akan dibatalkan sampai semua blocking issue ditutup.</p>
                                                        </div>
                                                    </label>
                                                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 px-3 py-3">
                                                        <input
                                                            type="radio"
                                                            name="finalize-mode"
                                                            checked={allowPartial}
                                                            onChange={() => setAllowPartial(true)}
                                                            className="mt-1"
                                                        />
                                                        <div>
                                                            <p className="text-sm font-medium text-zinc-100">Tetap lanjutkan dengan partial finalize</p>
                                                            <p className="text-xs text-zinc-500">Issue yang belum selesai akan mempertahankan teks V2 saat ini.</p>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-4 py-3 text-sm text-emerald-300">
                                                Semua deviation sudah resolved. Round ini siap difinalisasi.
                                            </div>
                                        )}

                                        {hasNoEffectiveChanges && !allowPartial && (
                                            <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 px-4 py-3 text-sm text-rose-200">
                                                Finalisasi belum bisa dilanjutkan karena keputusan saat ini belum menghasilkan perubahan pada draft aktif. Review deviation yang masih aktif lalu pilih Accept, Reject, atau Counter pada deviation yang sesuai.
                                            </div>
                                        )}

                                        <div className="rounded-xl border border-zinc-800 bg-[#111] p-4">
                                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Setelah Finalisasi</p>
                                            <ul className="space-y-2 text-sm text-zinc-300">
                                                <li>Versi baru akan tersimpan di version history kontrak.</li>
                                                <li>Status kontrak berubah menjadi `Awaiting_Counterparty`.</li>
                                                <li>Anda bisa download versi finalized dalam format DOCX atau PDF.</li>
                                            </ul>
                                        </div>

                                        <div>
                                            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                                                Catatan Konfirmasi
                                            </label>
                                            <textarea
                                                value={confirmationNote}
                                                onChange={(event) => setConfirmationNote(event.target.value)}
                                                maxLength={500}
                                                placeholder="Opsional: ringkas konteks round ini."
                                                className="min-h-[92px] w-full rounded-xl border border-zinc-800 bg-[#111] px-4 py-3 text-sm text-zinc-200 outline-none transition focus:border-[#D4AF37]/40"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-shrink-0 items-center justify-between border-t border-zinc-800 px-6 py-4">
                                <div className="text-xs text-zinc-500">
                                    {preview ? `${preview.v2_text_length.toLocaleString()} → ${preview.v3_text_length.toLocaleString()} chars` : 'Preview belum dimuat'}
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={closeModal}
                                        className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
                                    >
                                        Batal
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isFinalizeDisabled}
                                        onClick={handleFinalize}
                                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-sm">
                                            {isSubmitting ? 'progress_activity' : 'check_circle'}
                                        </span>
                                        {isSubmitting ? 'Memfinalisasi...' : 'Finalisasi & Lanjutkan'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
