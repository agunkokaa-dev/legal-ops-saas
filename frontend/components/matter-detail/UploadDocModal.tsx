'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadDocument } from '@/app/actions/documentActions'

export default function UploadDocModal({ matterId, existingDocs = [] }: { matterId: string, existingDocs?: { id: string, title: string }[] }) {
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [candidateInfo, setCandidateInfo] = useState<any>(null)
    const [isConfirmingVersion, setIsConfirmingVersion] = useState(false)

    // Genealogy State
    const [category, setCategory] = useState("Uncategorized")
    const [parentId, setParentId] = useState("")
    const [relationshipType, setRelationshipType] = useState("amends")

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError(null)
        setIsUploading(true)

        const formData = new FormData(e.currentTarget)
        formData.append('matter_id', matterId)
        formData.append('document_category', category)
        if (parentId) {
            formData.append('parent_id', parentId)
            formData.append('relationship_type', relationshipType)
        }

        const res = await uploadDocument(matterId, formData)

        setIsUploading(false)
        if (res?.error) {
            setError(res.error)
        } else if (res?.versionCandidate && res.versionCandidate.is_version_candidate) {
            setCandidateInfo(res.versionCandidate)
        } else {
            setIsOpen(false)
            setCandidateInfo(null)
            if (res?.contractId) {
                router.push(`/dashboard/contracts/${res.contractId}`)
                router.refresh()
            }
        }
    }

    const resetModal = () => {
        setIsOpen(false)
        setCandidateInfo(null)
        setError(null)
    }

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded text-sm transition-colors flex items-center gap-2"
            >
                <span className="material-symbols-outlined text-[18px]">upload</span>
                Upload Document
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
                    <div className="relative w-full max-w-md bg-surface shadow-2xl border border-surface-border p-6 rounded animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-display text-white">
                                {candidateInfo ? "Version Detected" : "Upload Document"}
                            </h2>
                            <button
                                onClick={resetModal}
                                className="text-text-muted hover:text-white transition-colors"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        {error && (
                            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded">
                                {error}
                            </div>
                        )}

                        {candidateInfo ? (
                            <div className="flex flex-col gap-6 items-center text-center py-4">
                                <div className="w-16 h-16 rounded-full bg-[#B8B8B8]/20 flex items-center justify-center border border-[#B8B8B8]/40 ring-4 ring-[#B8B8B8]/10">
                                    <span className="material-symbols-outlined text-[32px] text-[#B8B8B8]">history_edu</span>
                                </div>
                                
                                <div className="w-full">
                                    <h3 className="text-lg font-bold text-white mb-2">Is this a new version?</h3>
                                    <p className="text-sm text-text-muted px-4">
                                        This document looks like an iteration of:
                                    </p>
                                    <div className="bg-[#111] border border-white/10 rounded-md p-3 mt-3 shadow-inner max-w-sm mx-auto w-full">
                                        <p className="text-sm font-medium text-[#B8B8B8] truncate" title={candidateInfo.matched_contract_title}>
                                            {candidateInfo.matched_contract_title}
                                        </p>
                                    </div>
                                    <p className="text-[11px] text-zinc-500 mt-2">
                                        Linking it will activate the Negotiation War Room diff analysis.
                                    </p>
                                </div>
                                
                                <div className="flex justify-center gap-3 w-full mt-2 border-t border-white/5 pt-6">
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (!candidateInfo) return
                                            setIsConfirmingVersion(true)
                                            try {
                                                const { confirmVersion } = await import('@/app/actions/documentActions')
                                                const res = await confirmVersion({
                                                    pendingVersionId: candidateInfo.pending_version_id,
                                                    matchedContractId: candidateInfo.matched_contract_id,
                                                    action: 'reject',
                                                    matterId,
                                                })
                                                if (res?.error) throw new Error(res.error)
                                                resetModal()
                                                const targetId = res && 'data' in res ? res.data?.contract_id : undefined
                                                if (targetId) {
                                                    router.push(`/dashboard/contracts/${targetId}`)
                                                    router.refresh()
                                                }
                                            } catch (err: any) {
                                                setError(err.message || 'Failed to create standalone contract')
                                            } finally {
                                                setIsConfirmingVersion(false)
                                            }
                                        }}
                                        className="flex-1 px-4 py-2.5 bg-surface border border-surface-border hover:bg-white/5 hover:border-white/20 text-white rounded text-sm transition-all shadow-sm"
                                        disabled={isConfirmingVersion}
                                    >
                                        No, Keep Separate
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isConfirmingVersion}
                                        className="flex-1 bg-gradient-to-r from-[#B8B8B8] to-[#B8B8B8] hover:from-[#B8B8B8] hover:to-[#B8B8B8] text-[#0A0A0A] font-bold px-4 py-2.5 rounded text-sm transition-all disabled:opacity-50 flex justify-center items-center gap-2 shadow-[0_0_15px_rgba(184, 184, 184,0.3)] hover:scale-[1.02]"
                                        onClick={async () => {
                                            setIsConfirmingVersion(true)
                                            try {
                                                const { confirmVersion } = await import('@/app/actions/documentActions')
                                                const res = await confirmVersion({
                                                    pendingVersionId: candidateInfo.pending_version_id,
                                                    matchedContractId: candidateInfo.matched_contract_id,
                                                    action: 'confirm',
                                                    matterId,
                                                })
                                                if (res?.error) throw new Error(res.error)
                                                resetModal()
                                                const targetId = res && 'data' in res ? res.data?.contract_id : undefined
                                                if (targetId) {
                                                    router.push(`/dashboard/contracts/${targetId}`)
                                                    router.refresh()
                                                }
                                            } catch (err: any) {
                                                setError(err.message || 'Failed to confirm version')
                                            } finally {
                                                setIsConfirmingVersion(false)
                                            }
                                        }}
                                    >
                                        {isConfirmingVersion ? (
                                            <>
                                                <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                                                Linking...
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-symbols-outlined text-[16px]">link</span>
                                                Yes, Link as V2
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                                <div>
                                <label className="block text-sm font-medium text-text-muted mb-2">Document Category</label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className="w-full bg-background-dark border border-surface-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
                                >
                                    <option value="Uncategorized">Uncategorized</option>
                                    <option value="MSA">MSA</option>
                                    <option value="NDA">NDA</option>
                                    <option value="SOW">SOW</option>
                                    <option value="Amendment">Amendment</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>

                            {existingDocs && existingDocs.length > 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-text-muted mb-2">Parent Document (Optional)</label>
                                    <select
                                        value={parentId}
                                        onChange={(e) => setParentId(e.target.value)}
                                        className="w-full bg-background-dark border border-surface-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
                                    >
                                        <option value="">-- No Parent (Standalone) --</option>
                                        {existingDocs.map((doc) => (
                                            <option key={doc.id} value={doc.id}>
                                                {doc.title.length > 40 ? doc.title.substring(0, 40) + '...' : doc.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {parentId && (
                                <div>
                                    <label className="block text-sm font-medium text-text-muted mb-2">Relationship Type</label>
                                    <select
                                        value={relationshipType}
                                        onChange={(e) => setRelationshipType(e.target.value)}
                                        className="w-full bg-background-dark border border-surface-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
                                    >
                                        <option value="amends">Amends</option>
                                        <option value="governs">Governs</option>
                                        <option value="exhibit_to">Exhibit To</option>
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-text-muted mb-2">Select File</label>
                                <input
                                    type="file"
                                    name="file"
                                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                    required
                                    className="block w-full text-sm text-text-muted
                                      file:mr-4 file:py-2 file:px-4
                                      file:rounded-full file:border-0
                                      file:text-sm file:font-semibold
                                      file:bg-primary/10 file:text-primary
                                      hover:file:bg-primary/20 transition-colors"
                                />
                                <p className="text-xs text-text-muted mt-2">Supported formats: PDF, DOC, DOCX</p>
                            </div>

                            <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-surface-border">
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    className="px-4 py-2 text-sm text-text-muted hover:text-white transition-colors"
                                    disabled={isUploading}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUploading}
                                    className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {isUploading ? (
                                        <>
                                            <span className="material-symbols-outlined animate-spin text-[16px]">hourglass_empty</span>
                                            Uploading...
                                        </>
                                    ) : (
                                        'Upload'
                                    )}
                                </button>
                            </div>
                        </form>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
