'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { runComplianceShield, createNewMatter } from '@/app/actions/matterActions'
import { deleteMatter } from '@/app/actions/matterActions'

export default function NewMatterModal() {
    const [isOpen, setIsOpen] = useState(false)
    const [clientName, setClientName] = useState('')
    const [mounted, setMounted] = useState(false) // State untuk amanin Portal di Next.js

    // State untuk Compliance Shield
    const [isChecking, setIsChecking] = useState(false)
    const [conflicts, setConflicts] = useState<any[]>([])
    const [shieldStatus, setShieldStatus] = useState<'idle' | 'safe' | 'warning'>('idle')
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const handleShieldCheck = async () => {
        if (!clientName) return

        setIsChecking(true)
        setShieldStatus('idle')
        setConflicts([])

        const res = await runComplianceShield(clientName)

        if (res.conflicts && res.conflicts.length > 0) {
            setConflicts(res.conflicts)
            setShieldStatus('warning')
        } else {
            setShieldStatus('safe')
        }
        setIsChecking(false)
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsSubmitting(true)

        const formData = new FormData(e.currentTarget)
        const payload = {
            title: formData.get('title') as string,
            description: formData.get('description') as string,
            practice_area: formData.get('practice_area') as string,
            client_name: formData.get('client_name') as string,
        }

        const res = await createNewMatter(payload)

        if (res.success) {
            setIsOpen(false)
            setClientName('')
            setShieldStatus('idle')
            setConflicts([])
        } else {
            alert("Failed to save matter: " + res.error)
        }
        setIsSubmitting(false)
    }

    // Isi Pop-Up (Modal)
    const modalContent = isOpen ? (
        <div
            // fixed & z-[9999] agar di atas segalanya, backdrop-blur-md agar background nge-blur
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
            onClick={() => setIsOpen(false)} // Klik di luar modal untuk menutup
        >
            <div
                className="bg-surface border border-surface-border w-full max-w-2xl rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden relative z-50 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()} // Cegah tutup saat klik isi pop-up
            >
                <div className="flex justify-between items-center p-6 border-b border-surface-border bg-surface/50">
                    <div>
                        <h2 className="text-xl font-display text-white">Create New Matter</h2>
                        <p className="text-xs text-text-muted mt-1">Initialize a new case file and run compliance checks.</p>
                    </div>
                    <button suppressHydrationWarning onClick={() => setIsOpen(false)} className="text-text-muted hover:text-white transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <form suppressHydrationWarning onSubmit={handleSubmit} className="flex flex-col gap-6 p-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Client Name</label>
                            <input
                                suppressHydrationWarning
                                type="text"
                                name="client_name"
                                required
                                className="bg-[#0a0a0a] border border-surface-border rounded p-2 text-white text-sm focus:border-primary focus:outline-none transition-colors"
                                placeholder="e.g. Acme Corp"
                                value={clientName}
                                onChange={(e) => setClientName(e.target.value)}
                                onBlur={handleShieldCheck}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Practice Area</label>
                            <select
                                suppressHydrationWarning
                                name="practice_area"
                                className="bg-[#0a0a0a] border border-surface-border rounded p-2 text-white text-sm focus:border-primary focus:outline-none transition-colors appearance-none"
                            >
                                <option value="Corporate">Corporate & M&A</option>
                                <option value="Litigation">Litigation</option>
                                <option value="Intellectual Property">Intellectual Property</option>
                                <option value="Real Estate">Real Estate</option>
                            </select>
                        </div>
                    </div>

                    {/* BAGIAN INPUT YANG UDAH DIPISAH */}
                    <div className="flex flex-col gap-4">
                        {/* 1. Kolom Title (Singkat) */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Matter Title</label>
                            <input
                                suppressHydrationWarning
                                type="text"
                                name="title"
                                required
                                className="bg-[#0a0a0a] border border-surface-border rounded p-2 text-white text-sm focus:border-primary focus:outline-none transition-colors"
                                placeholder="e.g. Project Phoenix M&A"
                            />
                        </div>

                        {/* 2. Kolom Case Summary (Panjang) */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Case Summary</label>
                            <textarea
                                suppressHydrationWarning
                                name="description"
                                className="bg-[#0a0a0a] border border-surface-border rounded p-2 text-white text-sm focus:border-primary focus:outline-none transition-colors min-h-[80px]"
                                placeholder="Brief description of the legal matter, key objectives, or background..."
                            />
                        </div>
                    </div>

                    {/* COMPLIANCE SHIELD */}
                    <div className="bg-[#0a0a0a]/50 border border-surface-border rounded p-4 flex flex-col gap-3 relative overflow-hidden">
                        {isChecking && <div className="absolute top-0 left-0 h-1 w-full bg-primary animate-pulse"></div>}

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">security</span>
                                <span className="text-sm font-medium text-white">Compliance Shield™</span>
                            </div>
                            <button
                                suppressHydrationWarning
                                type="button"
                                onClick={handleShieldCheck}
                                disabled={isChecking || !clientName}
                                className="text-[10px] border border-surface-border px-2 py-1 rounded text-text-muted hover:text-white disabled:opacity-50 transition-colors bg-surface"
                            >
                                {isChecking ? 'SCANNING...' : 'RUN CHECK'}
                            </button>
                        </div>

                        {shieldStatus === 'safe' && (
                            <div className="flex items-start gap-2 text-green-500 bg-green-500/10 p-2 rounded border border-green-500/20 text-xs">
                                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                <p>No conflict of interest detected for <strong>{clientName}</strong>.</p>
                            </div>
                        )}

                        {shieldStatus === 'warning' && (
                            <div className="flex flex-col gap-2 text-amber-500 bg-amber-500/10 p-3 rounded border border-amber-500/20 text-xs">
                                <div className="flex items-start gap-2 font-medium">
                                    <span className="material-symbols-outlined text-[16px]">warning</span>
                                    <p>Potential Conflict of Interest Detected!</p>
                                </div>
                                <ul className="pl-6 list-disc text-amber-500/80">
                                    {conflicts.map(c => (
                                        <li key={c.id}>Existing Matter: <span className="text-white">{c.title}</span></li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {shieldStatus === 'idle' && !isChecking && (
                            <p className="text-xs text-text-muted">Enter a Client Name to automatically scan your database for potential conflicts of interest.</p>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-border">
                        <button
                            suppressHydrationWarning
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="px-4 py-2 text-sm text-text-muted hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            suppressHydrationWarning
                            type="submit"
                            disabled={isSubmitting}
                            className="bg-primary px-6 py-2 rounded text-sm text-black font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-[0_0_15px_rgba(var(--primary),0.3)]"
                        >
                            {isSubmitting ? 'Initializing...' : 'Initialize Matter'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    ) : null;

    return (
        <>
            <button
                suppressHydrationWarning
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 bg-primary px-4 py-2 rounded text-sm text-black font-medium hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(var(--primary),0.3)]"
            >
                <span className="material-symbols-outlined text-sm">add</span>
                New Matter
            </button>

            {/* Pakai React Portal agar modal dirender langsung di body browser */}
            {mounted && createPortal(modalContent, document.body)}
        </>
    )
}

