import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import NewMatterModal from '@/components/NewMatterModal'
import DeleteMatterModal from '@/components/DeleteMatterModal'
import MattersToolbar from '@/components/MattersToolbar'
export const dynamic = 'force-dynamic'

export default async function MattersDashboard(props: { searchParams?: Promise<{ query?: string; status?: string; practice_area?: string }> }) {
    const searchParams = await props.searchParams;
    const query = searchParams?.query || '';
    const statusFilter = searchParams?.status || '';
    const practiceAreaFilter = searchParams?.practice_area || '';

    const { userId, orgId } = await auth()

    if (!userId) {
        redirect('/')
    }

    const tenantId = orgId || userId

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

    let matters: any[] = []
    let thisWeekMatters = 0
    let lastWeekMatters = 0
    let renewalsCount = 0
    let highRiskCount = 0

    if (supabaseUrl && supabaseAdminKey) {
        const supabase = createClient(supabaseUrl, supabaseAdminKey)

        // 1. Fetch ALL Matters for growth metric
        const { data: allMattersData, error: allMattersError } = await supabase
            .from('matters')
            .select('*')
            .eq('tenant_id', tenantId)

        if (!allMattersError && allMattersData) {
            const now = new Date()
            const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
            const last14Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

            allMattersData.forEach(m => {
                const created = new Date(m.created_at)
                if (created >= last7Days) {
                    thisWeekMatters++
                } else if (created >= last14Days) {
                    lastWeekMatters++
                }
            })
        }

        // 1b. Fetch Filtered Matters for the list
        let supabaseQuery = supabase
            .from('matters')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })

        // Apply filters if they exist in the URL
        // Terapkan filter dari URL
        if (query) {
            // Hapus 'id.eq' dari sini agar tidak bentrok dengan tipe data UUID
            // Tambahkan pencarian ke kolom teks lainnya biar makin pintar
            supabaseQuery = supabaseQuery.or(`title.ilike.%${query}%,client_name.ilike.%${query}%,practice_area.ilike.%${query}%`);
        }

        if (statusFilter) {
            supabaseQuery = supabaseQuery.eq('status', statusFilter);
        }

        if (practiceAreaFilter) {
            supabaseQuery = supabaseQuery.eq('practice_area', practiceAreaFilter);
        }

        const { data: mattersData, error: mattersError } = await supabaseQuery

        if (!mattersError && mattersData) {
            matters = mattersData
        }
        // 2. Fetch Contracts for Renewal & Risk metrics
        const { data: contractsData, error: contractsError } = await supabase
            .from('contracts')
            .select('end_date, risk_level')
            .eq('tenant_id', tenantId)

        if (!contractsError && contractsData) {
            const now = new Date()
            const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            contractsData.forEach(c => {
                if (c.end_date) {
                    const endDate = new Date(c.end_date)
                    if (!isNaN(endDate.getTime())) {
                        if (endDate >= now && endDate <= next30Days) {
                            renewalsCount++
                        }
                    }
                }

                if (c.risk_level?.toLowerCase() === 'high') {
                    highRiskCount++
                }
            })
        }
    }

    const growthDiff = thisWeekMatters - lastWeekMatters
    const growthText = growthDiff >= 0 ? `+${growthDiff} vs last week` : `${growthDiff} vs last week`

    const getPracticeAreaStyle = (area: string) => {
        const lower = area?.toLowerCase() || '';
        if (lower.includes('litigation')) return 'bg-red-500/10 text-red-500 border-red-500/20';
        if (lower.includes('m&a') || lower.includes('merger')) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
        if (lower.includes('ip') || lower.includes('intellectual')) return 'bg-[#1C1C1C] text-[#B8B8B8] border-[#2A2A2A]';
        return 'bg-zinc-800/70 text-zinc-300 border-zinc-700'; // Default / Corporate
    }

    const getStatusStyle = (status: string) => {
        const lower = status?.toLowerCase() || '';
        if (lower === 'open' || lower === 'active' || lower === 'ready') return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        if (lower === 'action' || lower === 'critical') return 'bg-red-500/10 text-red-400 border border-red-500/20';
        if (lower === 'review' || lower === 'drafting') return 'bg-[#1C1C1C] text-[#B8B8B8] border border-[#2A2A2A]';
        return 'bg-surface-border/50 text-text-muted border border-surface-border'; // Default / Closed / On Hold
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#0a0a0a] text-white">
            <header className="h-16 border-b border-surface-border bg-surface/50 backdrop-blur-sm flex items-center justify-between px-8 shrink-0">
                <h1 className="font-display text-2xl text-white font-light tracking-tight">Matters Intelligence</h1>
                <div className="flex items-center gap-4">
                    <NewMatterModal />
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto flex flex-col gap-6">

                    {/* Bento Grid Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Weekly Matters Growth Card (Exact clone of Total Portfolio Value) */}
                        <div className="bg-surface border border-surface-border p-6 rounded hover:border-primary/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Weekly Growth</span>
                                <span className="material-symbols-outlined text-primary">trending_up</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-4xl text-white font-light">{thisWeekMatters}</span>
                                <span className="text-sm text-text-muted font-medium">{growthText}</span>
                            </div>
                            <div className="mt-4 h-1 w-full bg-surface-border rounded-full overflow-hidden">
                                <div className="h-full bg-primary w-[100%]"></div>
                            </div>
                        </div>

                        {/* Renewal Alerts Card (Exact clone of Active Contracts) */}
                        <div className="bg-surface border border-surface-border p-6 rounded hover:border-primary/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Renewal Alerts</span>
                                <span className="material-symbols-outlined text-amber-500">warning</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-4xl text-white font-light">{renewalsCount}</span>
                                <span className="text-sm text-text-muted font-medium">Contracts expiring soon</span>
                            </div>
                            <div className="flex -space-x-2 mt-4">
                                {matters.slice(0, 3).map((matter, idx) => (
                                    <div key={idx} className="w-6 h-6 rounded-full border border-surface bg-neutral-800 text-[10px] flex items-center justify-center text-white" title={matter.title || matter.name}>
                                        {(matter.title || matter.name)?.charAt(0)?.toUpperCase() || '?'}
                                    </div>
                                ))}
                                {matters.length === 0 && (
                                    <div className="w-6 h-6 rounded-full border border-surface bg-neutral-800 text-[10px] flex items-center justify-center text-white">
                                        +
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Risk Profile Card (Exact clone of High Risk Exposure) */}
                        <div className="bg-surface border border-surface-border p-6 rounded hover:border-primary/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-sm font-medium text-text-muted uppercase tracking-wider">Risk Profile</span>
                                <span className="material-symbols-outlined text-red-500">warning</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-4xl text-white font-light">{highRiskCount}</span>
                                <span className="text-sm text-text-muted font-medium">High-risk flags detected</span>
                            </div>
                            <div className="mt-4 flex gap-1">
                                <div className={`h-1 flex-1 rounded-full ${highRiskCount > 0 ? 'bg-red-500' : 'bg-surface-border'}`}></div>
                                <div className={`h-1 flex-1 rounded-full ${highRiskCount > 1 ? 'bg-red-500' : 'bg-surface-border'}`}></div>
                                <div className={`h-1 flex-1 rounded-full ${highRiskCount > 2 ? 'bg-red-500/40' : 'bg-surface-border'}`}></div>
                                <div className="h-1 flex-1 bg-surface-border rounded-full"></div>
                            </div>
                        </div>
                    </div>

                    {/* Matters List (Exact clone of DocumentList) */}
                    <div className="bg-surface border border-surface-border rounded overflow-hidden">
                        <MattersToolbar />
                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap">
                                <thead className="bg-transparent text-text-muted text-[10px] uppercase tracking-widest border-b border-surface-border">
                                    <tr>
                                        <th className="px-4 py-4 font-semibold">Matter Details</th>
                                        <th className="px-4 py-4 font-semibold">Client</th>
                                        <th className="px-4 py-4 font-semibold">Type</th>
                                        <th className="px-4 py-4 font-semibold">Value</th>
                                        <th className="px-4 py-4 font-semibold">Next Milestone</th>
                                        <th className="px-4 py-4 font-semibold">Status</th>
                                        <th className="px-4 py-4 font-semibold text-right"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-border/50 text-sm">
                                    {matters.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-12 text-center text-text-muted">No matters found. Create one to get started.</td>
                                        </tr>
                                    ) : (
                                        matters.map((matter) => (
                                            <tr key={matter.id} className="hover:bg-white/[0.02] transition-colors group">
                                                <td className="px-4 py-4">
                                                    <Link href={`/dashboard/matters/${matter.id}`} className="block group">
                                                        <div className="font-medium text-white group-hover:text-primary transition-colors">
                                                            {matter.title || 'Untitled Matter'}
                                                        </div>
                                                        <div className="text-[11px] text-text-muted mt-0.5 font-mono group-hover:text-text-muted/80">
                                                            ID-{matter.id?.split('-')[0]?.toUpperCase() || '0000'}
                                                        </div>
                                                    </Link>
                                                </td>
                                                <td className="px-4 py-4 flex items-center gap-3">
                                                    <div className="w-6 h-6 rounded-full bg-[#1C1C1C] border border-[#3A3A3A] flex items-center justify-center text-[10px] font-bold text-[#B8B8B8]">
                                                        {(matter.client_name)?.substring(0, 2).toUpperCase() || 'CL'}
                                                    </div>
                                                    <span className="text-white text-sm">{matter.client_name || 'Unknown Client'}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${getPracticeAreaStyle(matter.practice_area)}`}>
                                                        {matter.practice_area || 'Corporate'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 font-mono text-xs text-primary/80">
                                                    Rp --
                                                </td>
                                                <td className="px-4 py-4 text-xs text-text-muted flex items-center gap-1.5">
                                                    <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                                                    TBD
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide ${getStatusStyle(matter.status)}`}>
                                                        {matter.status || 'Draft'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <DeleteMatterModal matterId={matter.id} matterTitle={matter.title || 'Untitled'} />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
