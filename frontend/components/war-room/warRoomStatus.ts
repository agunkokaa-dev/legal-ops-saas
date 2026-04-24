export function getStatusColor(status: string) {
    switch (status) {
        case 'accepted': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        case 'rejected': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
        case 'countered': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
        case 'under_review': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
        case 'escalated': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
        default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
    }
}
