'use client'

import { Handle, Position } from '@xyflow/react'
import { useRouter } from 'next/navigation'

export default function ChildNode({ data }: { data: any }) {
    const router = useRouter()

    const isCompleted = data.status === 'completed'
    const isActive = data.status === 'active'
    const isPending = data.status === 'pending'

    return (
        <div
            onClick={() => data.id && router.push(`/dashboard/contracts/${data.id}`)}
            className={`
            bg-lux-sidebar rounded-lg p-4 w-64 shadow-xl transition-all duration-300 cursor-pointer hover:ring-1 hover:ring-[#888888]
            ${isActive && !data.isCurrent ? 'border border-[#3A3A3A] shadow-[0_0_20px_rgba(184, 184, 184,0.1)]' : ''}
            ${isPending && !data.isCurrent ? 'border border-dashed border-lux-text-muted/50 opacity-70' : ''}
            ${isCompleted && !data.isCurrent ? 'border border-lux-border opacity-60' : ''}
            ${data.isCurrent ? 'border-2 border-[#3A3A3A] ring-2 ring-[#888888]/50 shadow-[0_0_20px_rgba(184, 184, 184,0.4)] opacity-100' : ''}
        `}>
            {/* Invisible handle for incoming edges */}
            <Handle type="target" position={Position.Top} className="opacity-0" />

            <div className="flex justify-between items-center mb-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider
                    ${isActive ? 'bg-[#D4D4D4]/10 text-[#B8B8B8]' : ''}
                    ${isCompleted ? 'bg-white/5 text-lux-text-muted' : ''}
                    ${isPending ? 'bg-white/5 text-lux-text-muted' : ''}
                `}>
                    {data.category || 'Document'}
                </span>

                {isActive && <div className="size-2 rounded-full bg-[#D4D4D4] animate-pulse shadow-[0_0_10px_rgba(184, 184, 184,0.8)]"></div>}
                {isCompleted && <span className="material-symbols-outlined text-green-500 text-[14px]">check_circle</span>}
                {isPending && <span className="material-symbols-outlined text-lux-text-muted text-[14px]">schedule</span>}
            </div>

            <h4 className={`font-serif text-lg mb-1 leading-tight ${isCompleted ? 'text-lux-text-body' : 'text-white'}`}>
                {data.title || 'Untitled Document'}
            </h4>

            {data.value && (
                <div className="text-xs text-lux-text-muted font-mono mb-3">{data.value}</div>
            )}

            {isActive && data.progress && (
                <div className="mt-4">
                    <div className="flex justify-between text-[9px] text-lux-text-muted mb-1 font-bold uppercase tracking-wider">
                        <span>Progress</span>
                        <span className="text-[#B8B8B8]">{data.progress}%</span>
                    </div>
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-[#D4D4D4] shadow-[0_0_10px_rgba(184, 184, 184,0.5)]" style={{ width: `${data.progress}%` }}></div>
                    </div>
                </div>
            )}

            {isActive && data.warning && (
                <div className="mt-3 bg-red-900/20 border border-red-900/30 rounded px-2 py-1 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-red-500 text-[12px]">warning</span>
                    <span className="text-[9px] text-red-400 font-bold uppercase tracking-wider">Termination Cascade</span>
                </div>
            )}

            {/* If there are grand-children, add a source handle */}
            <Handle type="source" position={Position.Bottom} className="opacity-0" />
        </div>
    )
}
