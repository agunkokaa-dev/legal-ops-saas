export default function FinancialExposure({
    claimValue,
    liabilityCap,
    legalSpend
}: {
    claimValue: number | null,
    liabilityCap: number | null,
    legalSpend: number | null
}) {
    // Format to IDR
    const formatIDR = (val: number | null) => {
        if (val === null || val === undefined) return 'Rp --';
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    // Safe numbers for calculation
    const cv = claimValue || 0;
    const lc = liabilityCap || 0;
    const ls = legalSpend || 0;

    // Legal Spend Percentage relative to Liability Cap (as Budget limit proxy)
    const spendPercentage = lc > 0 ? Math.min((ls / lc) * 100, 100) : 0;
    const isOverBudget = spendPercentage > 80;

    return (
        <div className="lg:col-span-4 bg-surface border border-surface-border rounded p-6 flex flex-col h-full relative transition-all duration-300 hover:border-gray-700">
            <div className="flex items-center justify-between mb-6 border-b border-surface-border pb-4">
                <h2 className="text-xs font-semibold text-text-muted uppercase tracking-widest flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">pie_chart</span>
                    Financial Exposure
                </h2>
                <button className="text-text-muted hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                </button>
            </div>

            <div className="flex flex-col gap-6">
                <div className="relative group">
                    <div className="text-xs text-text-muted mb-1 uppercase tracking-wider">Total Claim Value</div>
                    <div className="font-mono text-2xl text-primary font-medium tracking-tight group-hover:text-[#d6b06a] transition-colors">
                        {formatIDR(claimValue)}
                    </div>
                    {/* Progress bar visual for claim value (static max width look) */}
                    <div className="w-full h-1 bg-surface-border mt-2 rounded-full overflow-hidden">
                        <div className="h-full bg-primary w-full shadow-[0_0_10px_rgba(184, 184, 184,0.5)]"></div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wider">Liability Cap</div>
                        <div className="font-mono text-sm text-gray-200">{formatIDR(liabilityCap)}</div>
                        <div className="text-[10px] text-gray-500 mt-1">
                            {cv > 0 && lc > 0 ? `${Math.round((lc / cv) * 100)}% of Claim` : '--'}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wider">Legal Spend</div>
                        <div className="font-mono text-sm text-gray-200">{formatIDR(legalSpend)}</div>
                        <div className={`text-[10px] mt-1 flex items-center gap-1 ${isOverBudget ? 'text-red-400' : 'text-green-500/80'}`}>
                            <span className="material-symbols-outlined text-[12px]">
                                {isOverBudget ? 'trending_up' : 'trending_down'}
                            </span>
                            {isOverBudget ? 'High Burn Rate' : 'Within Budget'}
                        </div>
                    </div>
                </div>

                <div className="mt-auto bg-[#0a0a0a]/50 rounded p-3 border border-surface-border flex items-start gap-3">
                    <span className="material-symbols-outlined text-[16px] text-primary mt-0.5">monitoring</span>
                    <p className="text-xs text-text-muted leading-snug">
                        {spendPercentage > 0
                            ? `Spend is at ${Math.round(spendPercentage)}% of Liability Cap.`
                            : 'Set liability and spend to monitor budget health.'}
                    </p>
                </div>
            </div>
        </div>
    )
}
