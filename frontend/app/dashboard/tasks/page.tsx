"use client";

import React, { useState, useEffect } from "react";
import { useAuth, useSession } from "@clerk/nextjs";
import { createClient } from '@supabase/supabase-js';
import { supabaseClient } from "@/lib/supabase";
import {
    Search,
    Plus,
    BellRing,
    MoreHorizontal,
    Paperclip,
    ListChecks,
    Link as LinkIcon,
    Lock,
    CheckCircle2,
    X,
    ShieldCheck,
    FileText,
    Image as ImageIcon,
    UploadCloud,
    FilePlus,
    Gavel,
    Trash2
} from "lucide-react";

export default function TasksDashboardPage() {
    const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
    const [isSopModalOpen, setIsSopModalOpen] = useState(false);
    const [isDailyBriefOpen, setIsDailyBriefOpen] = useState(true);

    const { userId, orgId, getToken } = useAuth();
    const { session } = useSession();
    const tenantId = orgId || userId;

    const [tasks, setTasks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [matters, setMatters] = useState<any[]>([]);
    const [selectedMatterId, setSelectedMatterId] = useState<string>('');
    const [selectedTask, setSelectedTask] = useState<any>(null);
    const [inlineDraftMatterId, setInlineDraftMatterId] = useState<string | null>(null);
    const [inlineTitle, setInlineTitle] = useState("");
    const [taskDetails, setTaskDetails] = useState<{ checklists: any[]; attachments: any[]; logs: any[]; dependencies: any[] }>({ checklists: [], attachments: [], logs: [], dependencies: [] });
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
    const [newSubTask, setNewSubTask] = useState('');
    const [activeAiTask, setActiveAiTask] = useState<any>(null);
    const [aiInput, setAiInput] = useState("");
    const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);

    const handleSendAiMessage = async () => {
        if (!aiInput.trim() || !activeAiTask) return;

        const userMessage = aiInput.trim();

        // 1. Update UI: Add User Message & Thinking State
        setAiMessages(prev => [
            ...prev,
            { role: 'user', content: userMessage },
            { role: 'ai', content: "Connecting to Intelligence Engine..." }
        ]);
        setAiInput("");

        try {
            // Change this URL if your FastAPI is running on a different port/address
            const API_URL = 'http://localhost:8000/api/v1/ai/task-assistant';

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenant_id: tenantId,
                    matter_id: activeAiTask.matter_id,
                    task_id: activeAiTask.id,
                    message: userMessage
                })
            });

            if (!response.ok) throw new Error(`Server responded with ${response.status}`);

            const data = await response.json();

            // 2. Update UI: Replace 'Thinking' message with real AI reply
            setAiMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    role: 'ai',
                    content: data.reply || "Response received, but format is empty."
                };
                return updated;
            });

        } catch (error) {
            console.error("❌ BACKEND_CONNECTION_ERROR:", error);
            setAiMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    role: 'ai',
                    content: "⚠️ Connection Error: Please ensure the Python FastAPI server is running on port 8000."
                };
                return updated;
            });
        }
    };

    const fetchTasks = async () => {
        if (!tenantId) return;
        if (!session) return;
        try {
            setIsLoading(true);
            const supabaseAccessToken = await session.getToken({ template: 'supabase' });

            const dynamicSupabaseClient = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                {
                    global: { headers: { Authorization: `Bearer ${supabaseAccessToken}` } }
                }
            );

            console.log("🔑 JWT TOKEN OBTAINED!");

            const { data, error } = await dynamicSupabaseClient
                .from('tasks')
                .select('*, matters(title)')
                .eq('tenant_id', tenantId)
                .order('position');

            if (error) throw error;
            setTasks(data || []);

            // Fetch matters for Matter Progress and New Task selector
            const { data: mattersData, error: mattersError } = await dynamicSupabaseClient
                .from('matters')
                .select('id, title, status, claim_value, created_at')
                .eq('tenant_id', tenantId);

            console.log("🔍 FETCHING WITH TENANT ID:", tenantId);
            console.log("📦 MATTERS DATA RECEIVED:", mattersData);
            console.log("❌ SUPABASE ERROR (IF ANY):", mattersError);

            setMatters(mattersData || []);
        } catch (error) {
            console.error("Error fetching tasks:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to get an authenticated Supabase client
    const getAuthenticatedSupabase = async () => {
        if (!session) return null;
        const token = await session.getToken({ template: 'supabase' });
        return createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: `Bearer ${token}` } } }
        );
    };

    useEffect(() => {
        if (!tenantId) return; // Wait for Clerk to load
        fetchTasks();
    }, [tenantId]);

    // Fetch task details when a task is selected
    useEffect(() => {
        if (!selectedTask || !session) return;
        const fetchDetails = async () => {
            const supabase = await getAuthenticatedSupabase();
            if (!supabase) return;
            const [chk, att, log] = await Promise.all([
                supabase.from('task_checklists').select('*').eq('task_id', selectedTask.id).order('created_at'),
                supabase.from('task_attachments').select('*').eq('task_id', selectedTask.id).order('created_at'),
                supabase.from('activity_logs').select('*').eq('task_id', selectedTask.id).order('created_at', { ascending: false })
            ]);
            setTaskDetails({ checklists: chk.data || [], attachments: att.data || [], logs: log.data || [], dependencies: [] });
        };
        fetchDetails();
    }, [selectedTask]);

    const handleApplySOPTemplate = async (templateId: string, matterId: string) => {
        if (!tenantId) return;
        try {
            const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const response = await fetch(`${backendUrl}/api/v1/tasks/from-template?tenant_id=${tenantId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ template_id: templateId, matter_id: matterId })
            });

            if (!response.ok) throw new Error("Failed to apply template");

            setIsSopModalOpen(false);
            await fetchTasks();
        } catch (error) {
            console.error(error);
        }
    };

    const handleCreateBlankTask = (matterId: string) => {
        if (!matterId) {
            alert("Please select a Matter for the New Task.");
            return;
        }
        setInlineDraftMatterId(matterId);
        setInlineTitle("");
        setIsSopModalOpen(false);
    };

    const submitInlineTask = async () => {
        if (!inlineTitle.trim() || !inlineDraftMatterId || !session || !tenantId) return;
        try {
            const supabase = await getAuthenticatedSupabase();
            if (!supabase) return;
            const { error } = await supabase
                .from('tasks')
                .insert({
                    tenant_id: tenantId,
                    matter_id: inlineDraftMatterId,
                    title: inlineTitle.trim(),
                    status: 'backlog'
                });
            if (error) throw error;
            setInlineDraftMatterId(null);
            setInlineTitle("");
            await fetchTasks();
        } catch (err) {
            console.error("Error creating blank task:", err);
            alert("Failed to create blank task.");
        }
    };

    // Refresh side panel details
    const fetchTaskDetails = async () => {
        if (!selectedTask || !session) return;
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) return;
        const [chk, att, log] = await Promise.all([
            supabase.from('task_checklists').select('*').eq('task_id', selectedTask.id).order('created_at'),
            supabase.from('task_attachments').select('*').eq('task_id', selectedTask.id).order('created_at'),
            supabase.from('activity_logs').select('*').eq('task_id', selectedTask.id).order('created_at', { ascending: false })
        ]);
        setTaskDetails({ checklists: chk.data || [], attachments: att.data || [], logs: log.data || [], dependencies: [] });
    };

    // DnD: Update task status when dropped in a new column
    const handleUpdateTaskStatus = async (id: string, newStatus: string) => {
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) return;
        await supabase.from('tasks').update({ status: newStatus }).eq('id', id);
        await fetchTasks();
    };

    // Delete a task
    const handleDeleteTask = async () => {
        if (!selectedTask) return;
        if (!window.confirm('Delete this task permanently?')) return;
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) return;
        await supabase.from('tasks').delete().eq('id', selectedTask.id);
        setIsTaskDetailOpen(false);
        setSelectedTask(null);
        await fetchTasks();
    };

    // Update priority
    const handleUpdatePriority = async (newPriority: string) => {
        if (!selectedTask) return;
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) return;
        await supabase.from('tasks').update({ priority: newPriority }).eq('id', selectedTask.id);
        setSelectedTask({ ...selectedTask, priority: newPriority });
    };

    // Toggle checklist item
    const handleToggleChecklist = async (chkId: string, currentState: boolean) => {
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) return;
        await supabase.from('task_checklists').update({ is_done: !currentState }).eq('id', chkId);
        await fetchTaskDetails();
    };

    // File upload
    const handleFileUpload = async (e: any) => {
        const file = e.target.files[0];
        if (!file || !selectedTask) return;
        try {
            const supabase = await getAuthenticatedSupabase();
            if (!supabase) return;
            const { data: uploadData, error: uploadError } = await supabase.storage.from('task_files').upload(`${selectedTask.id}/${Date.now()}_${file.name}`, file);
            if (uploadError) throw uploadError;

            const { error: dbError } = await supabase.from('task_attachments').insert({
                tenant_id: tenantId,
                task_id: selectedTask.id,
                file_name: file.name,
                file_url: uploadData.path,
                source: 'uploaded'
            });
            if (dbError) throw dbError;

            await fetchTaskDetails();
        } catch (err) {
            console.error("Upload error:", err);
            alert("Failed to upload file.");
        }
    };

    // Helper to group tasks by status
    const getTasksByStatus = (status: string) => tasks.filter(t => t.status === status);

    return (
        <div className="flex-1 flex overflow-hidden bg-clause-black text-slate-300 font-sans h-full">
            {/* BEGIN: Main Dashboard Area */}
            <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                {/* BEGIN: Topbar */}
                <header
                    className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-b border-white/5 bg-black/20"
                    data-purpose="main-topbar"
                >
                    <h2 className="font-serif text-lg text-white">Task Management Dashboard</h2>
                    <div className="flex items-center gap-6">
                        <div className="relative w-64">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                            <input
                                className="bg-white/5 border-none text-xs rounded-full pl-10 pr-4 py-2 w-full focus:ring-1 focus:ring-clause-gold/50 placeholder:opacity-40"
                                placeholder="Search case law, tasks, matters..."
                                type="text"
                            />
                        </div>
                        <button
                            onClick={() => setIsSopModalOpen(true)}
                            className="bg-clause-gold text-black text-xs font-bold px-4 py-2 rounded flex items-center gap-2 hover:bg-clause-gold/90 transition-all cursor-pointer"
                        >
                            <Plus className="w-4 h-4 stroke-[3px]" /> NEW TASK
                        </button>
                    </div>
                </header>
                {/* END: Topbar */}

                {/* BEGIN: Content Scroll Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8">
                    {/* BEGIN: Daily Brief Banner */}
                    {isDailyBriefOpen && (
                        <section
                            className="glass-card glass-border-gold rounded-lg p-5 flex items-center gap-4 relative overflow-hidden group"
                            data-purpose="daily-brief"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-clause-gold/10 to-transparent pointer-events-none"></div>
                            <div className="w-10 h-10 shrink-0 rounded-full bg-clause-gold/20 flex items-center justify-center text-clause-gold">
                                <BellRing className="w-5 h-5 animate-bounce" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-serif text-white text-sm">DAILY BRIEF</h3>
                                <p className="text-xs text-clause-gold">
                                    2 tasks auto-escalated to{" "}
                                    <span className="font-bold underline">HIGH</span> priority by
                                    Intelligence Engine based on court deadlines.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsDailyBriefOpen(false)}
                                className="text-[10px] shrink-0 font-mono border border-clause-gold/40 px-3 py-1 rounded hover:bg-clause-gold/10 transition-colors cursor-pointer"
                            >
                                DISMISS BRIEF
                            </button>
                        </section>
                    )}
                    {/* END: Daily Brief Banner */}

                    {/* BEGIN: Matter Progress Section */}
                    <section data-purpose="matter-progress">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-serif text-xs uppercase tracking-widest text-white/60">
                                Matter Progress
                            </h4>
                            <span className="text-[10px] font-mono text-clause-gold cursor-pointer hover:underline">
                                VIEW ALL MATTERS →
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {matters.length === 0 ? (
                                <div className="col-span-1 md:col-span-3 text-center py-8 text-white/40 font-mono text-xs border border-dashed border-white/10 rounded-lg">
                                    No active matters found. Create one from the Matters tab.
                                </div>
                            ) : (
                                matters.slice(0, 3).map((matter, index) => {
                                    const borderColors = ['border-l-blue-400', 'border-l-emerald-400', 'border-l-amber-400'];
                                    const bgColors = ['bg-blue-500/10', 'bg-emerald-500/10', 'bg-amber-500/10'];
                                    const textColors = ['text-blue-400', 'text-emerald-400', 'text-amber-400'];
                                    const tagBorderColors = ['border-blue-500/20', 'border-emerald-500/20', 'border-amber-500/20'];
                                    const barColors = ['bg-blue-400', 'bg-emerald-400', 'bg-amber-400'];

                                    const borderColor = borderColors[index % 3];
                                    const bgColor = bgColors[index % 3];
                                    const textColor = textColors[index % 3];
                                    const tagBorderColor = tagBorderColors[index % 3];
                                    const barColor = barColors[index % 3];

                                    return (
                                        <div key={matter.id} className={`glass-card p-4 rounded-sm border-l-2 ${borderColor}`}>
                                            <div className="flex justify-between items-start mb-3">
                                                <span className="text-[10px] font-mono text-white/40">
                                                    {matter.id?.substring(0, 8).toUpperCase() || 'MATTER'}
                                                </span>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${bgColor} ${textColor} border ${tagBorderColor} capitalize`}>
                                                    {matter.status || 'Active'}
                                                </span>
                                            </div>
                                            <p className="text-sm font-semibold text-white mb-4 truncate" title={matter.title}>
                                                {matter.title}
                                            </p>
                                            <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                                                <div className={`${barColor} h-full`} style={{ width: matter.claim_value ? '65%' : '0%' }}></div>
                                            </div>
                                            <div className="mt-2 flex justify-between text-[10px]">
                                                <span className="opacity-50">Value: ${matter.claim_value?.toLocaleString() || '0'}</span>
                                                <span className="text-white">{matter.claim_value ? '65%' : '0%'}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>
                    {/* END: Matter Progress Section */}

                    {/* BEGIN: Kanban Board */}
                    <section className="flex-1 min-h-0" data-purpose="legal-workflow">
                        <div className="flex gap-4 overflow-x-auto custom-scrollbar pb-4 h-full">
                            {/* Column: Backlog */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] bg-white/[0.02] border border-white/5 rounded-xl p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'backlog'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-1">
                                    <h5 className="text-[10px] font-mono uppercase tracking-tighter text-white/40">
                                        Backlog ({getTasksByStatus('backlog').length})
                                    </h5>
                                    <MoreHorizontal className="w-3 h-3 opacity-40" />
                                </div>
                                <div className="space-y-3">
                                    {inlineDraftMatterId && (
                                        <div className="glass-card p-3 rounded text-xs space-y-2 border-clause-gold/50">
                                            <input
                                                autoFocus
                                                type="text"
                                                className="w-full bg-transparent border-none text-white focus:ring-0 p-0 text-xs placeholder:opacity-40"
                                                placeholder="Type task name and press Enter..."
                                                value={inlineTitle}
                                                onChange={(e) => setInlineTitle(e.target.value)}
                                                onKeyDown={async (e) => {
                                                    if (e.key === 'Enter' && inlineTitle.trim() !== '') {
                                                        await submitInlineTask();
                                                    } else if (e.key === 'Escape') {
                                                        setInlineDraftMatterId(null);
                                                        setInlineTitle("");
                                                    }
                                                }}
                                            />
                                        </div>
                                    )}
                                    {isLoading ? (
                                        <div className="text-[10px] text-white/40 font-mono text-center py-4">Loading...</div>
                                    ) : (
                                        getTasksByStatus('backlog').map(task => (
                                            <div
                                                key={task.id}
                                                draggable={true}
                                                onDragStart={() => setDraggedTaskId(task.id)}
                                                onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                                className={`relative flex gap-2 p-3 rounded-lg border border-white/10 bg-white/5 backdrop-blur-md cursor-grab active:cursor-grabbing hover:border-white/20 hover:bg-white/10 transition-all duration-200 ${draggedTaskId === task.id ? 'rotate-2 scale-105 shadow-2xl opacity-80 z-50 ring-1 ring-clause-gold' : ''}`}
                                            >
                                                {/* Drag Handle */}
                                                <div className="flex flex-col justify-center opacity-20 hover:opacity-100 cursor-grab text-white transition-opacity">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9h2v2H8V9zm0 4h2v2H8v-2zm6-4h2v2h-2V9zm0 4h2v2h-2v-2z"></path></svg>
                                                </div>

                                                {/* Card Content */}
                                                <div className="flex-1 overflow-hidden">
                                                    {/* Matter Name Badge */}
                                                    <p className="text-[9px] font-semibold text-clause-gold/80 uppercase tracking-wider mb-1 truncate">
                                                        {task.matters?.title || "Unknown Matter"}
                                                    </p>

                                                    {/* Task Title */}
                                                    <h4 className="text-sm text-white font-medium truncate mb-2">{task.title}</h4>

                                                    {/* Meta (ID, AI, Attachments) */}
                                                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                                                        <span className="text-[10px] text-white/40 font-mono">#{task.id?.substring(0, 5).toUpperCase()}</span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setActiveAiTask(task); }}
                                                            className="flex items-center gap-1.5 px-2 py-1 rounded bg-clause-gold/10 text-clause-gold border border-clause-gold/20 hover:bg-clause-gold/20 hover:scale-105 transition-all text-[9px] font-bold uppercase tracking-wider cursor-pointer"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                            Ask AI
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Column: Research */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] bg-white/[0.02] border border-white/5 rounded-xl p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'this_week'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-1">
                                    <h5 className="text-[10px] font-mono uppercase tracking-tighter text-white/40">
                                        This Week ({getTasksByStatus('this_week').length})
                                    </h5>
                                </div>
                                {getTasksByStatus('this_week').map(task => (
                                    <div
                                        key={task.id}
                                        draggable={true}
                                        onDragStart={() => setDraggedTaskId(task.id)}
                                        onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                        className={`relative flex gap-2 p-3 rounded-lg border border-red-500/30 bg-white/5 backdrop-blur-md cursor-grab active:cursor-grabbing hover:border-red-500/50 hover:bg-white/10 transition-all duration-200 ${draggedTaskId === task.id ? 'rotate-2 scale-105 shadow-2xl opacity-80 z-50 ring-1 ring-clause-gold' : ''}`}
                                    >
                                        <div className="flex flex-col justify-center opacity-20 hover:opacity-100 cursor-grab text-white transition-opacity">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9h2v2H8V9zm0 4h2v2H8v-2zm6-4h2v2h-2V9zm0 4h2v2h-2v-2z"></path></svg>
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <div className="flex justify-between items-start mb-1">
                                                <p className="text-[9px] font-semibold text-clause-gold/80 uppercase tracking-wider truncate mr-2">
                                                    {task.matters?.title || "Unknown Matter"}
                                                </p>
                                                <span className="shrink-0 px-1.5 py-0.5 bg-red-500/10 text-red-500 font-mono text-[8px] rounded border border-red-500/20">URGENT</span>
                                            </div>
                                            <h4 className="text-sm text-white font-medium truncate mb-2">{task.title}</h4>
                                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                                                <span className="text-[10px] text-white/40 font-mono">#{task.id?.substring(0, 5).toUpperCase()}</span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setActiveAiTask(task); }}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-clause-gold/10 text-clause-gold border border-clause-gold/20 hover:bg-clause-gold/20 hover:scale-105 transition-all text-[9px] font-bold uppercase tracking-wider cursor-pointer"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                    Ask AI
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Column: Draft */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] bg-white/[0.02] border border-white/5 rounded-xl p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'in_progress'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-1">
                                    <h5 className="text-[10px] font-mono uppercase tracking-tighter text-white/40">
                                        In Progress ({getTasksByStatus('in_progress').length})
                                    </h5>
                                </div>
                                {getTasksByStatus('in_progress').map(task => (
                                    <div
                                        key={task.id}
                                        draggable={true}
                                        onDragStart={() => setDraggedTaskId(task.id)}
                                        onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                        className={`relative flex gap-2 p-3 rounded-lg border border-orange-500/30 bg-white/5 backdrop-blur-md cursor-grab active:cursor-grabbing hover:border-orange-500/50 hover:bg-white/10 transition-all duration-200 ${draggedTaskId === task.id ? 'rotate-2 scale-105 shadow-2xl opacity-80 z-50 ring-1 ring-clause-gold' : ''}`}
                                    >
                                        <div className="flex flex-col justify-center opacity-20 hover:opacity-100 cursor-grab text-white transition-opacity">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9h2v2H8V9zm0 4h2v2H8v-2zm6-4h2v2h-2V9zm0 4h2v2h-2v-2z"></path></svg>
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <div className="flex justify-between items-start mb-1">
                                                <p className="text-[9px] font-semibold text-clause-gold/80 uppercase tracking-wider truncate mr-2">
                                                    {task.matters?.title || "Unknown Matter"}
                                                </p>
                                                <span className="shrink-0 px-1.5 py-0.5 bg-orange-500/10 text-orange-500 font-mono text-[8px] rounded border border-orange-500/20">DUE SOON</span>
                                            </div>
                                            <h4 className="text-sm text-white font-medium truncate mb-2">{task.title}</h4>
                                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                                                <span className="text-[10px] text-white/40 font-mono">#{task.id?.substring(0, 5).toUpperCase()}</span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setActiveAiTask(task); }}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-clause-gold/10 text-clause-gold border border-clause-gold/20 hover:bg-clause-gold/20 hover:scale-105 transition-all text-[9px] font-bold uppercase tracking-wider cursor-pointer"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                    Ask AI
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Column: Review */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] bg-white/[0.02] border border-white/5 rounded-xl p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'waiting'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-1">
                                    <h5 className="text-[10px] font-mono uppercase tracking-tighter text-white/40">
                                        Waiting ({getTasksByStatus('waiting').length})
                                    </h5>
                                </div>
                                {getTasksByStatus('waiting').map(task => (
                                    <div
                                        key={task.id}
                                        draggable={true}
                                        onDragStart={() => setDraggedTaskId(task.id)}
                                        onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                        className={`relative flex gap-2 p-3 rounded-lg border border-white/10 border-dashed bg-white/5 backdrop-blur-md cursor-grab active:cursor-grabbing hover:border-white/20 hover:bg-white/10 transition-all duration-200 opacity-70 ${draggedTaskId === task.id ? 'rotate-2 scale-105 shadow-2xl opacity-80 z-50 ring-1 ring-clause-gold' : ''}`}
                                    >
                                        <div className="flex flex-col justify-center opacity-20 hover:opacity-100 cursor-grab text-white transition-opacity">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9h2v2H8V9zm0 4h2v2H8v-2zm6-4h2v2h-2V9zm0 4h2v2h-2v-2z"></path></svg>
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <div className="flex justify-between items-start mb-1">
                                                <p className="text-[9px] font-semibold text-clause-gold/80 uppercase tracking-wider truncate mr-2">
                                                    {task.matters?.title || "Unknown Matter"}
                                                </p>
                                                <span className="shrink-0 px-1.5 py-0.5 bg-white/10 text-white font-mono text-[8px] rounded uppercase tracking-wider">Blocked</span>
                                            </div>
                                            <h4 className="text-sm text-white/60 font-medium truncate mb-2">{task.title}</h4>
                                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                                                <span className="text-[10px] text-white/40 font-mono">#{task.id?.substring(0, 5).toUpperCase()}</span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setActiveAiTask(task); }}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-clause-gold/10 text-clause-gold border border-clause-gold/20 hover:bg-clause-gold/20 hover:scale-105 transition-all text-[9px] font-bold uppercase tracking-wider cursor-pointer"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                    Ask AI
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Column: Filed */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] bg-white/[0.02] border border-white/5 rounded-xl p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'done'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-1">
                                    <h5 className="text-[10px] font-mono uppercase tracking-tighter text-white/40">
                                        Done ({getTasksByStatus('done').length})
                                    </h5>
                                </div>
                                {getTasksByStatus('done').map(task => (
                                    <div
                                        key={task.id}
                                        draggable={true}
                                        onDragStart={() => setDraggedTaskId(task.id)}
                                        onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                        className={`relative flex gap-2 p-3 rounded-lg border border-emerald-500/20 bg-white/5 backdrop-blur-md cursor-grab active:cursor-grabbing hover:border-emerald-500/30 hover:bg-white/10 transition-all duration-200 opacity-50 ${draggedTaskId === task.id ? 'rotate-2 scale-105 shadow-2xl opacity-80 z-50 ring-1 ring-clause-gold' : ''}`}
                                    >
                                        <div className="flex flex-col justify-center opacity-20 hover:opacity-100 cursor-grab text-white transition-opacity">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9h2v2H8V9zm0 4h2v2H8v-2zm6-4h2v2h-2V9zm0 4h2v2h-2v-2z"></path></svg>
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <p className="text-[9px] font-semibold text-clause-gold/80 uppercase tracking-wider mb-1 truncate">
                                                {task.matters?.title || "Unknown Matter"}
                                            </p>
                                            <h4 className="text-sm text-white font-medium line-through truncate mb-2">{task.title}</h4>
                                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                                                <span className="text-[10px] text-white/40 font-mono">#{task.id?.substring(0, 5).toUpperCase()}</span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setActiveAiTask(task); }}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-clause-gold/10 text-clause-gold border border-clause-gold/20 hover:bg-clause-gold/20 hover:scale-105 transition-all text-[9px] font-bold uppercase tracking-wider cursor-pointer"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                    Ask AI
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                    {/* END: Kanban Board */}
                </div>
                {/* END: Content Scroll Area */}
            </main>
            {/* END: Main Dashboard Area */}

            {/* BEGIN: Task Detail Side Panel */}
            {isTaskDetailOpen && (
                <aside
                    className="w-[400px] flex-shrink-0 border-l border-white/5 bg-clause-black overflow-y-auto custom-scrollbar flex flex-col h-full"
                    data-purpose="task-detail-panel"
                >
                    <div className="p-6 border-b border-white/5 space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-mono text-clause-gold tracking-widest px-2 py-0.5 border border-clause-gold/30 rounded">
                                {selectedTask?.id?.substring(0, 8).toUpperCase() || 'T-0000'}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    className="opacity-40 hover:text-red-500 hover:opacity-100 cursor-pointer transition-colors"
                                    onClick={handleDeleteTask}
                                    title="Delete task"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                                <button
                                    className="opacity-40 hover:opacity-100 cursor-pointer"
                                    onClick={() => setIsTaskDetailOpen(false)}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <h3 className="font-serif text-xl text-white leading-snug">
                            {selectedTask?.title || 'Task Details'}
                        </h3>
                        <div className="flex gap-2 items-center">
                            <select
                                className="text-[9px] font-mono px-2 py-1 bg-red-500/10 text-red-500 rounded border border-red-500/20 appearance-none cursor-pointer focus:ring-0 outline-none"
                                value={selectedTask?.priority || 'medium'}
                                onChange={(e) => handleUpdatePriority(e.target.value)}
                            >
                                <option value="low" className="bg-clause-black">Low Priority</option>
                                <option value="medium" className="bg-clause-black">Medium Priority</option>
                                <option value="high" className="bg-clause-black">High Priority</option>
                                <option value="urgent" className="bg-clause-black">Urgent</option>
                            </select>
                            <span className="text-[9px] font-mono px-2 py-1 bg-clause-gold/10 text-clause-gold rounded border border-clause-gold/20 flex items-center gap-1">
                                <ShieldCheck className="w-2.5 h-2.5" /> AI Verified
                            </span>
                        </div>
                    </div>

                    <div className="p-6 space-y-8">
                        {/* Escalation Timeline */}
                        <div data-purpose="escalation-timeline">
                            <p className="text-[10px] font-mono uppercase text-white/30 mb-4 tracking-widest">
                                Escalation Timeline
                            </p>
                            <div className="relative flex justify-between items-center">
                                <div className="absolute h-[1px] bg-white/10 top-1/2 left-0 right-0 -z-10"></div>
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-clause-gold"></div>
                                    <span className="text-[9px] font-mono opacity-50">Created</span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-clause-gold"></div>
                                    <span className="text-[9px] font-mono opacity-50">Started</span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-clause-black ring-4 ring-red-500/10"></div>
                                    <span className="text-[9px] font-mono text-red-400 font-bold">
                                        Escalated
                                    </span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-white/10"></div>
                                    <span className="text-[9px] font-mono opacity-30">Due</span>
                                </div>
                            </div>
                        </div>

                        {/* Checklist */}
                        <div data-purpose="checklist">
                            <div className="flex justify-between items-end mb-4">
                                <p className="text-[10px] font-mono uppercase text-white/30 tracking-widest">
                                    Procedural Steps
                                </p>
                                <span className="text-[10px] font-mono text-clause-gold">
                                    {taskDetails.checklists.length > 0
                                        ? `${Math.round((taskDetails.checklists.filter((c: any) => c.is_done).length / taskDetails.checklists.length) * 100)}% Complete`
                                        : '0%'}
                                </span>
                            </div>
                            <div className="w-full h-1 bg-white/5 rounded-full mb-4 overflow-hidden">
                                <div className="h-full bg-clause-gold" style={{ width: taskDetails.checklists.length > 0 ? `${Math.round((taskDetails.checklists.filter((c: any) => c.is_done).length / taskDetails.checklists.length) * 100)}%` : '0%' }}></div>
                            </div>
                            <div className="space-y-3">
                                {taskDetails.checklists.length === 0 ? (
                                    <p className="text-xs opacity-40">No procedural steps defined.</p>
                                ) : (
                                    taskDetails.checklists.map((chk: any) => (
                                        <div key={chk.id} className="flex items-center justify-between group">
                                            <label className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                    checked={chk.is_done || false}
                                                    onChange={async () => {
                                                        const supabase = await getAuthenticatedSupabase();
                                                        if (!supabase) return;
                                                        await supabase.from('task_checklists').update({ is_done: !chk.is_done }).eq('id', chk.id);
                                                        await fetchTaskDetails();
                                                    }}
                                                    className="gold-checkbox rounded-sm bg-transparent border-white/20 text-clause-gold focus:ring-0 focus:ring-offset-0"
                                                    type="checkbox"
                                                />
                                                <span className={`text-xs ${chk.is_done ? 'line-through opacity-40' : 'text-white/80'}`}>
                                                    {chk.item}
                                                </span>
                                            </label>
                                            <button
                                                onClick={async () => {
                                                    const supabase = await getAuthenticatedSupabase();
                                                    if (!supabase) return;
                                                    await supabase.from('task_checklists').delete().eq('id', chk.id);
                                                    await fetchTaskDetails();
                                                }}
                                                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-500 text-xs transition-opacity cursor-pointer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))
                                )}
                                <input
                                    type="text"
                                    placeholder="+ Add sub-task and press Enter"
                                    value={newSubTask}
                                    onChange={(e) => setNewSubTask(e.target.value)}
                                    onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && newSubTask.trim() !== '') {
                                            const supabase = await getAuthenticatedSupabase();
                                            if (!supabase) return;
                                            const { error } = await supabase
                                                .from('task_checklists')
                                                .insert({
                                                    task_id: selectedTask.id,
                                                    item: newSubTask.trim()
                                                });

                                            if (error) {
                                                console.error("❌ ERROR INSERTING SUB-TASK:", error);
                                                alert("Failed to add sub-task. Check console.");
                                            } else {
                                                setNewSubTask(''); // Clear input
                                                await fetchTaskDetails(); // Refresh the side panel UI immediately!
                                            }
                                        }
                                    }}
                                    className="w-full bg-transparent border-b border-white/10 text-xs text-white focus:ring-0 px-0 py-1 outline-none placeholder:opacity-30 mt-2"
                                />
                            </div>
                        </div>

                        {/* Attachments */}
                        <div data-purpose="attachments">
                            <p className="text-[10px] font-mono uppercase text-white/30 mb-3 tracking-widest">
                                Evidence & Briefs
                            </p>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                {taskDetails.attachments.length === 0 ? (
                                    <p className="text-xs opacity-40 col-span-2">No attachments yet.</p>
                                ) : (
                                    taskDetails.attachments.map((file: any) => (
                                        <div key={file.id} className="flex items-center gap-3 p-3 border border-white/10 rounded-md bg-white/5 relative group">
                                            <div className="text-clause-gold shrink-0">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="text-[10px] text-white truncate w-full">{file.file_name}</p>
                                                <p className="text-[8px] font-mono text-clause-gold/60 mt-0.5">{file.source?.toUpperCase() || 'UPLOADED'}</p>
                                            </div>
                                            {/* Delete Button for files */}
                                            <button
                                                onClick={async () => {
                                                    const supabase = await getAuthenticatedSupabase();
                                                    if (!supabase) return;
                                                    await supabase.from('task_attachments').delete().eq('id', file.id);
                                                    await fetchTaskDetails();
                                                }}
                                                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs cursor-pointer z-10"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                            <label className="mt-3 border border-dashed border-white/10 rounded-lg p-4 flex flex-col items-center justify-center gap-2 hover:border-clause-gold/30 transition-all cursor-pointer">
                                <UploadCloud className="w-5 h-5 opacity-20" />
                                <span className="text-[10px] opacity-40 font-mono">
                                    CLICK OR DRAG TO UPLOAD
                                </span>
                                <input type="file" className="hidden" onChange={handleFileUpload} />
                            </label>
                        </div>

                        {/* Dependencies */}
                        <div data-purpose="dependencies">
                            <p className="text-[10px] font-mono uppercase text-white/30 mb-3 tracking-widest">
                                Dependencies
                            </p>
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-[10px]">
                                    <span className="text-red-400 font-bold uppercase tracking-tighter">
                                        Blocked by
                                    </span>
                                    <span className="text-white/60 hover:text-clause-gold cursor-pointer">
                                        T-1088 (Evidence Audit)
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px]">
                                    <span className="text-emerald-400 font-bold uppercase tracking-tighter">
                                        Blocking
                                    </span>
                                    <span className="text-white/60 hover:text-clause-gold cursor-pointer">
                                        T-1104 (Final Partner Approval)
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Activity Log */}
                        <div data-purpose="activity-log">
                            <p className="text-[10px] font-mono uppercase text-white/30 mb-4 tracking-widest">
                                Activity Log
                            </p>
                            <div className="space-y-4 relative">
                                <div className="absolute w-[1px] bg-white/5 left-[7px] top-1 bottom-1"></div>
                                {taskDetails.logs.length === 0 ? (
                                    <p className="text-xs opacity-40 pl-8">No activity recorded yet.</p>
                                ) : (
                                    taskDetails.logs.map((log: any, idx: number) => (
                                        <div key={log.id} className="flex gap-4 relative">
                                            <div className={`w-4 h-4 rounded-full ${idx === 0 ? 'bg-clause-gold/20' : 'bg-white/10'} flex items-center justify-center shrink-0 z-10`}>
                                                <div className={`w-1.5 h-1.5 ${idx === 0 ? 'bg-clause-gold' : 'bg-white/40'} rounded-full`}></div>
                                            </div>
                                            <div>
                                                <p className="text-xs text-white/80">
                                                    {log.message || log.action || 'Activity recorded'}
                                                </p>
                                                <p className="text-[9px] font-mono opacity-30 mt-1">
                                                    {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </aside>
            )}
            {/* END: Task Detail Side Panel */}

            {/* BEGIN: SOP Modal Overlay */}
            {isSopModalOpen && (
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-6"
                    data-purpose="sop-modal"
                >
                    <div className="glass-card w-full max-w-2xl rounded-lg overflow-hidden flex flex-col etched-border">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                            <div>
                                <h3 className="font-serif text-xl text-white">
                                    Select Task Standard Operating Procedure
                                </h3>
                                <p className="text-xs text-white/40 mt-1">
                                    Select a template to initialize tasks with pre-defined procedural
                                    steps.
                                </p>
                            </div>
                            <button
                                className="p-2 hover:bg-white/5 rounded-full cursor-pointer"
                                onClick={() => setIsSopModalOpen(false)}
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-6 pt-6 -mb-2">
                            <label className="text-xs font-mono uppercase text-white/40 mb-2 block">Link to Matter</label>
                            <select
                                className="bg-white/5 border border-white/10 text-white rounded p-2 w-full mb-4 focus:ring-1 focus:ring-clause-gold/50 outline-none"
                                value={selectedMatterId}
                                onChange={(e) => setSelectedMatterId(e.target.value)}
                            >
                                <option value="" className="bg-clause-black text-white/50">-- Select a Matter for the New Task --</option>
                                {matters.map((matter) => (
                                    <option key={matter.id} value={matter.id} className="bg-clause-black">
                                        {matter.title}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 h-96 overflow-y-auto custom-scrollbar">
                            {/* Template Option */}
                            <div className="glass-card p-5 rounded-md border-white/5 hover:border-clause-gold/50 cursor-pointer transition-all flex flex-col">
                                <div className="flex justify-between mb-4">
                                    <FilePlus className="w-6 h-6 text-clause-gold opacity-50" />
                                    <span className="text-[9px] font-mono px-2 py-1 bg-white/5 rounded">
                                        GENERIC
                                    </span>
                                </div>
                                <h4 className="font-serif text-lg text-white mb-2">Blank Task</h4>
                                <p className="text-[11px] opacity-40 leading-relaxed">
                                    A clean slate without pre-defined checklists or mandatory AI
                                    verification gates.
                                </p>
                                <button
                                    className="mt-auto pt-4 text-xs font-mono text-clause-gold text-left cursor-pointer hover:underline"
                                    onClick={() => handleCreateBlankTask(selectedMatterId)}
                                >
                                    SELECT TEMPLATE →
                                </button>
                            </div>
                            {/* Template Option */}
                            <div className="glass-card p-5 rounded-md border-clause-gold/20 hover:border-clause-gold transition-all flex flex-col ring-1 ring-clause-gold/10 cursor-pointer">
                                <div className="flex justify-between mb-4">
                                    <Gavel className="w-6 h-6 text-clause-gold" />
                                    <span className="text-[9px] font-mono px-2 py-1 bg-clause-gold/20 text-clause-gold rounded border border-clause-gold/20">
                                        PREMIUM SOP
                                    </span>
                                </div>
                                <h4 className="font-serif text-lg text-white mb-2">
                                    Litigation Checklist
                                </h4>
                                <p className="text-[11px] opacity-40 leading-relaxed mb-4">
                                    Complete 12-step legal workflow including evidentiary review, AI
                                    discovery, and partner filing sign-off.
                                </p>
                                <div className="flex gap-2 mb-6">
                                    <span className="text-[9px] font-mono opacity-60">
                                        12 SUB-TASKS
                                    </span>
                                    <span className="text-[9px] font-mono opacity-60">•</span>
                                    <span className="text-[9px] font-mono opacity-60 text-clause-gold">
                                        AI ASSISTED
                                    </span>
                                </div>
                                <button
                                    className="mt-auto pt-4 text-xs font-mono text-clause-gold text-left cursor-pointer hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => {
                                        if (!selectedMatterId) {
                                            alert("Please select a matter first.");
                                            return;
                                        }
                                        handleApplySOPTemplate('181bf05c-e5dd-4dc3-8745-f0e75dd579de', selectedMatterId);
                                    }}
                                >
                                    SELECT TEMPLATE →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* END: SOP Modal Overlay */}

            {/* BEGIN: Task-Specific AI Chat Modal */}
            {activeAiTask && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#0a0a0a] border border-clause-gold/30 rounded-xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">

                        {/* Header */}
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <div>
                                <h3 className="text-clause-gold font-serif text-lg flex items-center gap-2">Clause Assistant</h3>
                                <p className="text-[10px] text-white/50 mt-1 uppercase tracking-wider">Context: {activeAiTask.title}</p>
                            </div>
                            <button onClick={() => setActiveAiTask(null)} className="text-white/50 hover:text-white p-2 cursor-pointer">✕</button>
                        </div>

                        {/* Chat Body */}
                        <div className="p-6 text-sm text-white/80 space-y-4 h-[350px] overflow-y-auto flex flex-col">
                            {/* Initial Greeting */}
                            {aiMessages.length === 0 && (
                                <div className="bg-white/5 p-3 rounded-lg border border-white/10 self-start max-w-[85%]">
                                    <p className="mb-2">I am analyzing the documents for <span className="text-clause-gold font-medium">"{activeAiTask?.matters?.title || 'this matter'}"</span> to assist you with the task: <span className="font-semibold text-white">"{activeAiTask?.title}"</span>.</p>
                                    <p className="text-xs text-white/50">I can draft emails, extract obligations from the contract, or suggest next procedural steps. What do you need?</p>
                                </div>
                            )}

                            {/* Mapped Messages */}
                            {aiMessages.map((msg, idx) => (
                                <div key={idx} className={`p-3 rounded-lg max-w-[85%] ${msg.role === 'user' ? 'bg-clause-gold/20 border border-clause-gold/30 self-end text-white' : 'bg-white/5 border border-white/10 self-start text-white/80'}`}>
                                    <p>{msg.content}</p>
                                </div>
                            ))}
                        </div>

                        {/* Input Area */}
                        <div className="p-4 bg-white/[0.02] border-t border-white/10">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Ask Clause AI to draft, analyze, or summarize..."
                                    className="w-full bg-[#111] border border-white/10 rounded-lg pl-4 pr-12 py-3 text-white focus:ring-1 focus:ring-clause-gold focus:border-clause-gold text-xs"
                                    value={aiInput}
                                    onChange={(e) => setAiInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSendAiMessage(); }}
                                />
                                <button onClick={handleSendAiMessage} className="absolute right-2 top-1/2 -translate-y-1/2 text-clause-gold hover:bg-white/10 p-1.5 rounded-md transition-colors cursor-pointer">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )}
            {/* END: Task-Specific AI Chat Modal */}
        </div>
    );
}
