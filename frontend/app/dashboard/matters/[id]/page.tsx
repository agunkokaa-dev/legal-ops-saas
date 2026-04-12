import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getMatterById, getMatterTasks } from '@/app/actions/matterActions'
import MatterDetailHeader from '@/components/matter-detail/MatterDetailHeader'
import MatterTabs from '@/components/matter-detail/MatterTabs'
import OverviewTab from '@/components/matter-detail/OverviewTab'
import DocumentsTab from '@/components/matter-detail/DocumentsTab'
import ObligationMaster from '@/components/genealogy/ObligationMaster'
import MatterGenealogyPanel from '@/components/genealogy/MatterGenealogyPanel'

export const dynamic = 'force-dynamic'

export default async function MatterDetailPage(props: { params: Promise<{ id: string }>, searchParams?: Promise<{ tab?: string }> }) {
    const params = await props.params;
    const matterId = params.id;

    const searchParams = await props.searchParams;
    const currentTab = searchParams?.tab || 'overview';

    // 1. Authenticate user
    const { userId, orgId } = await auth();
    if (!userId) {
        redirect('/');
    }

    // 2. Fetch Matter and Tasks Server Actions
    const { data: matter, error: matterError } = await getMatterById(matterId);
    if (matterError || !matter) {
        return (
            <div className="flex-1 flex flex-col h-full bg-[#0a0a0a] text-white p-8">
                <div className="max-w-7xl mx-auto flex flex-col gap-6 w-full text-center py-20">
                    <h1 className="text-3xl font-display text-text-muted">404 - Matter Not Found</h1>
                    <p className="text-text-muted mt-2">The case file you are looking for does not exist or you do not have access.</p>
                    <div className="mt-6">
                        <Link href="/dashboard/matters" className="text-primary hover:text-white transition-colors border border-primary/30 px-4 py-2 rounded">
                            Return to Matters
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const { data: tasks, error: tasksError } = await getMatterTasks(matterId);
    const matterTasks = tasks || [];

    // 3. Render Master Layout skeleton
    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0a0a] text-gray-300 font-sans min-h-screen">
            <main className="flex-grow max-w-[1600px] mx-auto w-full p-6 md:p-8 overflow-y-auto">
                <Link href="/dashboard/matters" className="text-xs text-text-muted hover:text-white flex items-center gap-1 mb-4 w-fit transition-colors">
                    <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                    Back to Matters
                </Link>

                {/* Header */}
                <MatterDetailHeader matter={matter} />

                {/* Tabs */}
                <MatterTabs activeTab={currentTab} />

                {currentTab === 'genealogy' ? (
                    <div className="flex flex-col lg:flex-row gap-6 mt-2 items-stretch min-h-[650px] lg:h-[750px] mb-10">
                        {/* Left: Interactive Visual Graph */}
                        <div className="w-full lg:w-[60%] h-full">
                            <MatterGenealogyPanel matterId={matter.id} />
                        </div>

                        {/* Right: Obligations Panel */}
                        <div className="w-full lg:w-[40%] h-full">
                            <ObligationMaster matterId={matter.id} />
                        </div>
                    </div>
                ) : currentTab === 'documents' ? (
                    <DocumentsTab matterId={matter.id} />
                ) : (
                    <OverviewTab matterId={matter.id} matterData={matter} tasks={matterTasks} />
                )}
            </main>
        </div>
    );
}
