'use client'

import { useState, useMemo } from 'react'
import { useAuth } from '@clerk/nextjs'
import { motion, AnimatePresence } from 'framer-motion'
import { deleteNote } from '@/app/actions/noteActions'
import { createTask } from '@/app/actions/taskActions'
import { toast } from 'sonner'
import ContractGenealogyTab from './ContractGenealogyTab'
import GenealogyGraph from '../genealogy/GenealogyGraph'
import ClauseAssistant from './ClauseAssistant'
import ObligationsTab from './ObligationsTab'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'
import ConfirmDialog from '../ui/ConfirmDialog'

export default function IntelligenceSidebar({
    contract,
    obligations = [],
    notes = [],
    clientName = 'Unknown Client',
    graphDocs = [],
    graphRels = [],
    onNoteClick,
    onNoteDeleted,
    isLocked = false,
    currentDraftVersion = null,
    onApplySuggestion,
    hasDraftingSuggestions = false,
    hasNegotiationStrategy = false,
    isGeneratingDrafting = false,
    isGeneratingNegotiation = false,
    onGenerateDrafting,
    onGenerateNegotiation
}: {
    contract?: any,
    obligations?: any[],
    notes?: any[],
    clientName?: string,
    graphDocs?: any[],
    graphRels?: any[],
    onNoteClick?: (noteId: string) => void,
    onNoteDeleted?: () => void,
    isLocked?: boolean,
    currentDraftVersion?: string | null,
    onApplySuggestion?: (originalText: string, newText: string) => Promise<void>
    hasDraftingSuggestions?: boolean,
    hasNegotiationStrategy?: boolean,
    isGeneratingDrafting?: boolean,
    isGeneratingNegotiation?: boolean,
    onGenerateDrafting?: () => void,
    onGenerateNegotiation?: () => void
}) {
    const [activeTab, setActiveTab] = useState<'Analysis' | 'Obligations' | 'Notes' | 'Genealogy' | 'Assistant'>('Analysis')
    const [genealogyView, setGenealogyView] = useState<'family' | 'versions'>('family')
    const [isSaving, setIsSaving] = useState(false)
    const { getToken } = useAuth();

    // Helper for formatting IDR
    const formatIDR = (value: any) => {
        if (value === null || value === undefined || value === '') {
            return "Not specified";
        }

        // 1. Convert to string safely
        const stringValue = String(value);

        // 2. Strip ALL non-digit characters (removes spaces, letters, dots, commas, Rp, etc.)
        const cleanString = stringValue.replace(/\D/g, '');

        // 3. If after cleaning it's empty, it wasn't a number
        if (cleanString === '') {
            return "Invalid Amount";
        }

        // 4. Convert clean string to Number
        const numericValue = Number(cleanString);

        // 5. Format to IDR
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(numericValue);
    };

    const handlePushToKanban = async (note: any) => {
        setIsSaving(true);
        try {
            const autoTitle = note.quote.length > 40 ? note.quote.substring(0, 40) + "..." : note.quote;

            const res = await createTask({
                title: `[Review] ${autoTitle}`,
                description: `**Source Note:**\n\n${note.quote}\n\n${note.comment ? `**Comment:** ${note.comment}` : ''}`,
                status: 'backlog',
                matterId: contract?.matter_id,
                sourceNoteId: note.id
            });

            if (res.error) throw new Error(res.error);

            toast.success("Task added to Backlog!", {
                icon: <span className="material-symbols-outlined text-[#B8B8B8] text-[16px]">task_alt</span>,
                style: { background: '#1a1a1a', border: '1px solid #B8B8B8', color: '#fff' }
            });
        } catch (error: any) {
            console.error("Failed to push to Kanban:", error);
            toast.error("Failed to create task", {
                description: error.message
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full w-[400px] bg-surface border-l border-white/10 z-10 flex-shrink-0">
            {/* HEADER: flex-none ensures it NEVER gets crushed by the body */}
            <div className="flex-none flex overflow-x-auto scrollbar-hide border-b border-white/10 w-full px-2">
                {['Analysis', 'Obligations', 'Notes', 'Genealogy', 'Assistant'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`px-4 py-3 text-sm font-medium transition-all relative whitespace-nowrap ${activeTab === tab ? 'text-[#B8B8B8]' : 'text-text-muted hover:text-white'
                            }`}
                    >
                        {tab}
                        {activeTab === tab && (
                            <motion.div
                                layoutId="activeTabIndicator"
                                className="absolute bottom-0 left-0 w-full h-[2px] bg-[#B8B8B8]"
                                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* BODY: flex-1 ensures it takes the remaining height, overflow-hidden keeps it contained */}
            <div className="flex-1 overflow-hidden relative">
                <AnimatePresence mode="wait">
                    {activeTab === 'Analysis' && (
                        <motion.div
                            key="Analysis"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="h-full overflow-y-auto p-5"
                        >
                            <div className="flex flex-col gap-6">
                                {/* Key Entities */}
                                <div>
                                    <h3 className="text-white font-serif font-semibold text-sm mb-3 flex items-center gap-2 tracking-wide">
                                        Key Entities
                                    </h3>
                                    <div className="bg-background border border-surface-border rounded-lg divide-y divide-surface-border">
                                        <div className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                                            <span className="text-[11px] text-text-muted">Jurisdiction</span>
                                            <span className="text-[11px] text-white font-medium text-right text-gray-300">
                                                {contract?.jurisdiction || 'Not specified'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                                            <span className="text-[11px] text-text-muted">Governing Law</span>
                                            <span className="text-[11px] text-white font-medium text-right">
                                                {contract?.governing_law || 'Not specified'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                                            <span className="text-[11px] text-text-muted">Effective Date</span>
                                            <span className="text-[11px] text-white font-medium text-right" suppressHydrationWarning>
                                                {contract?.effective_date || contract?.start_date || contract?.end_date || 'Not specified'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                                            <span className="text-[11px] text-text-muted">Contract Value</span>
                                            <span className="text-[11px] text-white font-medium text-right" suppressHydrationWarning>
                                                {formatIDR(contract?.contract_value)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Counterparty Info */}
                                <div>
                                    <h3 className="text-white font-serif font-semibold text-sm mb-3 flex items-center gap-2 tracking-wide">
                                        Counterparty Info
                                    </h3>
                                    <div className="bg-background rounded-lg p-3 border border-surface-border flex items-center gap-3 hover:border-[#B8B8B8]/30 transition-colors cursor-pointer group">
                                        <div className="w-10 h-10 rounded-full bg-surface border border-surface-border flex items-center justify-center text-[#B8B8B8] font-bold text-xs shrink-0 group-hover:border-[#B8B8B8]/50 transition-colors">
                                            {clientName?.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="text-white font-bold text-xs group-hover:text-[#B8B8B8] transition-colors">{clientName}</div>
                                            <div className="text-text-muted text-[10px]">Counterparty</div>
                                        </div>
                                    </div>
                                </div>


                                <div className="mt-2 pt-6 border-t border-zinc-800/60 space-y-3">
                                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-4">
                                        Analisis Tambahan (On-Demand)
                                    </div>

                                    {!hasDraftingSuggestions && (
                                        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-zinc-200 mb-1">
                                                    Saran Redrafting
                                                </div>
                                                <div className="text-xs text-zinc-500 leading-5">
                                                    Generate saran perbaikan klausul bermasalah
                                                </div>
                                            </div>
                                            <button
                                                onClick={onGenerateDrafting}
                                                disabled={isGeneratingDrafting || !onGenerateDrafting}
                                                className="flex shrink-0 items-center gap-2 px-4 py-2 text-xs font-medium bg-[#1C1C1C] border border-[#3A3A3A] text-[#B8B8B8] hover:bg-[#222222] hover:text-[#D4D4D4] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isGeneratingDrafting ? (
                                                    <>
                                                        <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                                        Generating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="material-symbols-outlined text-[14px]">edit_document</span>
                                                        Generate Redrafting
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}

                                    {!hasNegotiationStrategy && (
                                        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-zinc-200 mb-1">
                                                    Strategi Negosiasi
                                                </div>
                                                <div className="text-xs text-zinc-500 leading-5">
                                                    Generate counter-proposal dan BATNA untuk klausul berisiko
                                                </div>
                                            </div>
                                            <button
                                                onClick={onGenerateNegotiation}
                                                disabled={isGeneratingNegotiation || !onGenerateNegotiation}
                                                className="flex shrink-0 items-center gap-2 px-4 py-2 text-xs font-medium bg-[#1C1C1C] border border-[#3A3A3A] text-[#B8B8B8] hover:bg-[#222222] hover:text-[#D4D4D4] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isGeneratingNegotiation ? (
                                                    <>
                                                        <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                                        Generating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="material-symbols-outlined text-[14px]">swords</span>
                                                        Generate Negosiasi
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}

                                    {hasDraftingSuggestions && hasNegotiationStrategy && (
                                        <div className="text-xs text-zinc-600 text-center py-2">
                                            Semua analisis tersedia
                                        </div>
                                    )}
                                </div>

                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'Obligations' && (
                        <motion.div
                            key="Obligations"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="h-full"
                        >
                            <ObligationsTab contractId={contract?.id} />
                        </motion.div>
                    )}

                    {activeTab === 'Notes' && (
                        <motion.div
                            key="Notes"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="h-full overflow-y-auto p-5"
                        >
                            <div className="flex flex-col gap-3">
                                {notes.length === 0 ? (
                                    <div className="text-text-muted text-xs p-4 text-center border border-dashed border-surface-border rounded-lg">
                                        Highlight text on the PDF to create a note.
                                    </div>
                                ) : (
                                    notes.map((note: any, idx: number) => {
                                        const pos = typeof note.position_data === 'string' ? JSON.parse(note.position_data) : note.position_data;
                                        const isOutdated = isLocked && pos?.draft_version !== currentDraftVersion;

                                        return (
                                            <div
                                                key={note.id || idx}
                                                className={`bg-background rounded-lg p-3 border ${isOutdated ? 'border-amber-500/50 opacity-80' : 'border-surface-border hover:border-[#B8B8B8]/30'} transition-colors relative cursor-pointer group`}
                                                onClick={() => !isOutdated && onNoteClick?.(note.id)}
                                            >
                                                {isOutdated && (
                                                    <div className="absolute -top-2 -right-2 bg-amber-500 text-[#0A0A0A] text-[9px] font-bold px-1.5 py-0.5 rounded shadow flex items-center gap-1 z-20">
                                                        <span className="material-symbols-outlined text-[10px]">warning</span>
                                                        Previous Version
                                                    </div>
                                                )}

                                                <ConfirmDialog
                                                    title="Delete Note"
                                                    description="Delete this note? This action cannot be undone."
                                                    onConfirm={async () => {
                                                        const res = await deleteNote(note.id);
                                                        if (res.error) toast.error(res.error);
                                                        else onNoteDeleted?.();
                                                    }}
                                                    variant="destructive"
                                                    confirmText="Delete"
                                                    trigger={
                                                        <button className="absolute top-2 right-2 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <span className="material-symbols-outlined text-[14px]">delete</span>
                                                        </button>
                                                    }
                                                />

                                                <div className="text-[11px] text-gray-300 leading-relaxed mb-2 px-2 border-l-2 border-[#B8B8B8]/50 pr-6 prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-blockquote:border-l-[#B8B8B8] prose-blockquote:bg-white/5 prose-blockquote:py-1 prose-blockquote:px-3">
                                                    <ReactMarkdown>
                                                        {note.quote}
                                                    </ReactMarkdown>
                                                </div>

                                                {note.comment && (
                                                    <p className="text-white text-xs mt-2 bg-white/5 p-2 rounded border border-white/5">{note.comment}</p>
                                                )}

                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handlePushToKanban(note); }}
                                                    disabled={isSaving}
                                                    className="absolute bottom-2 right-2 p-1.5 text-gray-400 bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-white hover:bg-[#B8B8B8]/80 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider z-10 disabled:opacity-50"
                                                    title="Convert to Kanban Task"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">format_list_bulleted_add</span>
                                                    <span>Push to Backlog</span>
                                                </button>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'Genealogy' && (
                        <motion.div
                            key="Genealogy"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="h-full flex flex-col overflow-hidden bg-[#050505]"
                        >
                            {/* Toggle Header */}
                            <div className="flex items-center justify-center p-4 border-b border-white/5 shrink-0">
                                <div className="bg-[#141414] p-1 rounded-lg border border-white/5 flex items-center gap-1">
                                    <button
                                        onClick={() => setGenealogyView('family')}
                                        className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${genealogyView === 'family' ? 'bg-[#B8B8B8]/10 text-[#B8B8B8]' : 'text-zinc-500 hover:text-zinc-300'
                                            }`}
                                    >
                                        Document Family
                                    </button>
                                    <button
                                        onClick={() => setGenealogyView('versions')}
                                        className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${genealogyView === 'versions' ? 'bg-[#B8B8B8]/10 text-[#B8B8B8]' : 'text-zinc-500 hover:text-zinc-300'
                                            }`}
                                    >
                                        Version History
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-hidden relative">
                                {genealogyView === 'family' ? (
                                    <GenealogyGraph
                                        documents={graphDocs}
                                        relationships={graphRels}
                                        currentContractId={contract?.id}
                                    />
                                ) : (
                                    <ContractGenealogyTab
                                        contractId={contract?.id}
                                        contractStatus={contract?.status}
                                    />
                                )}
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'Assistant' && (
                        <motion.div
                            key="Assistant"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.25 }}
                            className="h-full flex flex-col overflow-hidden"
                        >
                            <ClauseAssistant contractId={contract?.id} matterId={contract?.matter_id} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
