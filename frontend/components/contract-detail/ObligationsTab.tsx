'use client'

import { useState, useEffect } from 'react'
import { supabaseClient } from '@/lib/supabase'
import { useAuth } from '@clerk/nextjs'
import { Sparkles, Plus, Loader2, CheckCircle2, Circle, AlertCircle, FileSearch, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPublicApiBase } from '@/lib/public-api-base'
import { toast } from 'sonner'

interface Obligation {
    id: string
    description: string
    status: 'pending' | 'completed'
    source: 'AI' | 'MANUAL'
    compliance_flag: 'SAFE' | 'CONFLICT' | 'REVIEW'
    created_at: string
}

export default function ObligationsTab({ contractId }: { contractId: string }) {
    const { getToken, userId } = useAuth()
    const [obligations, setObligations] = useState<Obligation[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isAdding, setIsAdding] = useState(false)
    const [newDesc, setNewDesc] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isExtracting, setIsExtracting] = useState(false)

    useEffect(() => {
        fetchObligations()
    }, [contractId])

    const fetchObligations = async () => {
        try {
            setIsLoading(true)
            const token = await getToken({ template: 'supabase' })
            const supabase = await supabaseClient(token || '')

            const { data, error } = await supabase
                .from('contract_obligations')
                .select('*')
                .eq('contract_id', contractId)
                .order('created_at', { ascending: false })

            if (error) {
                console.error('Supabase Error:', JSON.stringify(error, null, 2))
                return
            }

            setObligations(data || [])
        } catch (err) {
            console.error('Fetch error:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const toggleStatus = async (ob: Obligation) => {
        try {
            const newStatus = ob.status === 'completed' ? 'pending' : 'completed'
            setObligations(prev => prev.map(o => o.id === ob.id ? { ...o, status: newStatus } : o))

            const token = await getToken({ template: 'supabase' })
            const supabase = await supabaseClient(token || '')

            await supabase
                .from('contract_obligations')
                .update({ status: newStatus })
                .eq('id', ob.id)
        } catch (err) {
            console.error('Toggle error:', err)
            // Revert on error
            setObligations(prev => prev.map(o => o.id === ob.id ? { ...o, status: ob.status } : o))
        }
    }

    const handleAutoExtract = async () => {
        try {
            setIsExtracting(true)

            if (!userId) throw new Error("Not authenticated with Clerk")

            const backendUrl = getPublicApiBase()
            const response = await fetch(`${backendUrl}/api/obligations/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contract_id: contractId,
                    user_id: userId
                })
            })

            if (!response.ok) {
                const errData = await response.json()
                throw new Error(errData.detail || 'Failed to extract obligations')
            }

            // Refresh the list after successful extraction
            await fetchObligations()
        } catch (err: any) {
            console.error("Extraction error:", err)
            toast.error(`Failed to auto-extract obligations: ${err.message}`)
        } finally {
            setIsExtracting(false)
        }
    }

    const handleAddManual = async () => {
        if (!newDesc.trim()) return

        try {
            setIsSubmitting(true)
            const token = await getToken({ template: 'supabase' })
            const supabase = await supabaseClient(token || '')

            const { data, error } = await supabase
                .from('contract_obligations')
                .insert([{
                    contract_id: contractId,
                    description: newDesc.trim(),
                    source: 'MANUAL',
                    compliance_flag: 'SAFE',
                    status: 'pending'
                }])
                .select()
                .single()

            if (error) {
                console.error("Insert error:", JSON.stringify(error, null, 2))
                return
            }

            setObligations([data, ...obligations])
            setNewDesc('')
            setIsAdding(false)
        } catch (err) {
            console.error("Add error:", err)
        } finally {
            setIsSubmitting(false)
        }
    }

    if (isLoading) {
        return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-neutral-500" /></div>
    }

    return (
        <div className="flex flex-col h-full relative">

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-5 pb-24">
                {obligations.length === 0 && !isExtracting ? (
                    <div className="flex flex-col items-center justify-center p-8 bg-neutral-900/50 backdrop-blur border border-neutral-800 rounded-xl text-center">
                        <div className="mb-4">
                            <FileSearch className="w-8 h-8 text-neutral-600 stroke-[1.5]" />
                        </div>
                        <h3 className="text-white font-serif tracking-tight mb-2">Document Analysis Pending</h3>
                        <p className="text-xs text-neutral-500 mb-6">Our system hasn't extracted any mandatory obligations from this contract yet.</p>

                        <button
                            onClick={handleAutoExtract}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-transparent border border-[#d4af37]/30 text-[#d4af37] hover:bg-[#d4af37]/10 rounded-lg text-sm transition-all shadow-[0_0_15px_rgba(212,175,55,0.1)] hover:shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                        >
                            <Sparkles className="w-4 h-4 stroke-[1.5]" />
                            Auto-Extract Obligations
                        </button>
                    </div>
                ) : isExtracting ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col items-center justify-center p-4 mb-2">
                            <h3 className="text-[#d4af37] text-[10px] font-mono tracking-widest uppercase animate-pulse">EXTRACTING GUIDELINES...</h3>
                            <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/50 to-transparent mt-3"></div>
                        </div>
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-neutral-900/50 backdrop-blur border border-neutral-800 rounded-xl p-4 flex flex-col gap-3 animate-pulse">
                                <div className="flex items-start gap-3">
                                    <div className="w-5 h-5 rounded-full bg-neutral-800 shrink-0"></div>
                                    <div className="flex-1 space-y-2 py-1">
                                        <div className="h-3 bg-neutral-800 rounded w-full"></div>
                                        <div className="h-3 bg-neutral-800 rounded w-5/6"></div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-1 pl-8">
                                    <div className="h-2 w-24 bg-neutral-800 rounded"></div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <AnimatePresence>
                            {obligations.map((ob) => {
                                const isConflict = ob.compliance_flag === 'CONFLICT';
                                const isActive = ob.status !== 'completed';

                                return (
                                    <motion.div
                                        key={ob.id}
                                        layout
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className={`bg-neutral-900/50 backdrop-blur rounded-xl p-4 transition-all flex flex-col gap-3 group relative overflow-hidden ${isActive && !isConflict ? 'border border-neutral-800 border-l-2 border-l-amber-500' :
                                                isActive && isConflict ? 'border border-red-500/30 border-l-2 border-l-red-500 shadow-[0_0_15px_rgba(239,68,68,0.1)]' :
                                                    'border border-neutral-800/50 opacity-60'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <button
                                                onClick={() => toggleStatus(ob)}
                                                className="mt-0.5 shrink-0 text-neutral-500 hover:text-emerald-400 transition-colors focus:outline-none"
                                            >
                                                {ob.status === 'completed' ? (
                                                    <CheckCircle2 className="w-5 h-5 text-emerald-500 stroke-[1.5]" />
                                                ) : (
                                                    <Circle className="w-5 h-5 stroke-[1.5]" />
                                                )}
                                            </button>
                                            <p className={`text-sm leading-relaxed transition-all ${ob.status === 'completed' ? 'text-neutral-600 line-through' : 'text-neutral-200'}`}>
                                                {ob.description}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3 mt-1 pl-8">
                                            {/* Source Badge */}
                                            <span className="text-[9px] font-mono tracking-widest uppercase text-neutral-500">
                                                {ob.source === 'AI' ? '[ SYSTEM GENERATED ]' : '[ USER ADDED ]'}
                                            </span>

                                            {/* Compliance Badge */}
                                            {isConflict && (
                                                <span className="flex items-center gap-1 text-red-500 text-[10px] uppercase tracking-wide font-medium">
                                                    <AlertTriangle className="w-3 h-3 stroke-[1.5]" /> Playbook Conflict
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* Manual Insert Footer */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent pt-10">
                {!isAdding ? (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="w-full py-2.5 flex items-center justify-center gap-2 bg-[#1A1A1A] hover:bg-[#222222] border border-neutral-800 rounded-lg text-sm text-neutral-300 transition-colors shadow-lg"
                    >
                        <Plus className="w-4 h-4" /> Add Manual Obligation
                    </button>
                ) : (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[#1A1A1A] border border-neutral-800 rounded-lg p-3 shadow-2xl"
                    >
                        <textarea
                            value={newDesc}
                            onChange={(e) => setNewDesc(e.target.value)}
                            placeholder="Describe the obligation..."
                            className="w-full bg-[#121212] border border-neutral-700 rounded-md p-2 text-sm text-white focus:outline-none focus:border-[#d4af37]/50 resize-none h-20 mb-3 placeholder:text-neutral-600"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => { setIsAdding(false); setNewDesc(''); }}
                                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddManual}
                                disabled={!newDesc.trim() || isSubmitting}
                                className="px-4 py-1.5 bg-[#d4af37] hover:bg-[#c4a137] text-black text-xs font-semibold rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
                                Save
                            </button>
                        </div>
                    </motion.div>
                )}
            </div>

        </div>
    )
}
