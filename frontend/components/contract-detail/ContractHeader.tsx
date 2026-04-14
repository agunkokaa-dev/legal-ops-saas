'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getPublicApiBase } from '@/lib/public-api-base'
import { useAuth } from '@clerk/nextjs'

export default function ContractHeader({
    initialContract,
    formattedDate,
    actionMenu,
    children
}: {
    initialContract: any,
    formattedDate: string,
    actionMenu?: React.ReactNode,
    children?: React.ReactNode
}) {
    const { getToken, isLoaded, isSignedIn } = useAuth()
    const [contract, setContract] = useState(initialContract)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [editForm, setEditForm] = useState({
        title: initialContract?.title || '',
        contract_value: initialContract?.contract_value || '',
        end_date: initialContract?.end_date || ''
    })

    useEffect(() => {
        setContract(initialContract)
        setEditForm({
            title: initialContract?.title || '',
            contract_value: initialContract?.contract_value || '',
            end_date: initialContract?.end_date || ''
        })
    }, [initialContract])

    const handleUpdateContract = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSaving(true)

        try {
            if (!isLoaded || !isSignedIn) {
                throw new Error("User unauthorized.")
            }
            
            const token = await getToken()
            const payload = {
                title: editForm.title,
                contract_value: editForm.contract_value ? parseFloat(editForm.contract_value.toString()) : null,
                end_date: editForm.end_date || null
            }

            const apiUrl = getPublicApiBase()
            const response = await fetch(`${apiUrl}/api/v1/contracts/${contract.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            })

            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.detail || "Failed to update contract")
            }

            const { contract: data } = await response.json()

            // Update local state to reflect changes instantly
            setContract(data)
            setIsEditModalOpen(false)
        } catch (error) {
            console.error('Error updating contract:', error)
            // Optionally add a toast notification here
        } finally {
            setIsSaving(false)
        }
    }

    // Modal Style Helpers
    const modalInputStyling = "w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-lux-gold focus:border-lux-gold transition-colors"
    const labelStyling = "block text-xs font-medium text-neutral-400 mb-1.5"

    return (
        <header className="h-16 bg-background border-b border-surface-border flex items-center justify-between px-6 flex-shrink-0 z-20 w-full relative">
            <div className="flex items-center gap-4">
                <Link href={`/dashboard/matters/${contract.matter_id}`} className="text-text-muted hover:text-white transition-colors flex items-center">
                    <span className="material-symbols-outlined">arrow_back</span>
                </Link>
                <div className="flex flex-col">
                    <div className="flex items-center gap-3">
                        <h2 className="text-base font-serif font-bold text-white tracking-tight">
                            {contract.title || contract.file_url || 'Unknown Contract'}
                        </h2>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/20">
                            Status: {contract.status || 'DRAFT'}
                        </span>
                        <button
                            onClick={() => setIsEditModalOpen(true)}
                            className="text-text-muted hover:text-white flex items-center transition-colors hover:bg-white/5 p-1 rounded-full"
                            title="Edit Contract Details"
                        >
                            <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                        {actionMenu}
                    </div>
                    <p className="text-text-muted text-[11px] mt-0.5">
                        Client • 4 • Last modified: {formattedDate}
                    </p>
                </div>
            </div>

            {/* Right Side / Actions */}
            {children}

            {/* Edit Contract Modal (Rendered inline to keep things simple) */}
            {isEditModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">

                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50">
                            <h3 className="text-lg font-serif font-bold text-white">Edit Contract Details</h3>
                            <button
                                onClick={() => setIsEditModalOpen(false)}
                                className="text-neutral-400 hover:text-white transition-colors rounded-full hover:bg-white/5 p-1"
                            >
                                <span className="material-symbols-outlined text-xl">close</span>
                            </button>
                        </div>

                        {/* Modal Body */}
                        <form onSubmit={handleUpdateContract} className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">

                            {/* Document Name */}
                            <div>
                                <label className={labelStyling}>Document Name</label>
                                <input
                                    type="text"
                                    required
                                    value={editForm.title}
                                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                    className={modalInputStyling}
                                    placeholder="Enter contract title"
                                />
                            </div>
                            {/* Contract Value */}
                            <div>
                                <label className={labelStyling}>Contract Value (Rp / IDR)</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 font-medium">Rp</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={editForm.contract_value}
                                        onChange={(e) => setEditForm({ ...editForm, contract_value: e.target.value })}
                                        className={`${modalInputStyling} pl-10`}
                                        placeholder="100000000"
                                    />
                                </div>
                            </div>

                            {/* End Date */}
                            <div>
                                <label className={labelStyling}>End Date</label>
                                <input
                                    type="date"
                                    value={editForm.end_date}
                                    onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                                    className={`${modalInputStyling} [color-scheme:dark]`}
                                />
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3 mt-4 justify-end">
                                <button
                                    type="button"
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="px-5 py-2.5 rounded-lg text-sm font-medium text-neutral-300 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-5 py-2.5 rounded-lg text-sm font-medium bg-lux-gold text-black hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[100px]"
                                >
                                    {isSaving ? (
                                        <span className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></span>
                                    ) : (
                                        "Save Changes"
                                    )}
                                </button>
                            </div>

                        </form>
                    </div>
                </div>
            )}
        </header>
    )
}
