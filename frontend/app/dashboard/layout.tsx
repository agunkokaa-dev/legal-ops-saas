'use client'

import Sidebar from '@/components/Sidebar'
import AssistantSidebar from '@/components/AssistantSidebar'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTenantSSE } from '@/hooks/useTenantSSE'
import { toast } from 'sonner'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(350); // Default width 350px
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef(false);
    const pathname = usePathname();
    const router = useRouter();

    const isContractDetailPage = pathname?.startsWith('/dashboard/contracts/');
    const isTaskPage = pathname?.includes('/dashboard/tasks');
    const isSettingsPage = pathname?.includes('/dashboard/settings');
    const isDraftingPage = pathname?.includes('/dashboard/drafting');

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = true;
        setIsDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragRef.current) return;
        // Calculate width from the right edge of the screen
        const newWidth = window.innerWidth - e.clientX;
        // Limit min to 250px and max to 50% of the screen
        if (newWidth > 250 && newWidth < window.innerWidth * 0.5) {
            setSidebarWidth(newWidth);
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        if (dragRef.current) {
            dragRef.current = false;
            setIsDragging(false);
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        }
    }, []);

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    const togglePanel = () => {
        setIsCollapsed(!isCollapsed);
    };

    useTenantSSE({
        onContractCreated: (event) => {
            router.refresh();
            if (pathname === '/dashboard' || pathname?.includes('/documents')) {
                toast.info(`"${String(event.data.contract_title || 'New contract')}" uploaded`)
            }
        },
        onContractStatusChanged: (event) => {
            router.refresh();
            const newStatus = String(event.data.new_status || '');
            const title = String(event.data.contract_title || 'Contract');
            if (newStatus === 'Queued') {
                toast.info(`"${title}" queued for AI processing`)
            } else if (newStatus === 'Reviewed') {
                toast.info(`"${title}" analysis complete`)
            } else if (newStatus === 'Executed') {
                toast.success(`"${title}" has been fully executed`)
            }
        },
        onContractExecuted: (event) => {
            router.refresh();
            toast.success(`"${String(event.data.contract_title || 'Contract')}" has been executed`)
        },
        onTaskCreated: (event) => {
            router.refresh();
            if (event.data.task_title) {
                toast.info(`New task: ${String(event.data.task_title)}`)
            }
        },
    })

    return (
        <div className="bg-background text-white h-screen w-screen flex overflow-hidden">
            <Sidebar />

            {/* Main Dashboard Panel */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {children}

                {/* ==================== BOTTOM STATUS RAIL ==================== */}
                <aside
                    className="shrink-0 bg-background border-t border-surface-border px-8 py-2 flex items-center justify-between"
                    data-purpose="system-status"
                >
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                            <span className="text-[10px] uppercase tracking-tighter text-gray-500">
                                AI Engine: Online
                            </span>
                        </div>
                        <div className="h-4 w-[1px] bg-surface-border"></div>
                        <span className="text-[10px] uppercase tracking-tighter text-gray-500">
                            Security: AES-256 Encrypted
                        </span>
                    </div>
                    <div className="text-[10px] text-gray-600 font-display italic">
                        Confidential Legal Terminal v4.0.1
                    </div>
                </aside>

                {/* Block pointer events on iframe/content while dragging to prevent stutter */}
                {isDragging && <div className="absolute inset-0 z-50 bg-transparent" />}
            </div>

            {/* Native Resizer Handle */}
            {!isContractDetailPage && !isSettingsPage && !isDraftingPage && !isCollapsed && (
                <div
                    onMouseDown={handleMouseDown}
                    className="w-2 bg-background hover:bg-surface-border cursor-col-resize z-50 flex flex-col justify-center items-center relative group"
                >
                    <div className="h-10 w-1 flex items-center justify-center rounded-sm bg-surface-border group-hover:bg-primary/50 transition-colors">
                        <GripVertical className="w-4 h-5 text-text-muted group-hover:text-white" />
                    </div>
                </div>
            )}

            {/* Assistant Panel */}
            {!isContractDetailPage && !isTaskPage && !isSettingsPage && !isDraftingPage && (
                <div
                    style={{ width: isCollapsed ? '0px' : `${sidebarWidth}px` }}
                    className={`flex flex-col h-full overflow-hidden border-l border-white/10 shrink-0 ${!isDragging ? 'transition-all duration-300 ease-in-out' : ''}`}
                >
                    {/* Inner wrapper prevents content crush during collapse */}
                    <div className="w-full h-full min-w-[250px]">
                        <AssistantSidebar />
                    </div>
                </div>
            )}

            {/* Programmatic Toggle Button Overlay */}
            {!isContractDetailPage && !isTaskPage && !isSettingsPage && !isDraftingPage && (
                <button
                    suppressHydrationWarning
                    onClick={togglePanel}
                    className={`absolute top-1/2 -translate-y-1/2 z-[60] flex items-center justify-center w-6 h-8 bg-surface-border hover:bg-primary/80 text-text-muted hover:text-white rounded-l shadow-lg border border-surface-border transition-all duration-300 ${isCollapsed ? 'right-0' : ''}`}
                    style={{ right: isCollapsed ? '0px' : `${sidebarWidth}px` }}
                >
                    {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
            )}
        </div>
    )
}
