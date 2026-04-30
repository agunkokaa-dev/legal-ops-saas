'use client';
import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft,
    BarChart2,
    ChevronDown,
    FileText,
    FileCheck,
    FilePenLine,
} from 'lucide-react';
import Image from 'next/image';

interface WarRoomHeaderProps {
    contractTitle: string;
    documentTitle?: string;
    viewMode: 'v1' | 'v2' | 'v3';
    onViewModeChange: (mode: 'v1' | 'v2' | 'v3') => void;
    onBack: () => void;
    allResolved: boolean;
    pendingIssueCount: number;
    onFinalizeClick: () => void;
    onEditMode: () => void | Promise<void>;
}

export function WarRoomHeader({
    contractTitle,
    documentTitle,
    viewMode,
    onViewModeChange,
    onBack,
    allResolved,
    pendingIssueCount,
    onFinalizeClick,
    onEditMode,
}: WarRoomHeaderProps) {
    const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
    const analysisMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!analysisMenuOpen) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (!analysisMenuRef.current?.contains(event.target as Node)) {
                setAnalysisMenuOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setAnalysisMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [analysisMenuOpen]);

    return (
        <header className="relative flex items-center justify-between px-6 py-3
                           border-b border-zinc-800/60 bg-[#0D0D14] flex-shrink-0 z-10">
            {/* Left */}
            <div className="flex items-center gap-4 relative z-10">
                <div className="flex items-center justify-center shrink-0">
                    <Image src="/image_6.png.png" alt="Clause Nautilus" width={32} height={32} className="object-contain invert opacity-90" />
                </div>
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-sm text-zinc-400
                               hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Contract
                </button>
            </div>

            {/* Center */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-40">
                <div className="flex flex-col items-center justify-center min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                        {documentTitle || contractTitle || 'Contract Document'}
                    </div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                        Negotiation War Room Diff
                    </div>
                </div>
            </div>
            {/* Right */}
            <div className="relative z-10 flex items-center gap-2">


                {/* View Mode toggle */}
                <div className="flex items-center bg-zinc-800/60 rounded-lg p-1 gap-1">
                    <span className="text-[11px] text-zinc-500 px-1">View Mode</span>
                    <button
                        onClick={() => onViewModeChange('v2')}
                        className={`p-1.5 rounded transition-colors
                            ${viewMode === 'v2' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        <FileText className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onViewModeChange('v3')}
                        className={`p-1.5 rounded transition-colors
                            ${viewMode === 'v3' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        <FileCheck className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Analysis Mode */}
                <div ref={analysisMenuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setAnalysisMenuOpen((current) => !current)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/60
                                   border border-zinc-700/60 rounded-lg text-sm
                                   text-zinc-300 hover:bg-zinc-700/60 transition-colors"
                    >
                        <BarChart2 className="w-3.5 h-3.5 text-zinc-400" />
                        Analysis Mode
                        <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${analysisMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {analysisMenuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-zinc-800/80 bg-[#11111A] p-2 shadow-2xl shadow-black/40">
                            <button
                                type="button"
                                onClick={() => {
                                    setAnalysisMenuOpen(false);
                                    void onEditMode();
                                }}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800/60 hover:text-white"
                            >
                                <FilePenLine className="h-4 w-4 text-[#B8B8B8]" />
                                <span>Edit Mode</span>
                                <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">Smart Composer</span>
                            </button>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onFinalizeClick}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all ${allResolved
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500'
                        : 'bg-[#B8B8B8] text-[#0A0A0A] shadow-lg shadow-[#888888]/20 hover:bg-[#D4D4D4]'
                    }`}
                >
                    <span className={`material-symbols-outlined text-sm ${allResolved ? 'text-white' : 'text-[#0A0A0A]'}`}>task_alt</span>
                    Finalize Round
                    {pendingIssueCount > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-xs ${allResolved ? 'bg-black/20 text-white' : 'bg-zinc-900/15 text-[#0A0A0A]'}`}>
                            {pendingIssueCount}
                        </span>
                    )}
                </button>
            </div>
        </header>
    );
}
