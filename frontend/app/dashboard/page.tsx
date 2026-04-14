import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 0
import { syncProfile } from '@/app/actions/syncProfile'
import { createClient } from '@supabase/supabase-js'
import RecentDocuments from '@/components/RecentDocuments'
export default async function DashboardPage() {
    const { userId, orgId, getToken } = await auth()
    const user = await currentUser()

    if (!userId || !user) {
        redirect('/')
    }

    const token = await getToken({ template: 'supabase' })
    const email = user?.primaryEmailAddress?.emailAddress

    let documents: any[] = []
    let totalContracts = 0
    let portfolioValues: Record<string, number> = {}
    let highRiskCount = 0
    let mediumRiskCount = 0
    let lowRiskCount = 0

    // Practice Area aggregations for Active Matters
    const practiceAreas = { CORP: 0, IP: 0, LITIG: 0, RE: 0, OTHER: 0 }
    let maxPracticeAreaCount = 0;


    if (orgId && token && email) {
        // Sync profile to Supabase silently in the background
        void syncProfile(token, userId, email, orgId)

        try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
            const supabaseAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

            if (!supabaseUrl || !supabaseAdminKey) {
                console.error("🚨 CRITICAL: Missing SUPABASE_SERVICE_ROLE_KEY or URL in environment variables.")
                // Allow page to render empty state by aborting fetch
            } else {
                const supabaseAdmin = createClient(supabaseUrl, supabaseAdminKey)

                const tenantId = orgId || userId
                const { data, error } = await supabaseAdmin
                    .from('contracts')
                    .select('id, title, status, contract_value, currency, created_at, end_date, risk_level')
                    .eq('tenant_id', tenantId)
                    .neq('status', 'ARCHIVED')
                    .order('created_at', { ascending: false })

                console.log("Fetched docs:", data?.length, "for tenant:", tenantId)

                if (!error && data) {
                    documents = data
                    totalContracts = data.length

                    data.forEach(doc => {
                        // Defensive Mapping: Fallback to 0 and IDR
                        const val = Number(doc.contract_value) || 0
                        const curr = (doc.currency || 'IDR').toUpperCase()
                        portfolioValues[curr] = (portfolioValues[curr] || 0) + val

                        // Count risk levels
                        const risk = doc.risk_level?.toLowerCase()
                        if (risk === 'high') highRiskCount++
                        else if (risk === 'medium') mediumRiskCount++
                        else if (risk === 'low') lowRiskCount++
                    })
                } else if (error) {
                    console.error("Error fetching documents:", error.message || JSON.stringify(error))
                }

                // Fetch Matters for the Active Matters Chart
                const { data: mattersData, error: mattersError } = await supabaseAdmin
                    .from('matters')
                    .select('practice_area')
                    .eq('tenant_id', tenantId)
                    .neq('status', 'Closed')

                if (!mattersError && mattersData) {
                    mattersData.forEach(matter => {
                        const area = matter.practice_area ? matter.practice_area.toUpperCase().trim() : 'OTHER'

                        // Map specific keys or dump to OTHER if not matched
                        if (area.includes('CORP')) practiceAreas.CORP++
                        else if (area.includes('IP') || area.includes('INTELLECTUAL')) practiceAreas.IP++
                        else if (area.includes('LITIG')) practiceAreas.LITIG++
                        else if (area.includes('RE') || area.includes('REAL ESTATE')) practiceAreas.RE++
                        else practiceAreas.OTHER++
                    })

                    // Find the max to calculate relative percentage heights. 
                    maxPracticeAreaCount = Math.max(
                        practiceAreas.CORP, practiceAreas.IP, practiceAreas.LITIG, practiceAreas.RE, 1
                    ) // Ensure we never divide by 0
                } else if (mattersError) {
                    console.error("Error fetching matters:", mattersError.message)
                }
            }
        } catch (e: any) {
            console.error("Exception fetching data:", e.message || JSON.stringify(e))
        }
    }
    const formatCurrency = (amount: number, currencyCode: string = 'IDR') => {
        return new Intl.NumberFormat(currencyCode === 'IDR' ? 'id-ID' : 'en-US', {
            style: 'currency',
            currency: currencyCode,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const sortedCurrencies = Object.keys(portfolioValues).sort((a, b) => portfolioValues[b] - portfolioValues[a]);
    const primaryCurrency = sortedCurrencies[0] || 'IDR';
    const primaryValueFormatted = formatCurrency(portfolioValues[primaryCurrency] || 0, primaryCurrency);
    const hasMultipleCurrencies = sortedCurrencies.length > 1;

    // Getting current date for the header
    const today = new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    })

    return (
        <>
            <header className="py-4 border-b border-surface-border bg-surface/50 backdrop-blur-sm flex items-center justify-between px-8 shrink-0">
                <div className="flex flex-col items-center md:items-start pl-2">
                    <h1 className="font-display text-2xl text-white tracking-tight uppercase">
                        HELLO, {user?.firstName?.toUpperCase() || 'AGUGOKA'}!
                    </h1>
                    <p className="text-[10px] text-primary uppercase tracking-[0.3em] font-display mt-0.5 text-center md:text-left">
                        YOUR AGREEMENT INTELLIGENCE HUB
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <span className="material-symbols-outlined text-text-muted hover:text-white cursor-pointer">notifications</span>
                        <span className="absolute top-0 right-0 w-2 h-2 bg-primary rounded-full"></span>
                    </div>
                    <div className="h-4 w-[1px] bg-surface-border"></div>
                    <span className="text-sm text-text-muted">{today}</span>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto flex flex-col gap-6">

                    {/* Bento Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-surface border border-surface-border p-6 rounded hover:border-primary/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Total Portfolio Value</span>
                                <span className="material-symbols-outlined text-primary">account_balance</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-4xl text-white font-light">{primaryValueFormatted}</span>
                                {hasMultipleCurrencies && (
                                    <span className="text-xs text-text-muted font-medium bg-surface-border/50 px-1.5 py-0.5 rounded" title={sortedCurrencies.slice(1).map(c => formatCurrency(portfolioValues[c], c)).join(', ')}>
                                        +{sortedCurrencies.length - 1} more
                                    </span>
                                )}
                            </div>
                            <div className="mt-4 h-1 w-full bg-surface-border rounded-full overflow-hidden">
                                <div className="h-full bg-primary w-[100%]"></div>
                            </div>
                        </div>
                        <div className="bg-surface border border-surface-border p-6 rounded hover:border-primary/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Active Contracts</span>
                                <span className="material-symbols-outlined text-emerald-500">description</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-4xl text-white font-light">{totalContracts}</span>
                                <span className="text-sm text-text-muted font-medium">Indexed</span>
                            </div>
                            <div className="flex -space-x-2 mt-4">
                                {documents.slice(0, 3).map((doc, idx) => (
                                    <div key={idx} className="w-6 h-6 rounded-full border border-surface bg-neutral-800 text-[10px] flex items-center justify-center text-white" title={doc.title}>
                                        {doc.title?.charAt(0)?.toUpperCase() || '?'}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-surface border border-surface-border p-6 rounded hover:border-primary/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-sm font-medium text-text-muted uppercase tracking-wider">High Risk Exposure</span>
                                <span className="material-symbols-outlined text-red-500">warning</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-4xl text-white font-light">{highRiskCount}</span>
                                <span className="text-sm text-text-muted font-medium">Contracts</span>
                            </div>
                            <div className="mt-4 flex gap-1">
                                <div className={`h-1 flex-1 rounded-full ${highRiskCount > 0 ? 'bg-red-500' : 'bg-surface-border'}`}></div>
                                <div className={`h-1 flex-1 rounded-full ${highRiskCount > 1 ? 'bg-red-500' : 'bg-surface-border'}`}></div>
                                <div className={`h-1 flex-1 rounded-full ${highRiskCount > 2 ? 'bg-red-500/40' : 'bg-surface-border'}`}></div>
                                <div className="h-1 flex-1 bg-surface-border rounded-full"></div>
                            </div>
                        </div>
                    </div>

                    {/* Breakdowns */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-surface border border-surface-border p-6 rounded flex flex-col h-[320px]">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="font-display text-xl text-white">Active Matters</h3>
                                    <p className="text-xs text-text-muted">By Practice Area</p>
                                </div>
                                <button suppressHydrationWarning className="text-xs text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10">View All</button>
                            </div>
                            <div className="flex-1 flex items-end justify-between gap-4 px-2 pb-2">
                                <div className="flex flex-col items-center gap-2 flex-1 group" title={`Corp: ${practiceAreas.CORP}`}>
                                    <div className="w-full bg-surface-border relative h-40 rounded-t-sm overflow-hidden">
                                        <div
                                            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-primary/80 to-primary/40 group-hover:to-primary/60 transition-all duration-1000"
                                            style={{ height: `${(practiceAreas.CORP / maxPracticeAreaCount) * 100}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-[10px] uppercase tracking-wide text-text-muted">Corp</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1 group" title={`IP: ${practiceAreas.IP}`}>
                                    <div className="w-full bg-surface-border relative h-40 rounded-t-sm overflow-hidden">
                                        <div
                                            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-primary/80 to-primary/40 group-hover:to-primary/60 transition-all duration-1000"
                                            style={{ height: `${(practiceAreas.IP / maxPracticeAreaCount) * 100}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-[10px] uppercase tracking-wide text-text-muted">IP</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1 group" title={`Litigation: ${practiceAreas.LITIG}`}>
                                    <div className="w-full bg-surface-border relative h-40 rounded-t-sm overflow-hidden">
                                        <div
                                            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-primary/80 to-primary/40 group-hover:to-primary/60 transition-all duration-1000"
                                            style={{ height: `${(practiceAreas.LITIG / maxPracticeAreaCount) * 100}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-[10px] uppercase tracking-wide text-text-muted">Litig</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 flex-1 group" title={`Real Estate: ${practiceAreas.RE}`}>
                                    <div className="w-full bg-surface-border relative h-40 rounded-t-sm overflow-hidden">
                                        <div
                                            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-primary/80 to-primary/40 group-hover:to-primary/60 transition-all duration-1000"
                                            style={{ height: `${(practiceAreas.RE / maxPracticeAreaCount) * 100}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-[10px] uppercase tracking-wide text-text-muted">RE</span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-surface border border-surface-border p-6 rounded flex flex-col h-[320px]">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="font-display text-xl text-white">Portfolio Risk Distribution</h3>
                                    <p className="text-xs text-text-muted">Real-time clause analysis aggregation</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-primary"></span>
                                    <span className="text-xs text-text-muted">Total: {totalContracts}</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 h-full">
                                <div className="bg-surface-border/30 p-4 border border-surface-border/50 rounded flex flex-col justify-between hover:bg-surface-border/50 transition-colors col-span-2">
                                    <span className="text-xs text-text-muted uppercase tracking-wider">High Risk</span>
                                    <div className="flex items-end justify-between">
                                        <span className="text-2xl font-display text-white">{highRiskCount}</span>
                                        <div className="w-32 h-2 bg-surface-border rounded-full overflow-hidden">
                                            <div className="h-full bg-red-500 transition-all duration-1000" style={{ width: `${totalContracts > 0 ? (highRiskCount / totalContracts) * 100 : 0}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-surface-border/30 p-4 border border-surface-border/50 rounded flex flex-col justify-between hover:bg-surface-border/50 transition-colors">
                                    <span className="text-xs text-text-muted uppercase tracking-wider">Medium Risk</span>
                                    <div className="flex items-end justify-between mt-2">
                                        <span className="text-xl font-display text-white">{mediumRiskCount}</span>
                                        <div className="w-16 h-1 bg-surface-border rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-500 transition-all duration-1000" style={{ width: `${totalContracts > 0 ? (mediumRiskCount / totalContracts) * 100 : 0}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-surface-border/30 p-4 border border-surface-border/50 rounded flex flex-col justify-between hover:bg-surface-border/50 transition-colors">
                                    <span className="text-xs text-text-muted uppercase tracking-wider">Low Risk</span>
                                    <div className="flex items-end justify-between mt-2">
                                        <span className="text-xl font-display text-white">{lowRiskCount}</span>
                                        <div className="w-16 h-1 bg-surface-border rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${totalContracts > 0 ? (lowRiskCount / totalContracts) * 100 : 0}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Recent Documents */}
                    <RecentDocuments />
                </div>
            </div>
        </>
    )
}
