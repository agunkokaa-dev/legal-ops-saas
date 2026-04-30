'use client'

import { useState } from 'react'
import { toggleMatterTask } from '@/app/actions/matterActions'
import { toast } from 'sonner'

export default function AIRecommendedTasks({ matterId, initialTasks }: { matterId: string, initialTasks: any[] }) {
    const [tasks, setTasks] = useState(initialTasks || []);
    const pendingCount = tasks.filter(t => !t.is_completed).length;

    const handleToggle = async (taskId: string, currentStatus: boolean) => {
        // Optimistic update
        const updatedTasks = tasks.map(t =>
            t.id === taskId ? { ...t, is_completed: !currentStatus } : t
        );
        setTasks(updatedTasks);

        // Server update
        const res = await toggleMatterTask(taskId, !currentStatus, matterId);
        if (!res.success) {
            // Revert on failure
            setTasks(initialTasks);
            toast.error("Failed to update task: " + res.error);
        }
    };

    const getPriorityStyle = (priority: string) => {
        const p = priority?.toLowerCase() || 'normal';
        if (p === 'high') return 'border-primary/40 text-primary bg-primary/5';
        if (p === 'urgent') return 'border-red-500/30 text-red-400 bg-red-500/5';
        return 'border-surface-border text-text-muted bg-[#0a0a0a]';
    }

    return (
        <div className="lg:col-span-12 bg-surface border border-surface-border rounded flex flex-col relative overflow-hidden transition-all duration-300 hover:border-gray-700">
            <div className="p-6 border-b border-surface-border flex items-center justify-between bg-gradient-to-r from-surface to-[#0a0a0a]/30">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px] text-primary">auto_fix_high</span>
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-white">AI Recommended Tasks</h2>
                        <p className="text-xs text-text-muted">Generated automatically based on contract analysis</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted mr-2">{pendingCount} pending items</span>
                    <button className="text-xs font-medium text-primary hover:text-white transition-colors px-3 py-1.5 rounded border border-primary/30 hover:border-primary/60 hover:bg-primary/10">
                        View All
                    </button>
                </div>
            </div>

            <div className="divide-y divide-surface-border/50">
                {tasks.length === 0 ? (
                    <div className="p-8 text-center flex flex-col items-center justify-center">
                        <span className="material-symbols-outlined text-[32px] text-surface-border mb-2">task</span>
                        <p className="text-sm text-text-muted">No pending tasks for this matter.</p>
                    </div>
                ) : (
                    tasks.map((task) => (
                        <div key={task.id} className={`group flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors ${task.is_completed ? 'opacity-50' : ''}`}>
                            <div className="flex items-center gap-4 flex-grow">
                                <label className="relative flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={task.is_completed}
                                        onChange={() => handleToggle(task.id, task.is_completed)}
                                        className="w-5 h-5 rounded border-surface-border bg-transparent checked:bg-primary checked:border-primary focus:ring-offset-0 focus:ring-1 focus:ring-primary cursor-pointer transition-all appearance-none"
                                    />
                                    {task.is_completed && (
                                        <span className="material-symbols-outlined text-[16px] text-[#0A0A0A] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                                            check
                                        </span>
                                    )}
                                </label>

                                <div className="flex flex-col">
                                    <span className={`text-sm font-medium transition-colors ${task.is_completed ? 'line-through text-text-muted' : 'text-gray-200 group-hover:text-white'}`}>
                                        {task.title}
                                    </span>
                                    {task.description && (
                                        <span className="text-xs text-text-muted">{task.description}</span>
                                    )}
                                </div>

                                {!task.is_completed && task.priority && (
                                    <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-medium border ${getPriorityStyle(task.priority)}`}>
                                        {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-6">
                                <div className="flex -space-x-2">
                                    <div className="w-6 h-6 rounded-full border border-surface bg-[#0a0a0a] text-[10px] flex items-center justify-center text-text-muted" title={task.assigned_to || 'Unassigned'}>
                                        {task.assigned_to ? task.assigned_to.substring(0, 2).toUpperCase() : '?'}
                                    </div>
                                </div>
                                <div className="text-right min-w-[80px]">
                                    {task.due_date ? (
                                        <span className={`text-xs font-mono block ${new Date(task.due_date) < new Date() && !task.is_completed ? 'text-red-400' : 'text-text-muted'}`}>
                                            Due {new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-mono text-text-muted/50 block">No due date</span>
                                    )}
                                </div>
                                <button className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1 text-xs font-medium bg-surface-border hover:bg-gray-700 text-gray-300 rounded border border-surface-border">
                                    Assign
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
            {tasks.length > 5 && (
                <div className="p-2 bg-[#0a0a0a] border-t border-surface-border text-center">
                    <button className="text-xs text-text-muted hover:text-primary transition-colors flex items-center justify-center gap-1 w-full py-1">
                        <span className="material-symbols-outlined text-[16px]">expand_more</span>
                        Show all {tasks.length} tasks
                    </button>
                </div>
            )}
        </div>
    )
}
