import { LucideIcon } from 'lucide-react'

export default function MatterDetailHeader({ matter }: { matter: any }) {
    const getPracticeAreaStyle = (area: string) => {
        const lower = area?.toLowerCase() || '';
        if (lower.includes('litigation')) return 'bg-red-500/10 text-red-500 border-red-500/20';
        if (lower.includes('m&a') || lower.includes('merger')) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
        if (lower.includes('ip') || lower.includes('intellectual')) return 'bg-[#1C1C1C] text-[#B8B8B8] border-[#2A2A2A]';
        return 'bg-zinc-800/70 text-zinc-300 border-zinc-700'; // Default / Corporate
    }

    const matterIdShort = matter.id?.split('-')[0]?.toUpperCase() || '0000';

    return (
        <header className="mb-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium ${getPracticeAreaStyle(matter.practice_area)}`}>
                            {matter.practice_area || 'Corporate'}
                        </span>
                        <span className="text-gray-500 text-xs uppercase tracking-widest font-mono">MAT-{matterIdShort}</span>
                    </div>

                    <h1 className="font-display text-3xl md:text-4xl lg:text-5xl text-white leading-tight font-light">
                        {matter.title || 'Untitled Matter'}
                    </h1>

                    <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-sm text-gray-400 font-light mt-1">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-primary/70">business_center</span>
                            <span>Client: <span className="text-gray-200 font-normal">{matter.client_name || 'Unknown Client'}</span></span>
                        </div>
                        <div className="w-px h-3 bg-gray-700 hidden md:block"></div>
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-primary/70">domain</span>
                            <span>Industry: <span className="text-gray-200 font-normal">{matter.industry || 'Unspecified'}</span></span>
                        </div>
                        <div className="w-px h-3 bg-gray-700 hidden md:block"></div>
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-primary/70">person</span>
                            <span>Lead: <span className="text-gray-200 font-normal">{matter.lead_attorney || 'Unassigned'}</span></span>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    )
}
