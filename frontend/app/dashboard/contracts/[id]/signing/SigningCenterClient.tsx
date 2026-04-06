'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
    initiateSigning,
    cancelSigning,
    sendSignerReminder,
    getSigningStatus,
    type SignerInput,
} from '@/app/actions/signingActions'

// ── Types ──────────────────────────────────────────────────────

interface ChecklistItem {
    check: string
    passed: boolean
    blocking: boolean
    detail: string
    emeterai_required?: boolean
    recommended_type?: string
}

interface ChecklistData {
    checklist: ChecklistItem[]
    ready_to_sign: boolean
    emeterai_required: boolean
    recommended_signature_type: string
}

interface Signer {
    id: string
    full_name: string
    email: string
    phone?: string
    organization?: string
    role: string
    title?: string
    signing_order_index: number
    signing_url?: string
    status: string
    notified_at?: string
    signed_at?: string
    rejected_at?: string
    rejection_reason?: string
    certificate_serial?: string
    certificate_issuer?: string
}

interface SigningSession {
    id: string
    status: string
    provider: string
    signing_order: string
    signature_type: string
    require_emeterai: boolean
    emeterai_provider_id?: string
    initiated_at?: string
    completed_at?: string
    expires_at?: string
    signed_document_path?: string
}

interface SigningStatus {
    has_signing_session: boolean
    session?: SigningSession
    signers?: Signer[]
    audit_trail?: any[]
    progress?: {
        total_signers: number
        signed: number
        pending: number
        rejected: number
        percent_complete: number
    }
}

