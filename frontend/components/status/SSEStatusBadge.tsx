'use client'

export function SSEStatusBadge({
    isConnected,
    isFallbackPolling = false,
}: {
    isConnected: boolean
    isFallbackPolling?: boolean
}) {
    const dotClass = isFallbackPolling
        ? 'bg-amber-500'
        : isConnected
            ? 'bg-emerald-500 animate-pulse'
            : 'bg-red-500'

    const label = isFallbackPolling
        ? 'Polling Fallback'
        : isConnected
            ? 'Live'
            : 'Reconnecting...'

    return (
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-neutral-500">
            <span className={`h-2 w-2 rounded-full ${dotClass}`} />
            <span>{label}</span>
        </div>
    )
}
