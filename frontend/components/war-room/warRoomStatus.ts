export function getStatusColor(status: string) {
    switch (status) {
        case 'accepted': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        case 'rejected': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
        case 'countered': return 'bg-[#1C1C1C] text-[#B8B8B8] border-[#3A3A3A]';
        case 'under_review': return 'bg-[#B8B8B8]/20 text-[#B8B8B8] border-[#3A3A3A]';
        case 'escalated': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
        default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
    }
}
