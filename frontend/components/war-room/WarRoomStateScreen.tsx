import { SSEStatusBadge } from '@/components/status/SSEStatusBadge';

interface WarRoomStateScreenProps {
    variant: 'loading' | 'error' | 'empty' | 'waiting';
    loadingStage?: string;
    waitingForRealtime?: boolean;
    realtimeError?: string | null;
    isSSEConnected?: boolean;
    isFallbackPolling?: boolean;
    onRetry?: () => void;
    onReturn?: () => void;
}

export default function WarRoomStateScreen({
    variant,
    loadingStage,
    waitingForRealtime,
    realtimeError,
    isSSEConnected,
    isFallbackPolling,
    onRetry,
    onReturn,
}: WarRoomStateScreenProps) {
    if (variant === 'loading') {
        return (
            <div className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] overflow-hidden relative">
                {/* Fallback Banner */}
                <div className="w-full h-14 bg-[#0a0a0a] border-b border-zinc-800/60 flex items-center px-8 shrink-0">
                    <div className="w-48 h-4 bg-zinc-800/60 rounded animate-pulse"></div>
                </div>

                <div className="flex-1 flex overflow-hidden opacity-50 relative pointer-events-none">
                    {/* Simulated Column A */}
                    <div className="w-[280px] border-r border-zinc-800/40 p-6 flex flex-col gap-4">
                        <div className="w-32 h-3 bg-zinc-800 rounded animate-pulse mb-2"></div>
                        <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                        <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                        <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                    </div>

                    {/* Simulated Column B */}
                    <div className="flex-1 p-10 flex flex-col gap-6">
                        <div className="w-3/4 h-8 bg-zinc-900 rounded animate-pulse mb-6"></div>
                        <div className="w-full h-4 bg-zinc-900 rounded animate-pulse"></div>
                        <div className="w-full h-4 bg-zinc-900 rounded animate-pulse"></div>
                        <div className="w-5/6 h-4 bg-zinc-900 rounded animate-pulse"></div>
                        <div className="w-full h-4 bg-zinc-900 rounded animate-pulse mt-4"></div>
                        <div className="w-4/5 h-4 bg-zinc-900 rounded animate-pulse"></div>
                    </div>

                    {/* Simulated Column C */}
                    <div className="w-[380px] border-l border-zinc-800/40 p-6 flex flex-col gap-4">
                        <div className="w-40 h-4 bg-zinc-800 rounded animate-pulse mb-2"></div>
                        <div className="w-full h-32 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse"></div>
                        <div className="w-full h-64 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse mt-4"></div>
                        <div className="w-full h-20 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse mt-4"></div>
                    </div>
                </div>

                {/* Prominent Center Overlay */}
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/60 backdrop-blur-sm">
                    <div className="bg-[#111] border border-[#d4af37]/30 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-md text-center">
                        <div className="w-16 h-16 rounded-full border border-[#d4af37]/20 bg-[#d4af37]/10 flex items-center justify-center mb-6">
                            <span className="material-symbols-outlined text-[#d4af37] text-3xl animate-spin" style={{ animationDuration: '3s' }}>sync</span>
                        </div>
                        <h3 className="text-white font-serif font-bold text-lg mb-3 tracking-wide text-[#d4af37]">AI Processing Documents</h3>
                        <p className="text-zinc-400 text-sm leading-relaxed">
                            Please wait, AI Co-Counsel is comparing V1 against V2 and formulating BATNA strategies...
                        </p>
                        <div className="w-full h-1 bg-zinc-800 mt-6 rounded overflow-hidden">
                            <div className="h-full bg-[#d4af37]/50 w-full animate-pulse"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (variant === 'error') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] h-[calc(100vh-70px)]">
                <div className="bg-[#111] border border-rose-900/50 p-8 rounded-2xl shadow-[0_0_30px_rgba(225,29,72,0.1)] flex flex-col items-center max-w-md text-center">
                    <span className="text-4xl mb-4">❌</span>
                    <h3 className="text-rose-400 font-serif font-bold text-lg mb-3 tracking-wide">AI Processing Failed</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                        {realtimeError}
                    </p>
                    <div className="flex gap-4">
                        <button onClick={onRetry} className="bg-rose-900/20 hover:bg-rose-900/40 text-rose-300 border border-rose-900/50 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                            Try Again
                        </button>
                        <button onClick={onReturn} className="text-zinc-500 hover:text-zinc-300 px-6 py-2 rounded uppercase text-xs font-bold tracking-widest transition-all">
                            Return to Workspace
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0a] text-[#e5e2e1] overflow-hidden">
            {/* Skeleton Header */}
            <section className="w-full h-14 bg-[#0a0a0a] border-b border-zinc-800/60 flex items-center justify-between px-8 shrink-0">
                <div className="flex items-center gap-4">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">Negotiation War Room</p>
                        <p className="text-xs text-zinc-400 mt-1">{loadingStage}</p>
                    </div>
                </div>
                <SSEStatusBadge isConnected={Boolean(isSSEConnected)} isFallbackPolling={Boolean(isFallbackPolling)} />
            </section>

            <section className="flex-1 flex overflow-hidden">
                {/* Skeleton Column A */}
                <aside className="w-[280px] border-r border-zinc-800/40 p-6 flex flex-col gap-6">
                    <div className="w-24 h-2 bg-zinc-800 rounded animate-pulse mb-4"></div>
                    <div className="w-full h-16 bg-[#111] rounded animate-pulse"></div>
                    <div className="w-full h-16 bg-[#111] rounded animate-pulse"></div>

                    <div className="mt-8">
                        <div className="w-32 h-2 bg-zinc-800 rounded animate-pulse mb-4"></div>
                        <div className="space-y-3">
                            <div className="w-full h-24 bg-[#0f0f0f] border border-zinc-900 rounded-lg animate-pulse"></div>
                            <div className="w-full h-24 bg-[#0f0f0f] border border-zinc-900 rounded-lg animate-pulse"></div>
                        </div>
                    </div>
                </aside>

                {/* Skeleton Column B */}
                <section className="flex-1 p-12 bg-[#0a0a0a] relative flex justify-center">
                    {/* Loading Overlay */}
                    <div className="absolute inset-0 bg-[#0a0a0a]/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
                        <div className="flex items-center gap-4 mb-4">
                            <span className="w-6 h-6 border-2 border-[#D4AF37]/20 rounded-full animate-spin border-t-[#D4AF37]"></span>
                            <h3 className="font-serif text-[#D4AF37] text-lg tracking-wide animate-pulse">{waitingForRealtime ? 'Waiting for live updates...' : 'AI Co-Counsel is finalizing the War Room Diff...'}</h3>
                        </div>
                        <p className="text-xs text-zinc-500 uppercase tracking-widest max-w-sm text-center">{loadingStage}</p>
                    </div>

                    <div className="max-w-3xl w-full h-[800px] bg-[#0f0f0f] border border-zinc-800/40 rounded-xl p-16 overflow-hidden">
                        <div className="w-64 h-6 bg-zinc-800/50 rounded animate-pulse mb-12 mx-auto"></div>
                        <div className="space-y-4">
                            <div className="w-full h-4 bg-zinc-800/30 rounded animate-pulse"></div>
                            <div className="w-[90%] h-4 bg-zinc-800/30 rounded animate-pulse"></div>
                            <div className="w-[95%] h-4 bg-zinc-800/30 rounded animate-pulse"></div>
                            <div className="w-[80%] h-4 bg-zinc-800/30 rounded animate-pulse mb-8"></div>
                            <div className="w-full h-32 bg-[#1a0f0f]/50 border border-rose-900/20 rounded animate-pulse"></div>
                        </div>
                    </div>
                </section>
            </section>
        </div>
    );
}
