import { getObligationsByMatter, getPrevailingTerms, getClauseEvolution } from '@/app/actions/obligationActions'

function getDueDateDisplay(dueDateStr: string | null) {
    if (!dueDateStr) return null

    const dueDate = new Date(dueDateStr)
    const now = new Date()
    const diffMs = dueDate.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays < 0) {
        return {
            label: `Overdue by ${Math.abs(diffDays)}d`,
            classes: 'bg-red-900/20 text-red-400 border border-red-900/30'
        }
    } else if (diffDays <= 7) {
        return {
            label: `Due in ${diffDays} day${diffDays !== 1 ? 's' : ''}`,
            classes: 'bg-red-900/20 text-red-400 border border-red-900/30'
        }
    } else if (diffDays <= 30) {
        return {
            label: `Due in ${diffDays} days`,
            classes: 'bg-amber-900/20 text-amber-400 border border-amber-900/30'
        }
    } else {
        return {
            label: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            classes: 'bg-white/5 text-lux-text-muted border border-white/10'
        }
    }
}

export default async function ObligationMaster({ matterId }: { matterId: string }) {
    // 1. Fetch all AI insights in parallel
    const [obligationsData, prevailingResponse, evolutionResponse] = await Promise.all([
        getObligationsByMatter(matterId),
        getPrevailingTerms(matterId),
        getClauseEvolution(matterId)
    ]);

    const items = obligationsData.data || []
    const pendingCount = items.filter((ob: any) => ob.status === 'pending').length

    const prevailing = prevailingResponse.data;
    const evolutions = evolutionResponse.data || [];

    return (
        <div className="bg-lux-sidebar border border-lux-border flex flex-col overflow-hidden h-full z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] rounded-lg text-lux-text-body font-display">
            {/* 1. Panel Master Header */}
            <div className="p-8 border-b border-lux-border shrink-0 bg-lux-sidebar">
                <div className="flex items-center gap-2 mb-2 text-[#B8B8B8]">
                    <span className="material-symbols-outlined text-[18px]">analytics</span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Contract Intelligence</span>
                </div>
                <h2 className="text-2xl font-serif text-white mb-1">Contract Intelligence</h2>
                <p className="text-sm text-lux-text-muted font-light">
                    {prevailing?.prevailingName ? `Active Insight: ${prevailing.prevailingName}` : "Active Insight: Harmonized"}
                </p>
            </div>

            <div className="flex-1 overflow-y-auto pl-8 pr-2 py-8 space-y-6">

                {/* 2. Prevailing Term Engine */}
                <div className="bg-lux-card rounded border border-lux-border overflow-hidden hover:border-[#2A2A2A] transition-colors duration-300">
                    <div className="p-4 border-b border-lux-border bg-white/[0.02] flex justify-between items-center">
                        <h3 className="font-medium text-lux-text-head flex items-center gap-2.5 text-sm uppercase tracking-wider">
                            <span className="material-symbols-outlined text-[#B8B8B8] text-[20px]">gavel</span>
                            Prevailing Term Engine
                        </h3>
                        {prevailing?.conflictDetected ? (
                            <span className="bg-[#D4D4D4]/10 border border-[#3A3A3A] text-[#B8B8B8] text-[9px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                                Conflict Detected
                            </span>
                        ) : (
                            <span className="bg-green-900/10 border border-green-900/30 text-green-500 text-[9px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                                Harmonized
                            </span>
                        )}
                    </div>
                    {prevailing ? (
                        <div className="p-5">
                            <p className="text-sm text-lux-text-muted mb-4 font-light leading-relaxed">
                                Conflict detected in <strong className="text-lux-text-body font-medium">{prevailing.issue}</strong>. {prevailing.description}
                            </p>
                            <div className="flex items-stretch gap-0 text-sm">
                                {/* Parent Side (Losing) */}
                                <div className={`flex-1 p-4 rounded-l border border-r-0 border-lux-border ${prevailing.prevailingName !== prevailing.parentName ? 'bg-white/[0.03] opacity-50' : 'bg-[#D4D4D4]/5 border-[#2A2A2A] relative shadow-[inset_0_0_20px_rgba(184, 184, 184,0.05)]'}`}>
                                    {prevailing.prevailingName === prevailing.parentName && (
                                        <div className="absolute -top-2 right-2 bg-[#D4D4D4] text-[#0A0A0A] text-[8px] font-bold px-2 py-0.5 rounded shadow-lg tracking-wider">PREVAILS</div>
                                    )}
                                    <div className={`text-[9px] uppercase font-bold mb-1 tracking-widest ${prevailing.prevailingName === prevailing.parentName ? 'text-[#B8B8B8]' : 'text-lux-text-muted'}`}>{prevailing.parentName}</div>
                                    <div className={`font-serif ${prevailing.prevailingName === prevailing.parentName ? 'text-white font-bold' : 'text-lux-text-body'}`}>{prevailing.parentTerm}</div>
                                </div>
                                {/* Child Side (Winning) */}
                                <div className={`flex-1 p-4 rounded-r border border-lux-border ${prevailing.prevailingName !== prevailing.childName ? 'bg-white/[0.03] opacity-50' : 'bg-[#D4D4D4]/5 border-[#2A2A2A] relative shadow-[inset_0_0_20px_rgba(184, 184, 184,0.05)]'}`}>
                                    {prevailing.prevailingName === prevailing.childName && (
                                        <div className="absolute -top-2 right-2 bg-[#D4D4D4] text-[#0A0A0A] text-[8px] font-bold px-2 py-0.5 rounded shadow-lg tracking-wider">PREVAILS</div>
                                    )}
                                    <div className={`text-[9px] uppercase font-bold mb-1 tracking-widest ${prevailing.prevailingName === prevailing.childName ? 'text-[#B8B8B8]' : 'text-lux-text-muted'}`}>{prevailing.childName}</div>
                                    <div className={`font-serif ${prevailing.prevailingName === prevailing.childName ? 'text-white font-bold' : 'text-lux-text-body'}`}>{prevailing.childTerm}</div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-8 flex flex-col items-center justify-center text-center opacity-70">
                            <span className="material-symbols-outlined text-green-500/80 text-4xl mb-3">check_circle</span>
                            <p className="text-sm text-lux-text-body font-medium">All terms are harmonized.</p>
                            <p className="text-xs text-lux-text-muted mt-1 max-w-[250px]">
                                No prevailing conflicts detected across the verified document hierarchy.
                            </p>
                        </div>
                    )}
                </div>

                {/* 3. Clause Evolution Timeline */}
                <div className="bg-lux-card rounded border border-lux-border overflow-hidden hover:border-[#2A2A2A] transition-colors duration-300">
                    <div className="p-4 border-b border-lux-border bg-white/[0.02]">
                        <h3 className="font-medium text-lux-text-head flex items-center gap-2.5 text-sm uppercase tracking-wider">
                            <span className="material-symbols-outlined text-[#B8B8B8] text-[20px]">history</span>
                            Clause Evolution: Indemnity
                        </h3>
                    </div>
                    {evolutions.length > 0 ? (
                        <div className="p-5 relative">
                            {/* Vertical Line */}
                            <div className="absolute left-[30px] top-6 bottom-6 w-px bg-lux-border"></div>

                            {evolutions.map((evo, idx) => (
                                <div key={idx} className={`flex gap-5 relative transition-opacity ${!evo.isCurrent ? 'opacity-60 hover:opacity-100' : ''} ${idx !== evolutions.length - 1 ? 'mb-8' : ''}`}>
                                    <div className={`size-3 rounded-full border-[3px] border-lux-card shrink-0 z-10 translate-y-1.5 ${evo.isCurrent ? 'bg-[#B8B8B8] shadow-[0_0_0_1px_rgba(184, 184, 184,0.5)]' : 'bg-lux-border'}`}></div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-baseline mb-2">
                                            <span className={`${evo.isCurrent ? 'font-bold text-white' : 'font-medium text-lux-text-body'} text-sm`}>{evo.year}</span>
                                            <span className="text-[10px] text-lux-text-muted font-mono uppercase">{evo.docId}</span>
                                        </div>
                                        <div className={`${evo.isCurrent ? 'bg-white/[0.03] p-3 rounded border border-white/5 italic' : 'pl-1 font-light'} text-xs text-lux-text-muted leading-relaxed`}>
                                            {evo.text}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 flex flex-col items-center justify-center text-center opacity-50">
                            <span className="material-symbols-outlined text-3xl mb-2 text-lux-text-muted">history_toggle_off</span>
                            <p className="text-sm font-medium text-lux-text-body">No historical clauses found.</p>
                            <p className="text-xs text-lux-text-muted mt-1">The AI did not detect any previous versions of this clause in the connected documents.</p>
                            <div className="mt-4 w-12 h-px bg-lux-border"></div>
                        </div>
                    )}
                </div>

                {/* 4. Consolidated Obligations (Existing) */}
                <div className="bg-lux-card rounded border border-lux-border overflow-hidden hover:border-[#2A2A2A] transition-colors duration-300">
                    <div className="p-4 border-b border-lux-border bg-white/[0.02] flex justify-between items-center">
                        <h3 className="font-medium text-lux-text-head flex items-center gap-2.5 text-sm uppercase tracking-wider">
                            Consolidated Obligations
                        </h3>
                        <span className="text-[10px] text-lux-text-muted font-bold uppercase tracking-wider">
                            {pendingCount} Pending
                        </span>
                    </div>

                    <div className="p-0">
                        {items.length === 0 ? (
                            <div className="p-8 text-center">
                                <span className="material-symbols-outlined text-lux-text-muted text-[32px] mb-2 block">checklist</span>
                                <p className="text-sm text-lux-text-muted">No obligations extracted yet.</p>
                                <p className="text-xs text-lux-text-muted mt-1">Upload a contract to trigger AI extraction.</p>
                            </div>
                        ) : (
                            items.map((ob: any, index: number) => {
                                const isCompleted = ob.status === 'completed'
                                const dueDateDisplay = getDueDateDisplay(ob.due_date)
                                const contractTitle = ob.contracts?.title || 'Contract'
                                const badge = contractTitle.length > 12 ? contractTitle.substring(0, 12) + '…' : contractTitle

                                return (
                                    <div
                                        key={ob.id || index}
                                        className={`flex items-start gap-4 p-5 border-b border-lux-border hover:bg-white/[0.02] transition-colors group ${isCompleted ? 'opacity-50 hover:opacity-80' : ''}`}
                                    >
                                        <div className="mt-0.5">
                                            <input
                                                type="checkbox"
                                                defaultChecked={isCompleted}
                                                className="rounded-sm border-lux-text-muted bg-transparent text-[#B8B8B8] focus:ring-[#888888] focus:ring-offset-0 focus:ring-1 h-4 w-4 cursor-pointer"
                                                readOnly
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <p className={`text-sm font-medium leading-snug mb-2 transition-colors ${isCompleted
                                                ? 'text-lux-text-muted line-through'
                                                : 'text-lux-text-body group-hover:text-white'
                                                }`}>
                                                {ob.description}
                                            </p>
                                            <div className="flex gap-2 flex-wrap">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/5 text-lux-text-muted border border-white/10">
                                                    {badge}
                                                </span>
                                                {dueDateDisplay && (
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${dueDateDisplay.classes}`}>
                                                        {dueDateDisplay.label}
                                                    </span>
                                                )}
                                                {isCompleted && (
                                                    <span className="text-[9px] text-lux-text-muted self-center uppercase tracking-wide">
                                                        Completed
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    {items.length > 0 && (
                        <div className="p-3 bg-black/20 text-center border-t border-lux-border">
                            <span className="text-[#B8B8B8] text-[10px] font-bold uppercase tracking-widest">
                                {items.length} Total Obligation{items.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