// ── Helper Components ────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        signed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        notified: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        viewed: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
        pending: 'bg-neutral-500/15 text-neutral-400 border-neutral-500/30',
        pending_signatures: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        partially_signed: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
        rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
        cancelled: 'bg-neutral-500/15 text-neutral-400 border-neutral-500/30',
        expired: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    }
    const cls = map[status] || 'bg-neutral-500/15 text-neutral-400 border-neutral-500/30'
    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cls}`}>
            {status.replace(/_/g, ' ')}
        </span>
    )
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
    const icon = item.passed
        ? <span className="material-symbols-outlined text-sm text-emerald-400">check_circle</span>
        : item.blocking
            ? <span className="material-symbols-outlined text-sm text-red-400">cancel</span>
            : <span className="material-symbols-outlined text-sm text-yellow-400">warning</span>

    return (
        <div className="flex items-start gap-3 py-2.5 border-b border-neutral-800 last:border-0">
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <div>
                <p className="text-xs font-medium text-neutral-300 capitalize">
                    {item.check.replace(/_/g, ' ')}
                </p>
                <p className="text-[11px] text-neutral-500 mt-0.5">{item.detail}</p>
            </div>
        </div>
    )
}

function SignerRow({
    signer,
    contractId,
    sessionActive,
    onReminder,
}: {
    signer: Signer
    contractId: string
    sessionActive: boolean
    onReminder: (signerId: string) => void
}) {
    const isPending = ['pending', 'notified', 'viewed'].includes(signer.status)
    const isSigned = signer.status === 'signed'
    const isRejected = signer.status === 'rejected'

    const roleLabel: Record<string, string> = {
        pihak_pertama: 'Pihak Pertama',
        pihak_kedua: 'Pihak Kedua',
        saksi: 'Saksi',
        approver: 'Approver',
    }

    return (
        <div className="flex items-start justify-between py-3 border-b border-neutral-800 last:border-0 gap-3">
            <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
                    ${isSigned ? 'bg-emerald-500/20' : isRejected ? 'bg-red-500/20' : 'bg-neutral-700'}`}>
                    <span className={`material-symbols-outlined text-sm
                        ${isSigned ? 'text-emerald-400' : isRejected ? 'text-red-400' : 'text-neutral-400'}`}>
                        {isSigned ? 'verified' : isRejected ? 'cancel' : 'person'}
                    </span>
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{signer.full_name}</p>
                        <StatusBadge status={signer.status} />
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        {[signer.title, signer.organization].filter(Boolean).join(' — ')}
                        {signer.title || signer.organization ? ' · ' : ''}
                        {roleLabel[signer.role] || signer.role}
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-0.5">{signer.email}</p>

                    {isSigned && signer.signed_at && (
                        <p className="text-[11px] text-emerald-500 mt-1">
                            Signed {new Date(signer.signed_at).toLocaleString('id-ID', {
                                day: '2-digit', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                            })}
                            {signer.certificate_issuer && ` · ${signer.certificate_issuer}`}
                        </p>
                    )}
                    {isRejected && signer.rejection_reason && (
                        <p className="text-[11px] text-red-400 mt-1">Reason: {signer.rejection_reason}</p>
                    )}
                    {signer.signing_url && isPending && (
                        <a
                            href={signer.signing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-[#fbbf24] hover:underline mt-1 inline-block"
                        >
                            Open signing link →
                        </a>
                    )}
                </div>
            </div>

            {isPending && sessionActive && (
                <button
                    onClick={() => onReminder(signer.id)}
                    className="text-[11px] text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded-lg px-3 py-1.5 transition-colors flex-shrink-0"
                >
                    Remind
                </button>
            )}
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────

export default function SigningCenterClient({
    contract,
    signingStatus: initialStatus,
    initialChecklist,
}: {
    contract: any
    signingStatus: SigningStatus | null
    initialChecklist: ChecklistData | null
}) {
    const router = useRouter()
    const contractId = contract.id

    const [status, setStatus] = useState<SigningStatus | null>(initialStatus)
    const [checklist] = useState<ChecklistData | null>(initialChecklist)
    const [isLoading, setIsLoading] = useState(false)

    // Signer form state
    const [signers, setSigners] = useState<SignerInput[]>([{
        full_name: '',
        email: '',
        role: 'pihak_pertama',
        signing_order_index: 0,
    }])
    const [signingOrder, setSigningOrder] = useState<'parallel' | 'sequential'>('parallel')
    const [signatureType, setSignatureType] = useState<'certified' | 'simple'>(
        initialChecklist?.recommended_signature_type as any || 'simple'
    )
    const [requireEmeterai, setRequireEmeterai] = useState(
        initialChecklist?.emeterai_required || false
    )
    const [showAudit, setShowAudit] = useState(false)

    const session = status?.session
    const sessionSigners = status?.signers || []
    const progress = status?.progress
    const isActive = session?.status === 'pending_signatures' || session?.status === 'partially_signed'
    const isCompleted = session?.status === 'completed'

    // ── Poll signing status every 15s while active ──
    const refreshStatus = useCallback(async () => {
        const { data } = await getSigningStatus(contractId)
        if (data) setStatus(data)
    }, [contractId])

    useEffect(() => {
        if (!isActive) return
        const interval = setInterval(refreshStatus, 15_000)
        return () => clearInterval(interval)
    }, [isActive, refreshStatus])

    // ── Add / remove signer rows ──
    const addSigner = () => setSigners(prev => [
        ...prev,
        { full_name: '', email: '', role: 'pihak_kedua', signing_order_index: prev.length },
    ])
    const removeSigner = (idx: number) => setSigners(prev => prev.filter((_, i) => i !== idx))
    const updateSigner = (idx: number, field: keyof SignerInput, value: any) => {
        setSigners(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
    }

    // ── Initiate ──
    const handleInitiate = async () => {
        if (signers.some(s => !s.full_name || !s.email)) {
            toast.error('All signers must have a name and email')
            return
        }
        setIsLoading(true)
        const { data, error } = await initiateSigning(contractId, {
            signers,
            signing_order: signingOrder,
            signature_type: signatureType,
            require_emeterai: requireEmeterai,
            expires_in_days: 7,
        })
        setIsLoading(false)
        if (error) {
            toast.error(error)
        } else {
            toast.success('Signing ceremony started! Signers have been notified.')
            await refreshStatus()
        }
    }

    // ── Cancel ──
    const handleCancel = async () => {
        if (!confirm('Cancel the active signing session? Signers will be notified.')) return
        setIsLoading(true)
        const { error } = await cancelSigning(contractId, 'Cancelled by document owner')
        setIsLoading(false)
        if (error) toast.error(error)
        else {
            toast.success('Signing session cancelled')
            await refreshStatus()
        }
    }

    // ── Remind ──
    const handleReminder = async (signerId: string) => {
        const { data, error } = await sendSignerReminder(contractId, signerId)
        if (error) toast.error(error)
        else toast.success(`Reminder sent to ${data?.email}`)
    }

    const inputStyle = "w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#fbbf24] focus:border-[#fbbf24] transition-colors"
    const labelStyle = "block text-[11px] font-medium text-neutral-400 mb-1"

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ── Header ── */}
            <header className="h-14 bg-background border-b border-surface-border flex items-center justify-between px-6 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <Link
                        href={`/dashboard/contracts/${contractId}`}
                        className="text-neutral-400 hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined text-xl">arrow_back</span>
                    </Link>
                    <div>
                        <h1 className="text-sm font-bold text-white">Signing Center</h1>
                        <p className="text-[11px] text-neutral-500">{contract.title}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {session && <StatusBadge status={session.status} />}
                    {isCompleted && session?.signed_document_path && (
                        <a
                            href={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/signing/${contractId}/download`}
                            className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg px-3 py-1.5 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                        >
                            <span className="material-symbols-outlined text-sm">download</span>
                            Download Signed PDF
                        </a>
                    )}
                </div>
            </header>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">

                    {/* ── LEFT: Main signing workflow ── */}
                    <div className="flex flex-col gap-5">

                        {/* Active session: signer status */}
                        {status?.has_signing_session && session && (
                            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
                                <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
                                    <h2 className="text-sm font-bold text-white">Signing Ceremony</h2>
                                    <div className="flex items-center gap-3">
                                        <span className="text-[11px] text-neutral-500">
                                            Provider: <span className="text-neutral-300 uppercase">{session.provider}</span>
                                        </span>
                                        {session.expires_at && !isCompleted && (
                                            <span className="text-[11px] text-neutral-500">
                                                Expires: {new Date(session.expires_at).toLocaleDateString('id-ID')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Progress bar */}
                                {progress && (
                                    <div className="px-5 py-3 border-b border-neutral-800">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[11px] text-neutral-400">
                                                {progress.signed}/{progress.total_signers} signed
                                            </span>
                                            <span className="text-[11px] text-neutral-400">
                                                {progress.percent_complete}%
                                            </span>
                                        </div>
                                        <div className="w-full bg-neutral-800 rounded-full h-1.5">
                                            <div
                                                className="bg-[#fbbf24] h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${progress.percent_complete}%` }}
                                            />
                                        </div>
                                        {progress.rejected > 0 && (
                                            <p className="text-[11px] text-red-400 mt-1.5">
                                                {progress.rejected} signer(s) rejected
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Signer list */}
                                <div className="px-5 divide-y divide-neutral-800">
                                    {sessionSigners.map(s => (
                                        <SignerRow
                                            key={s.id}
                                            signer={s}
                                            contractId={contractId}
                                            sessionActive={isActive}
                                            onReminder={handleReminder}
                                        />
                                    ))}
                                </div>

                                {/* e-Meterai badge */}
                                {session.emeterai_provider_id && (
                                    <div className="px-5 py-3 border-t border-neutral-800 bg-amber-500/5">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm text-amber-400">verified</span>
                                            <p className="text-[11px] text-amber-300">
                                                e-Meterai applied · Serial: {session.emeterai_provider_id}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                {isActive && (
                                    <div className="px-5 py-4 border-t border-neutral-800 flex gap-3">
                                        <button
                                            onClick={handleCancel}
                                            disabled={isLoading}
                                            className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 rounded-lg px-4 py-2 transition-colors"
                                        >
                                            Cancel Signing
                                        </button>
                                        <button
                                            onClick={refreshStatus}
                                            className="text-xs text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded-lg px-4 py-2 transition-colors flex items-center gap-1.5"
                                        >
                                            <span className="material-symbols-outlined text-sm">refresh</span>
                                            Refresh
                                        </button>
                                    </div>
                                )}

                                {/* Completed state */}
                                {isCompleted && (
                                    <div className="px-5 py-4 border-t border-neutral-800 bg-emerald-500/5">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-emerald-400">task_alt</span>
                                            <div>
                                                <p className="text-sm font-bold text-emerald-400">Contract Executed</p>
                                                {session.completed_at && (
                                                    <p className="text-[11px] text-neutral-500">
                                                        Completed {new Date(session.completed_at).toLocaleString('id-ID')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Initiate signing form — only if no active session */}
                        {!status?.has_signing_session && (
                            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
                                <div className="px-5 py-4 border-b border-neutral-800">
                                    <h2 className="text-sm font-bold text-white">Configure Signing Ceremony</h2>
                                    <p className="text-[11px] text-neutral-500 mt-0.5">
                                        Add signers, choose signature type, and initiate the ceremony.
                                    </p>
                                </div>

                                <div className="p-5 flex flex-col gap-5">
                                    {/* Signing options */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelStyle}>Signing Order</label>
                                            <select
                                                value={signingOrder}
                                                onChange={e => setSigningOrder(e.target.value as any)}
                                                className={inputStyle}
                                            >
                                                <option value="parallel">Parallel (all at once)</option>
                                                <option value="sequential">Sequential (ordered)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelStyle}>Signature Type</label>
                                            <select
                                                value={signatureType}
                                                onChange={e => setSignatureType(e.target.value as any)}
                                                className={inputStyle}
                                            >
                                                <option value="certified">Certified (QES — PSrE)</option>
                                                <option value="simple">Simple Electronic Signature</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* e-Meterai toggle */}
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <div
                                            onClick={() => setRequireEmeterai(v => !v)}
                                            className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer
                                                ${requireEmeterai ? 'bg-[#fbbf24]' : 'bg-neutral-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                                                ${requireEmeterai ? 'left-5' : 'left-0.5'}`} />
                                        </div>
                                        <div>
                                            <p className="text-sm text-white">Require e-Meterai</p>
                                            <p className="text-[11px] text-neutral-500">
                                                UU Bea Meterai — required if contract value &gt; Rp 5.000.000
                                            </p>
                                        </div>
                                    </label>

                                    {/* Signer rows */}
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <label className={`${labelStyle} mb-0`}>Signers</label>
                                            <button
                                                onClick={addSigner}
                                                className="text-[11px] text-[#fbbf24] hover:underline flex items-center gap-1"
                                            >
                                                <span className="material-symbols-outlined text-sm">add</span>
                                                Add Signer
                                            </button>
                                        </div>
                                        <div className="flex flex-col gap-3">
                                            {signers.map((signer, idx) => (
                                                <div key={idx} className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                                                            Signer {idx + 1}
                                                        </span>
                                                        {signers.length > 1 && (
                                                            <button
                                                                onClick={() => removeSigner(idx)}
                                                                className="text-red-400 hover:text-red-300"
                                                            >
                                                                <span className="material-symbols-outlined text-sm">remove_circle</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div>
                                                            <label className={labelStyle}>Full Name *</label>
                                                            <input
                                                                type="text"
                                                                required
                                                                value={signer.full_name}
                                                                onChange={e => updateSigner(idx, 'full_name', e.target.value)}
                                                                className={inputStyle}
                                                                placeholder="Ahmad Prasetyo"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Email *</label>
                                                            <input
                                                                type="email"
                                                                required
                                                                value={signer.email}
                                                                onChange={e => updateSigner(idx, 'email', e.target.value)}
                                                                className={inputStyle}
                                                                placeholder="ahmad@company.co.id"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Role</label>
                                                            <select
                                                                value={signer.role}
                                                                onChange={e => updateSigner(idx, 'role', e.target.value)}
                                                                className={inputStyle}
                                                            >
                                                                <option value="pihak_pertama">Pihak Pertama</option>
                                                                <option value="pihak_kedua">Pihak Kedua</option>
                                                                <option value="saksi">Saksi</option>
                                                                <option value="approver">Approver</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Organization</label>
                                                            <input
                                                                type="text"
                                                                value={signer.organization || ''}
                                                                onChange={e => updateSigner(idx, 'organization', e.target.value)}
                                                                className={inputStyle}
                                                                placeholder="PT Maju Bersama"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Job Title</label>
                                                            <input
                                                                type="text"
                                                                value={signer.title || ''}
                                                                onChange={e => updateSigner(idx, 'title', e.target.value)}
                                                                className={inputStyle}
                                                                placeholder="Legal Director"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Phone (for OTP)</label>
                                                            <input
                                                                type="tel"
                                                                value={signer.phone || ''}
                                                                onChange={e => updateSigner(idx, 'phone', e.target.value)}
                                                                className={inputStyle}
                                                                placeholder="+62 812 3456 7890"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Submit */}
                                    <button
                                        onClick={handleInitiate}
                                        disabled={isLoading || !checklist?.ready_to_sign}
                                        className="w-full bg-[#fbbf24] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#f59e0b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {isLoading ? (
                                            <>
                                                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                                                Initiating...
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-symbols-outlined text-sm">draw</span>
                                                Initiate Signing Ceremony
                                            </>
                                        )}
                                    </button>

                                    {!checklist?.ready_to_sign && (
                                        <p className="text-[11px] text-red-400 text-center -mt-2">
                                            Resolve all blocking issues in the checklist before proceeding.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Audit trail */}
                        {status?.has_signing_session && (status?.audit_trail || []).length > 0 && (
                            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
                                <button
                                    onClick={() => setShowAudit(v => !v)}
                                    className="w-full px-5 py-3 flex items-center justify-between text-left"
                                >
                                    <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                                        Audit Trail
                                    </h3>
                                    <span className="material-symbols-outlined text-sm text-neutral-500">
                                        {showAudit ? 'expand_less' : 'expand_more'}
                                    </span>
                                </button>
                                {showAudit && (
                                    <div className="px-5 pb-4 flex flex-col gap-2">
                                        {(status?.audit_trail || []).map((event: any) => (
                                            <div key={event.id} className="flex items-start gap-2 py-2 border-b border-neutral-800 last:border-0">
                                                <span className="material-symbols-outlined text-sm text-neutral-600 mt-0.5">
                                                    history
                                                </span>
                                                <div>
                                                    <p className="text-[11px] text-neutral-300">{event.event_detail}</p>
                                                    <p className="text-[10px] text-neutral-600 mt-0.5">
                                                        {event.event_type} · {event.event_actor} ·{' '}
                                                        {new Date(event.created_at).toLocaleString('id-ID')}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── RIGHT: Checklist sidebar ── */}
                    <div className="flex flex-col gap-4">
                        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden sticky top-0">
                            <div className="px-5 py-4 border-b border-neutral-800">
                                <h2 className="text-sm font-bold text-white">Pre-Sign Checklist</h2>
                                {checklist && (
                                    <div className="flex items-center gap-2 mt-2">
                                        {checklist.ready_to_sign ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                                Ready to Sign
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30">
                                                Blocked
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="px-5 py-1">
                                {checklist?.checklist.map(item => (
                                    <ChecklistRow key={item.check} item={item} />
                                ))}
                                {!checklist && (
                                    <p className="text-xs text-neutral-500 py-4 text-center">
                                        Checklist unavailable
                                    </p>
                                )}
                            </div>

                            {/* Summary badges */}
                            {checklist && (
                                <div className="px-5 py-4 border-t border-neutral-800 flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-neutral-500">e-Meterai</span>
                                        <span className={`text-[11px] font-medium ${checklist.emeterai_required ? 'text-amber-400' : 'text-neutral-400'}`}>
                                            {checklist.emeterai_required ? 'Required' : 'Not required'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-neutral-500">Signature type</span>
                                        <span className="text-[11px] text-neutral-300 capitalize">
                                            {checklist.recommended_signature_type}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Back to contract */}
                        <Link
                            href={`/dashboard/contracts/${contractId}`}
                            className="text-xs text-neutral-500 hover:text-white text-center transition-colors"
                        >
                            ← Back to contract
                        </Link>

                        {/* War Room link if issues remain */}
                        {checklist && !checklist.ready_to_sign && (
                            <Link
                                href={`/dashboard/contracts/${contractId}/war-room`}
                                className="text-xs text-[#fbbf24] hover:underline text-center"
                            >
                                Resolve issues in War Room →
                            </Link>
                        )}
                    </div>

                </div>
            </div>
        </div>
    )
}
