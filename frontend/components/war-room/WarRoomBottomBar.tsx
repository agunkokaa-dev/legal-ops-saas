'use client';
import { AlertCircle, GitCompare, BookmarkCheck, CheckCircle, ChevronRight } from 'lucide-react';

interface WarRoomBottomBarProps {
    pendingCount: number;
    issueCount: number;
    onFinalizeClick: () => void;
    onCompareClick: () => void;
    onIssueTrackerClick: () => void;
}

export function WarRoomBottomBar({
    pendingCount, issueCount, onFinalizeClick, onCompareClick, onIssueTrackerClick
}: WarRoomBottomBarProps) {
    return (
        <div className="flex items-center justify-between px-6 py-3
                        border-t border-zinc-800/60 bg-[#0D0D14] flex-shrink-0 z-10">
            {/* Left actions */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onIssueTrackerClick}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg
                               bg-zinc-800/60 border border-zinc-700/60
                               text-zinc-300 text-sm hover:bg-zinc-700/60 transition"
                >
                    <AlertCircle className="w-4 h-4" />
                    {pendingCount} Pending Issues
                    <ChevronRight className="w-3.5 h-3.5" />
                </button>

                <button
                    onClick={onCompareClick}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg
                               bg-zinc-800/60 border border-zinc-700/60
                               text-zinc-300 text-sm hover:bg-zinc-700/60 transition"
                >
                    <GitCompare className="w-4 h-4" />
                    Compare Versions
                </button>

                <button
                    onClick={onIssueTrackerClick}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg
                               bg-zinc-800/60 border border-zinc-700/60
                               text-zinc-300 text-sm hover:bg-zinc-700/60 transition"
                >
                    <BookmarkCheck className="w-4 h-4" />
                    Issue Tracker
                    {issueCount > 0 && (
                        <span className="w-4 h-4 rounded-full bg-zinc-700 text-[10px]
                                         flex items-center justify-center font-medium">
                            {issueCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Primary CTA */}
            <button
                onClick={onFinalizeClick}
                className="flex items-center gap-2 px-6 py-2.5
                           bg-[#B8B8B8] hover:bg-[#D4D4D4] active:scale-95
                           text-[#0A0A0A] font-semibold text-sm rounded-lg
                           transition-all shadow-lg shadow-[#888888]/20"
            >
                <CheckCircle className="w-4 h-4" />
                Finalize Negotiation Round
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
    );
}
