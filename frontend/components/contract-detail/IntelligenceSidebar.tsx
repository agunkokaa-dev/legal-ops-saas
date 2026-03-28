'use client'

import { useState, useMemo } from 'react'
import { useAuth } from '@clerk/nextjs'
import { motion, AnimatePresence } from 'framer-motion'
import { deleteNote } from '@/app/actions/noteActions'
import { createTask } from '@/app/actions/taskActions'
import { toast } from 'sonner'
import GenealogyGraph from '../genealogy/GenealogyGraph'
import ClauseAssistant from './ClauseAssistant'
import ObligationsTab from './ObligationsTab'
import ReactMarkdown from 'react-markdown'

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
    onUnlock,
    currentDraftVersion = null,
    onApplySuggestion
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
    onUnlock?: () => void,
    currentDraftVersion?: string | null,
    onApplySuggestion?: (originalText: string, newText: string) => Promise<void>
}) {
    const [activeTab, setActiveTab] = useState<'Analysis' | 'Obligations' | 'Notes' | 'Genealogy' | 'Assistant'>('Analysis')
    const [isSaving, setIsSaving] = useState(false)
    const [isApplyingMap, setIsApplyingMap] = useState<Record<number, boolean>>({})
    const { getToken } = useAuth();
    
    // Semantic Match States
    const [isMatchingMap, setIsMatchingMap] = useState<Record<number, boolean>>({});
    const [matchedClausesMap, setMatchedClausesMap] = useState<Record<number, any[]>>({});

    const handleFindMatch = async (riskyText: string, index: number) => {
        setIsMatchingMap(prev => ({ ...prev, [index]: true }));
        try {
            const token = await getToken({ template: 'supabase' });
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
            
            // Harden the payload to prevent 500 / 422 errors
            const query_text = (riskyText && typeof riskyText === 'string') ? riskyText.trim() : "Standard Review Required";
            
            const res = await fetch(`${apiUrl}/api/v1/clauses/match`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ query_text, limit: 1 })
            });
            if (res.ok) {
                const data = await res.json();
                setMatchedClausesMap(prev => ({ ...prev, [index]: data.matches || [] }));
            } else {
                console.error("Failed to match clause. Status:", res.status);
            }
        } catch (error) {
            console.error("Match error:", error);
        } finally {
            setIsMatchingMap(prev => ({ ...prev, [index]: false }));
        }
    };

    const parsedFindings = useMemo(() => {
        if (!contract?.draft_revisions) return null;
        let rd = contract.draft_revisions;
        if (typeof rd === 'string') {
            try { rd = JSON.parse(rd); } catch(e) { return null; }
        }
        if (Array.isArray(rd)) return rd;
        if (rd && typeof rd === 'object' && Array.isArray(rd.findings)) return rd.findings;
        return null;
    }, [contract?.draft_revisions]);

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
                icon: <span className="material-symbols-outlined text-clause-gold text-[16px]">task_alt</span>,
                style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#fff' }
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
            {/* AI REVIEW MODE BANNER */}
            <div className="flex-none p-4 bg-[#0a0a0a] border-b border-white/5 flex flex-col items-center justify-center">
                <a
                    href={`/dashboard/contracts/${contract?.id}/review`}
                    className="w-full py-2.5 bg-gradient-to-r from-[#d4af37] to-[#bda036] text-black rounded text-xs font-bold transition-all uppercase tracking-wider flex items-center justify-center gap-2 mb-2 hover:shadow-[0_0_15px_rgba(212,175,55,0.3)] hover:scale-[1.02]"
                >
                    <span className="material-symbols-outlined text-[16px]">shield</span> Enter AI Review Mode
                </a>
                <p className="text-[10px] text-zinc-500 font-medium tracking-wide">
                    Launch immersive risk analysis workspace
                </p>
            </div>

            {/* LOCKED FOR REVIEW BANNER */}
            {isLocked && (
                <div className="flex-none auto-h p-4 border-b border-white/10 bg-[#d4af37]/10 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[#d4af37]">
                        <span className="material-symbols-outlined text-[16px]">lock</span>
                        <span className="text-xs font-bold uppercase tracking-wider">Locked for Review</span>
                    </div>
                    <p className="text-[10px] text-[#d4af37]/70 leading-relaxed mb-1">
                        PDF Highlighting is active. Unlock to edit the HTML draft, which will hide previous coordinate highlights.
                    </p>
                    <button 
                        onClick={onUnlock}
                        className="w-full py-1.5 bg-[#d4af37]/20 hover:bg-[#d4af37]/30 border border-[#d4af37]/50 rounded text-xs font-bold text-[#d4af37] transition-colors"
                    >
                        Unlock to Edit
                    </button>
                </div>
            )}

            {/* HEADER: flex-none ensures it NEVER gets crushed by the body */}
            <div className="flex-none flex overflow-x-auto scrollbar-hide border-b border-white/10 w-full px-2">
                {['Analysis', 'Obligations', 'Notes', 'Genealogy', 'Assistant'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`px-4 py-3 text-sm font-medium transition-all relative whitespace-nowrap ${activeTab === tab ? 'text-lux-gold' : 'text-text-muted hover:text-white'
                            }`}
                    >
                        {tab}
                        {activeTab === tab && (
                            <motion.div
                                layoutId="activeTabIndicator"
                                className="absolute bottom-0 left-0 w-full h-[2px] bg-lux-gold"
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
                                    <div className="bg-background rounded-lg p-3 border border-surface-border flex items-center gap-3 hover:border-[#d4af37]/30 transition-colors cursor-pointer group">
                                        <div className="w-10 h-10 rounded-full bg-surface border border-surface-border flex items-center justify-center text-[#d4af37] font-bold text-xs shrink-0 group-hover:border-[#d4af37]/50 transition-colors">
                                            {clientName?.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="text-white font-bold text-xs group-hover:text-[#d4af37] transition-colors">{clientName}</div>
                                            <div className="text-text-muted text-[10px]">Counterparty</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Risk Assessment */}
                                <div>
                                    <h3 className="text-white font-serif font-semibold text-sm mb-3 flex items-center gap-2 tracking-wide">
                                        Risk Assessment
                                    </h3>
                                    <div className="bg-background rounded-lg p-4 border border-surface-border">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[11px] text-text-muted">Risk Level</span>
                                            <span className={`text-[10px] font-bold border px-2 py-0.5 rounded ${contract?.risk_level === 'High' ? 'text-red-400 border-red-400/30 bg-red-400/10' :
                                                contract?.risk_level === 'Medium' || contract?.risk_level === 'Moderate' ? 'text-[#d4af37] border-[#d4af37]/30 bg-[#d4af37]/10' :
                                                    contract?.risk_level === 'Low' ? 'text-green-400 border-green-400/30 bg-green-400/10' :
                                                        'text-text-muted border-surface-border bg-surface'
                                                }`}>{(contract?.risk_level || 'UNKNOWN').toUpperCase()}</span>
                                        </div>
                                        <div className="w-full bg-surface rounded-full h-1.5 mb-2">
                                            <div className={`h-1.5 rounded-full ${contract?.risk_level === 'High' ? 'bg-red-400' :
                                                contract?.risk_level === 'Medium' || contract?.risk_level === 'Moderate' ? 'bg-[#d4af37]' :
                                                    contract?.risk_level === 'Low' ? 'bg-green-400' :
                                                        'bg-surface-border'
                                                }`} style={{ width: contract?.risk_level === 'High' ? '90%' : contract?.risk_level === 'Low' ? '20%' : contract?.risk_level ? '50%' : '0%' }}></div>
                                        </div>
                                        <p className="text-[10px] text-text-muted leading-relaxed">
                                            {contract?.risk_level === 'High' ? 'Critical risks detected. Requires immediate review.' :
                                                contract?.risk_level === 'Low' ? 'Standard terms detected. Low risk.' :
                                                    'Review recommended for non-standard clauses.'}
                                        </p>
                                    </div>
                                </div>

                                {/* Risk Findings & Semantic Matching */}
                                {parsedFindings && parsedFindings.length > 0 && (
                                    <div className="mt-2">
                                        <h3 className="text-white font-serif font-semibold text-sm mb-3 flex items-center gap-2 tracking-wide">
                                            Identified Risks
                                        </h3>
                                        <div className="flex flex-col gap-5">
                                            {parsedFindings.map((finding: any, index: number) => {
                                                const matchedClauses = matchedClausesMap[index];
                                                const isMatching = isMatchingMap[index];

                                                return (
                                                    <div key={index} className="bg-background rounded-lg p-4 border border-surface-border shadow-sm">
                                                        <span className="text-xs font-bold text-red-400 mb-2 flex items-center gap-2 uppercase tracking-wider">
                                                            <span className="material-symbols-outlined text-[14px]">warning</span>
                                                            Finding {index + 1}
                                                        </span>
                                                        <div className="text-[11px] text-zinc-300 italic border-l-2 border-red-400/50 pl-3 mb-3 leading-relaxed">
                                                            "{finding.original_issue}"
                                                        </div>
                                                        <div className="text-[11px] text-white leading-relaxed">
                                                            <span className="font-bold text-[#d4af37]">LangGraph Analysis:</span> {finding.neutral_rewrite}
                                                        </div>
                                                        
                                                        {onApplySuggestion && (
                                                            <button
                                                                onClick={async () => {
                                                                    setIsApplyingMap(prev => ({ ...prev, [index]: true }));
                                                                    try {
                                                                        await onApplySuggestion(finding.original_issue, finding.neutral_rewrite);
                                                                    } finally {
                                                                        setIsApplyingMap(prev => ({ ...prev, [index]: false }));
                                                                    }
                                                                }}
                                                                disabled={isApplyingMap[index]}
                                                                className="mt-4 w-full bg-[#d4af37] text-black hover:bg-[#b5952f] px-3 py-2 rounded flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                                                            >
                                                                {isApplyingMap[index] ? "Applying..." : "Apply AI Suggestion"}
                                                            </button>
                                                        )}
                                                        
                                                        <button 
                                                            onClick={() => handleFindMatch(finding.original_issue, index)}
                                                            disabled={isMatching}
                                                            className="mt-3 w-full bg-[#141414] border border-[#d4af37]/30 hover:border-[#d4af37] text-[#d4af37] px-3 py-2 rounded flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                                                        >
                                                            {isMatching ? (
                                                                <span className="flex items-center gap-2">
                                                                    <span className="w-2 h-2 bg-[#d4af37] rounded-full animate-ping"></span>
                                                                    Analyzing semantics...
                                                                </span>
                                                            ) : (
                                                                "✨ Find Standard Clause"
                                                            )}
                                                        </button>

                                                        {matchedClauses && matchedClauses.length > 0 && (
                                                            <div className="mt-4 p-4 rounded-lg bg-white/5 border border-white/10 backdrop-blur-md relative overflow-hidden animate-in slide-in-from-top-2 duration-300">
                                                                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#d4af37] to-transparent"></div>
                                                                
                                                                <div className="flex justify-between items-center mb-3">
                                                                    <span className="text-xs font-bold text-white uppercase tracking-wider">Company Standard</span>
                                                                    <span className="text-[10px] bg-[#d4af37]/20 text-[#d4af37] px-2 py-1 rounded border border-[#d4af37]/30">
                                                                        {(matchedClauses[0].similarity_score * 100).toFixed(0)}% Match
                                                                    </span>
                                                                </div>
                                                                
                                                                <div className="text-[11px] text-zinc-300 font-serif leading-relaxed mb-4">
                                                                    {matchedClauses[0].content}
                                                                </div>
                                                                
                                                                <button 
                                                                    onClick={() => console.log("Trigger replace logic for:", matchedClauses[0].id)}
                                                                    className="w-full bg-[#d4af37] text-black hover:bg-[#b5952f] px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-colors shadow-[0_0_15px_rgba(212,175,55,0.3)]"
                                                                >
                                                                    Replace in Draft
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
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
                                            className={`bg-background rounded-lg p-3 border ${isOutdated ? 'border-amber-500/50 opacity-80' : 'border-surface-border hover:border-[#d4af37]/30'} transition-colors relative cursor-pointer group`}
                                            onClick={() => !isOutdated && onNoteClick?.(note.id)}
                                        >
                                            {isOutdated && (
                                                <div className="absolute -top-2 -right-2 bg-amber-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded shadow flex items-center gap-1 z-20">
                                                    <span className="material-symbols-outlined text-[10px]">warning</span>
                                                    Previous Version
                                                </div>
                                            )}
                                            
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (confirm('Delete this note?')) {
                                                        const res = await deleteNote(note.id);
                                                        if (res.error) alert(res.error);
                                                        else onNoteDeleted?.();
                                                    }
                                                }}
                                                className="absolute top-2 right-2 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">delete</span>
                                            </button>
                                            
                                            <div className="text-[11px] text-gray-300 leading-relaxed mb-2 px-2 border-l-2 border-[#d4af37]/50 pr-6 prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-blockquote:border-l-lux-gold prose-blockquote:bg-white/5 prose-blockquote:py-1 prose-blockquote:px-3">
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
                                                className="absolute bottom-2 right-2 p-1.5 text-gray-400 bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-white hover:bg-[#d4af37]/80 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider z-10 disabled:opacity-50"
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
                            className="h-full flex flex-col overflow-hidden"
                        >
                            <div className="flex flex-col flex-1 h-full">
                                <GenealogyGraph
                                    documents={graphDocs}
                                    relationships={graphRels}
                                    currentContractId={contract?.id}
                                />
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
