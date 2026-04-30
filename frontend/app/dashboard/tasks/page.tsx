"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import {
    getTasksAPI, getTaskDetailsAPI, updateTaskAPI, deleteTaskAPI,
    createSubTaskAPI, updateSubTaskAPI, deleteSubTaskAPI, deleteAttachmentAPI,
    createTaskAPI, getMattersAPI, createAttachmentAPI, getTemplatesAPI, deleteTemplateAPI
} from './tasksApi';
import { supabaseClient } from "@/lib/supabase";
import ReactMarkdown from 'react-markdown';
import { toast, Toaster } from 'sonner';
import {
    BlockedMarkdownImage,
    DISALLOWED_MARKDOWN_ELEMENTS,
    safeExternalHref,
} from '@/lib/markdownSafety';
import { assertSafeLlmText } from '@/lib/sanitize';
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
    Trash2,
    FileWarning,
    Folder,
    User,
    Loader2
} from "lucide-react";
import Link from "next/link";
import { LuxuryThinkingStepper } from '@/components/ui/LuxuryThinkingStepper';
import SmartComposer from "@/components/drafting/SmartComposer";
import { getPublicApiBase } from "@/lib/public-api-base";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export default function TasksDashboardPage() {
    const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
    const [isSopModalOpen, setIsSopModalOpen] = useState(false);
    const [isDailyBriefOpen, setIsDailyBriefOpen] = useState(true);

    const { userId, orgId, getToken } = useAuth();
    const tenantId = orgId || userId;

    const [tasks, setTasks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [matters, setMatters] = useState<any[]>([]);
    const [selectedMatterId, setSelectedMatterId] = useState<string>('');
    const [selectedTask, setSelectedTask] = useState<any>(null);
    const [isFetchingDetails, setIsFetchingDetails] = useState(false);
    const [inlineDraftMatterId, setInlineDraftMatterId] = useState<string | null>(null);
    const [inlineTitle, setInlineTitle] = useState("");
    const [taskDetails, setTaskDetails] = useState<{ checklists: any[]; attachments: any[]; logs: any[]; dependencies: any[] }>({ checklists: [], attachments: [], logs: [], dependencies: [] });
    const [proceduralSteps, setProceduralSteps] = useState<any[]>([]);
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
    const [newSubTask, setNewSubTask] = useState('');
    const [activeAiTask, setActiveAiTask] = useState<any>(null);
    const [aiInput, setAiInput] = useState("");
    const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
    const [isAiTyping, setIsAiTyping] = useState(false);
    const [customTemplates, setCustomTemplates] = useState<any[]>([]);
    const [draftingTask, setDraftingTask] = useState<{matterId: string, title: string, counterparty?: string} | null>(null);

    const getApiToken = async () => {
        const token = await getToken();
        if (!token) {
            throw new Error("Missing authentication token.");
        }
        return token;
    };

    const getStorageClient = async () => {
        const token = await getApiToken();
        return supabaseClient(token);
    };

    const fetchCustomTemplates = async () => {
        try {
            const token = await getApiToken();
            const templates = await getTemplatesAPI(token);
            setCustomTemplates(templates);
        } catch (error) {
            console.error("Error fetching custom templates:", error);
        }
    };

    useEffect(() => {
        if (isSopModalOpen) {
            fetchCustomTemplates();
        }
    }, [isSopModalOpen]);

    const handleDeleteTemplate = async (templateId: string) => {
        try {
            const token = await getApiToken();
            await deleteTemplateAPI(token, templateId);

            toast.success("Template Deleted", {
                style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' }
            });

            // Refresh the list
            fetchCustomTemplates();
        } catch (error) {
            console.error("Error deleting template:", error);
            toast.error("Failed to delete template.");
        }
    };

    const handleSendAiMessage = async () => {
        if (!aiInput.trim() || !activeAiTask) return;

        const userMessage = aiInput.trim();

        // 1. Update UI: Add User Message & Thinking State
        setAiMessages(prev => [
            ...prev,
            { role: 'user', content: userMessage }
        ]);
        setAiInput("");
        setIsAiTyping(true);

        try {
            // Change this URL if your FastAPI is running on a different port/address
            const apiUrl = `${getPublicApiBase()}/api/v1/ai/task-assistant`;
            const token = await getToken();

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    tenant_id: tenantId,
                    matter_id: activeAiTask.matter_id,
                    task_id: activeAiTask.id,
                    message: userMessage
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || `Server responded with ${response.status}`);
            }

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
        } finally {
            setIsAiTyping(false);
        }
    };

    const handleCreateAiSubtask = async (title: string, taskId: string | undefined) => {
        console.log("⚡ [DEBUG] Memulai handleCreateAiSubtask...");

        if (!taskId) {
            console.error("❌ [DEBUG] ERROR: taskId kosong/undefined! Cari tahu nama state task yang benar.");
            toast.error('System Error', { description: 'Task ID tidak ditemukan.', style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' } });
            return;
        }

        // Clean up the string (remove the "+ Add Task:" prefix and markdown bolding if present)
        const cleanTitle = title.replace(/\+ Add Task:/g, '').replace(/\*\*/g, '').trim();
        console.log("⚡ [DEBUG] Data siap dikirim ke API:", { task_id: taskId, title: cleanTitle });

        try {
            const token = await getApiToken();
            const data = await createSubTaskAPI(token, taskId, cleanTitle);

            console.log("✅ [DEBUG] Berhasil insert via API:", data);
            toast.success('Sub-task Created', {
                description: `⚡ ${cleanTitle} has been added to Procedural Steps.`,
                style: { background: '#1a1a1a', border: '1px solid #B8B8B8', color: '#fff' },
                icon: <span className="text-[#B8B8B8]">✦</span>
            });

            // Refresh side panel if it's open for this task
            if (selectedTask?.id === taskId) {
                console.log("⚡ [DEBUG] Refreshing Task Details UI...");
                await fetchTaskDetails();
            } else {
                // otherwise just fetch tasks again to update progress markers
                console.log("⚡ [DEBUG] Refreshing Tasks Board UI...");
                await fetchTasks();
            }

        } catch (error) {
            console.error("❌ [DEBUG] Catch Block Error:", error);
            toast.error('Operation Failed', {
                description: 'Could not connect to database or add sub-task.',
                style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' }
            });
        }
    };

    const fetchTasks = async () => {
        if (!tenantId) return;
        try {
            setIsLoading(true);
            const token = await getApiToken();

            console.log("🔑 JWT TOKEN OBTAINED!");

            const tasks = await getTasksAPI(token);
            setTasks(tasks);

            // Fetch matters for Matter Progress and New Task selector
            const mattersData = await getMattersAPI(token);

            console.log("🔍 FETCHING WITH TENANT ID:", tenantId);
            console.log("📦 MATTERS DATA RECEIVED:", mattersData);

            setMatters(mattersData || []);
        } catch (error: any) {
            console.error("Error fetching tasks:", error);
            setTasks([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!tenantId) return; // Wait for Clerk to load
        void fetchTasks();
    }, [tenantId]);

    const fetchTaskDetails = async () => {
        if (!selectedTask?.id) return;
        const token = await getApiToken();

        const data = await getTaskDetailsAPI(token, selectedTask.id);

        if (data.task) {
            setSelectedTask((prev: any) => ({ ...prev, ...data.task }));
        }

        setTaskDetails({ 
            checklists: data.sub_tasks || [], 
            attachments: data.attachments || [], 
            logs: data.activity_logs || [],
            dependencies: [] 
        });
        setProceduralSteps(data.sub_tasks || []);
    };

    // Fetch task details when a task is selected
    useEffect(() => {
        if (selectedTask?.id) {
            // 2. CLEAR ONLY THE CHECKLIST, BUT KEEP MIN-HEIGHT IN UI 🚨
            setProceduralSteps([]);

            // 3. FETCH THE REST IN THE BACKGROUND (SILENTLY)
            fetchTaskDetails();
        }
    }, [selectedTask?.id]);

    const handleToggleStep = async (stepId: string, newState: boolean) => {
        try {
            const token = await getApiToken();
            await updateSubTaskAPI(token, stepId, { is_completed: newState });
            // Optimistic update
            setProceduralSteps(prev => prev.map(s => s.id === stepId ? { ...s, is_completed: newState } : s));
        } catch (e) {
            console.error("Failed to toggle statement", e);
        }
    };

    const handleDeleteSubTask = async (subTaskId: string) => {
        try {
            const token = await getApiToken();
            await deleteSubTaskAPI(token, subTaskId);

            // Optimistic UI Update: Remove from local state immediately
            setProceduralSteps(prev => prev.filter(s => s.id !== subTaskId));

        } catch (error) {
            console.error("Error deleting sub-task:", error);
            toast.error("Failed to delete sub-task");
        }
    };

    const handleApplySOPTemplate = async (templateId: string, matterId: string) => {
        if (!tenantId) return;
        try {
            const apiUrl = getPublicApiBase();
            const token = await getApiToken();
            const response = await fetch(`${apiUrl}/api/v1/tasks/from-template`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ template_id: templateId, matter_id: matterId })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || "Failed to apply template");
            }

            setIsSopModalOpen(false);
            await fetchTasks();
        } catch (error) {
            console.error(error);
        }
    };

    const handleCreateBlankTask = (matterId: string) => {
        if (!matterId) {
            toast.error("Please select a Matter for the New Task.");
            return;
        }
        setInlineDraftMatterId(matterId);
        setInlineTitle("");
        setIsSopModalOpen(false);
    };

    const submitInlineTask = async () => {
        if (!inlineTitle.trim() || !inlineDraftMatterId || !tenantId) return;
        try {
            const token = await getApiToken();
            await createTaskAPI(token, {
                matter_id: inlineDraftMatterId,
                title: inlineTitle.trim(),
                status: 'backlog'
            });
            setInlineDraftMatterId(null);
            setInlineTitle("");
            await fetchTasks();
        } catch (err) {
            console.error("Error creating blank task:", err);
            toast.error("Failed to create blank task.");
        }
    };



    // DnD: Update task status when dropped in a new column
    const handleUpdateTaskStatus = async (id: string, newStatus: string) => {
        const token = await getApiToken();
        await updateTaskAPI(token, id, { status: newStatus });
        await fetchTasks();
    };

    // Delete a task
    const handleDeleteTask = async () => {
        if (!selectedTask) return;
        const token = await getApiToken();
        await deleteTaskAPI(token, selectedTask.id);
        setIsTaskDetailOpen(false);
        setSelectedTask(null);
        await fetchTasks();
    };

    // Update priority
    const handleUpdatePriority = async (newPriority: string) => {
        if (!selectedTask) return;
        const token = await getApiToken();
        await updateTaskAPI(token, selectedTask.id, { priority: newPriority });
        setSelectedTask({ ...selectedTask, priority: newPriority });
    };

    // Toggle checklist item
    const handleToggleChecklist = async (chkId: string, currentState: boolean) => {
        const token = await getApiToken();
        await updateSubTaskAPI(token, chkId, { is_completed: !currentState });
        // The useEffect for selectedTask will handle the refresh
    };

    // File upload
    const handleFileUpload = async (e: any) => {
        const file = e.target.files[0];
        if (!file || !selectedTask) return;
        try {
            const token = await getApiToken();
            const supabase = await getStorageClient();
            const { data: uploadData, error: uploadError } = await supabase.storage.from('task_files').upload(`${selectedTask.id}/${Date.now()}_${file.name}`, file);
            if (uploadError) throw uploadError;

            await createAttachmentAPI(token, selectedTask.id, {
                file_name: file.name,
                file_path: uploadData.path,
                source: 'uploaded'
            });

            await fetchTaskDetails();
        } catch (err) {
            console.error("Upload error:", err);
            toast.error("Failed to upload file.");
        }
    };

    // Helper to group tasks by status
    const getTasksByStatus = (status: string) => tasks.filter(t => t.status === status);

    // Dynamic metrics for widgets
    const tasksThisWeekCount = getTasksByStatus('this_week').length;
    const tasksUrgentCount = tasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length;

    const getMatterProgress = (matterId: string) => {
        const matterTasks = tasks.filter(t => t.matter_id === matterId);
        if (matterTasks.length === 0) return 0;
        const completedTasks = matterTasks.filter(t => t.status === 'done');
        return Math.round((completedTasks.length / matterTasks.length) * 100);
    };

    // --- AI Chat State & Logic ---
    const [isAiMode, setIsAiMode] = useState(false);
    const [chatInput, setChatInput] = useState("");
    const [messages, setMessages] = useState([{ role: "ai", content: "Hello! I am your Clause Assistant. I have context on this task and matter. How can I help?" }]);

    const handleSendMessage = async () => {
        if (!chatInput.trim()) return;

        const userMessage = chatInput;
        setMessages(prev => [...prev, { role: "user", content: userMessage }]);
        setChatInput("");
        setIsAiTyping(true);

        try {
            const apiUrl = getPublicApiBase();
            const token = await getToken();
            const res = await fetch(`${apiUrl}/api/v1/ai/task-assistant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ message: userMessage, task_id: selectedTask?.id || "current_task_id", matter_id: selectedTask?.matter_id || "current_matter_id" })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to fetch AI response");
            }

            const data = await res.json();
            const reply = data.reply || data.response || "I couldn't process that request at this moment.";
            setMessages(prev => [...prev, { role: "ai", content: reply }]);
        } catch (error) {
            console.error("AI Assistant Error:", error);
            setMessages(prev => [...prev, { role: "ai", content: "Sorry, I encountered an error connecting to the server." }]);
        } finally {
            setIsAiTyping(false);
        }
    };
    // -----------------------------

    return (
        <div className="flex-1 flex overflow-hidden bg-[#0a0a0a] text-slate-300 font-sans h-full">
            {/* BEGIN: Main Dashboard Area */}
            <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                {/* BEGIN: Topbar */}
                <header
                    className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-b border-[#2A2A2A] bg-[#0a0a0a]"
                    data-purpose="main-topbar"
                >
                    <h2 className="font-serif text-lg text-white">Task Management</h2>
                    <div className="flex items-center gap-6">
                        <div className="relative w-64">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                            <input
                                className="bg-[#111111] border border-[#2A2A2A] text-xs justify-center rounded-sm pl-10 pr-4 py-2 w-full focus:ring-1 focus:ring-[#525252] placeholder-[#525252] text-[#D4D4D4] outline-none transition-all"
                                placeholder="Search case law, tasks, matters..."
                                type="text"
                            />
                        </div>
                        <button
                            onClick={() => setIsSopModalOpen(true)}
                            className="bg-[#B8B8B8] text-[#0A0A0A] text-xs font-bold px-4 py-2 rounded flex items-center gap-2 hover:bg-[#B8B8B8]/90 transition-all cursor-pointer"
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
                            className="glass-card border border-zinc-700/60 rounded-lg p-5 flex items-center gap-4 relative overflow-hidden group"
                            data-purpose="daily-brief"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-[#B8B8B8]/10 to-transparent pointer-events-none"></div>
                            <div className="w-10 h-10 shrink-0 rounded-full bg-[#B8B8B8]/20 flex items-center justify-center text-[#B8B8B8]">
                                <BellRing className="w-5 h-5 animate-bounce" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-serif text-white text-sm">DAILY BRIEF</h3>
                                <p className="text-xs text-[#B8B8B8]">
                                    {tasksThisWeekCount > 0
                                        ? <>{tasksThisWeekCount} task{tasksThisWeekCount > 1 ? 's' : ''} scheduled in your <span className="font-bold underline">THIS WEEK</span> pipeline.{tasksUrgentCount > 0 ? ` ${tasksUrgentCount} flagged as high priority.` : ''}</>
                                        : <>Your pipeline for this week is clear. Great job!</>}
                                </p>
                            </div>
                            <button
                                onClick={() => setIsDailyBriefOpen(false)}
                                className="text-[10px] shrink-0 font-mono border border-[#3A3A3A] px-3 py-1 rounded hover:bg-[#B8B8B8]/10 transition-colors cursor-pointer"
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
                            <span className="text-[10px] font-mono text-[#B8B8B8] cursor-pointer hover:underline">
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
                                    const borderColors = ['border-l-[#B8B8B8]', 'border-l-emerald-400', 'border-l-[#B8B8B8]'];
                                    const bgColors = ['bg-[#1C1C1C]', 'bg-emerald-500/10', 'bg-[#1C1C1C]'];
                                    const textColors = ['text-[#B8B8B8]', 'text-emerald-400', 'text-[#B8B8B8]'];
                                    const tagBorderColors = ['border-[#2A2A2A]', 'border-emerald-500/20', 'border-[#2A2A2A]'];
                                    const barColors = ['bg-[#B8B8B8]', 'bg-emerald-400', 'bg-[#B8B8B8]'];

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
                                            <div className="w-full bg-[#1E1E1E] h-1 rounded-full overflow-hidden">
                                                <div className={`${barColor} h-full transition-all duration-500 ease-out`} style={{ width: `${getMatterProgress(matter.id)}%` }}></div>
                                            </div>
                                            <div className="mt-2 flex justify-between text-[10px]">
                                                <span className="opacity-50">Value: ${matter.claim_value?.toLocaleString() || '0'}</span>
                                                <span className={`${textColor} font-bold`}>{getMatterProgress(matter.id)}%</span>
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
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] min-w-[320px] bg-[#1A1A1A] rounded-[16px] p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'backlog'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-2 pt-1 pb-2">
                                    <h5 className="text-[15px] font-semibold text-[#D6D3D1]">
                                        Backlog <span className="text-[#A8A29E] font-medium ml-1.5 opacity-80">({getTasksByStatus('backlog').length})</span>
                                    </h5>
                                    <MoreHorizontal className="w-5 h-5 text-[#A8A29E] hover:text-[#D6D3D1] cursor-pointer transition-colors" />
                                </div>

                                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar px-1">
                                    {/* Task Cards */}
                                    {getTasksByStatus('backlog').map(task => (
                                        <div
                                            key={task.id}
                                            draggable={true}
                                            onDragStart={() => setDraggedTaskId(task.id)}
                                            onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                            className={`bg-[#262626] rounded-[12px] border border-[#333333] shadow-[0_8px_16px_rgba(0,0,0,0.5)] p-4 hover:brightness-110 transition-all cursor-pointer relative group ${draggedTaskId === task.id ? 'opacity-50 ring-2 ring-[#D6D3D1] scale-[0.98]' : ''}`}
                                        >
                                            {/* Priority Dash */}
                                            <div className={`w-8 h-1.5 rounded-full mb-3 ${task.priority === 'urgent' ? 'bg-rose-500' : task.priority === 'high' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>

                                            {/* Title */}
                                            <h4 className="text-[#F5F5F4] text-sm font-medium tracking-wide mb-1 leading-snug">
                                                {task.title}
                                            </h4>

                                            {/* Description */}
                                            <p className="text-[#D6D3D1] opacity-70 text-xs mt-2 line-clamp-2 leading-relaxed">
                                                {task.matters?.title || "Unknown Matter"}
                                            </p>

                                            {/* Footer */}
                                            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#57534E]/50">
                                                <div className="flex items-center gap-3 text-[#A8A29E]">
                                                    <div className="flex items-center gap-1.5" title="Task ID">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                        <span className="text-[11px] font-medium uppercase">#{task.id?.substring(0, 4)}</span>
                                                    </div>
                                                    {task.source_note_id && (
                                                        <div
                                                            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/contracts/${task.contract_notes?.contract_id || task.matter_id}?noteId=${task.source_note_id}`; }}
                                                            title="View Source Note"
                                                        >
                                                            <LinkIcon className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-medium uppercase tracking-wider">Note</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Avatars */}
                                                <div className="flex -space-x-1.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-stone-700 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-200 font-medium">JD</div>
                                                    <div className="w-6 h-6 rounded-full bg-stone-600 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-100 font-medium">AL</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Add Task Button */}
                                <button
                                    onClick={() => setIsSopModalOpen(true)}
                                    className="text-[#A8A29E] text-xs font-semibold hover:bg-[#44403C]/40 rounded-xl py-3 mt-2 transition-colors flex justify-center items-center w-full"
                                >
                                    + Add Task
                                </button>
                            </div>

                            {/* Column: This Week */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] min-w-[320px] bg-[#1A1A1A] rounded-[16px] p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'this_week'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-2 pt-1 pb-2">
                                    <h5 className="text-[15px] font-semibold text-[#D6D3D1]">
                                        This Week <span className="text-[#A8A29E] font-medium ml-1.5 opacity-80">({getTasksByStatus('this_week').length})</span>
                                    </h5>
                                    <MoreHorizontal className="w-5 h-5 text-[#A8A29E] hover:text-[#D6D3D1] cursor-pointer transition-colors" />
                                </div>

                                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar px-1">
                                    {/* Task Cards */}
                                    {getTasksByStatus('this_week').map(task => (
                                        <div
                                            key={task.id}
                                            draggable={true}
                                            onDragStart={() => setDraggedTaskId(task.id)}
                                            onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                            className={`bg-[#262626] rounded-[12px] border border-[#333333] shadow-[0_8px_16px_rgba(0,0,0,0.5)] p-4 hover:brightness-110 transition-all cursor-pointer relative group ${draggedTaskId === task.id ? 'opacity-50 ring-2 ring-[#D6D3D1] scale-[0.98]' : ''}`}
                                        >
                                            {/* Priority Dash */}
                                            <div className={`w-8 h-1.5 rounded-full mb-3 ${task.priority === 'urgent' ? 'bg-rose-500' : task.priority === 'high' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>

                                            {/* Title */}
                                            <h4 className="text-[#F5F5F4] text-sm font-medium tracking-wide mb-1 leading-snug">
                                                {task.title}
                                            </h4>

                                            {/* Description */}
                                            <p className="text-[#D6D3D1] opacity-70 text-xs mt-2 line-clamp-2 leading-relaxed">
                                                {task.matters?.title || "Unknown Matter"}
                                            </p>

                                            {/* Footer */}
                                            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#57534E]/50">
                                                <div className="flex items-center gap-3 text-[#A8A29E]">
                                                    <div className="flex items-center gap-1.5" title="Task ID">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                        <span className="text-[11px] font-medium uppercase">#{task.id?.substring(0, 4)}</span>
                                                    </div>
                                                    {task.source_note_id && (
                                                        <div
                                                            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/contracts/${task.contract_notes?.contract_id || task.matter_id}?noteId=${task.source_note_id}`; }}
                                                            title="View Source Note"
                                                        >
                                                            <LinkIcon className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-medium uppercase tracking-wider">Note</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Avatars */}
                                                <div className="flex -space-x-1.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-stone-700 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-200 font-medium">JD</div>
                                                    <div className="w-6 h-6 rounded-full bg-stone-600 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-100 font-medium">AL</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Add Task Button */}
                                <button
                                    onClick={() => setIsSopModalOpen(true)}
                                    className="text-[#A8A29E] text-xs font-semibold hover:bg-[#44403C]/40 rounded-xl py-3 mt-2 transition-colors flex justify-center items-center w-full"
                                >
                                    + Add Task
                                </button>
                            </div>

                            {/* Column: In Progress */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] min-w-[320px] bg-[#1A1A1A] rounded-[16px] p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'in_progress'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-2 pt-1 pb-2">
                                    <h5 className="text-[15px] font-semibold text-[#D6D3D1]">
                                        In Progress <span className="text-[#A8A29E] font-medium ml-1.5 opacity-80">({getTasksByStatus('in_progress').length})</span>
                                    </h5>
                                    <MoreHorizontal className="w-5 h-5 text-[#A8A29E] hover:text-[#D6D3D1] cursor-pointer transition-colors" />
                                </div>

                                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar px-1">
                                    {/* Task Cards */}
                                    {getTasksByStatus('in_progress').map(task => (
                                        <div
                                            key={task.id}
                                            draggable={true}
                                            onDragStart={() => setDraggedTaskId(task.id)}
                                            onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                            className={`bg-[#262626] rounded-[12px] border border-[#333333] shadow-[0_8px_16px_rgba(0,0,0,0.5)] p-4 hover:brightness-110 transition-all cursor-pointer relative group ${draggedTaskId === task.id ? 'opacity-50 ring-2 ring-[#D6D3D1] scale-[0.98]' : ''}`}
                                        >
                                            {/* Priority Dash */}
                                            <div className={`w-8 h-1.5 rounded-full mb-3 ${task.priority === 'urgent' ? 'bg-rose-500' : task.priority === 'high' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>

                                            {/* Title */}
                                            <h4 className="text-[#F5F5F4] text-sm font-medium tracking-wide mb-1 leading-snug">
                                                {task.title}
                                            </h4>

                                            {/* Description */}
                                            <p className="text-[#D6D3D1] opacity-70 text-xs mt-2 line-clamp-2 leading-relaxed">
                                                {task.matters?.title || "Unknown Matter"}
                                            </p>

                                            {/* Footer */}
                                            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#57534E]/50">
                                                <div className="flex items-center gap-3 text-[#A8A29E]">
                                                    <div className="flex items-center gap-1.5" title="Task ID">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                        <span className="text-[11px] font-medium uppercase">#{task.id?.substring(0, 4)}</span>
                                                    </div>
                                                    {task.source_note_id && (
                                                        <div
                                                            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/contracts/${task.contract_notes?.contract_id || task.matter_id}?noteId=${task.source_note_id}`; }}
                                                            title="View Source Note"
                                                        >
                                                            <LinkIcon className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-medium uppercase tracking-wider">Note</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Avatars */}
                                                <div className="flex -space-x-1.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-stone-700 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-200 font-medium">JD</div>
                                                    <div className="w-6 h-6 rounded-full bg-stone-600 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-100 font-medium">AL</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Add Task Button */}
                                <button
                                    onClick={() => setIsSopModalOpen(true)}
                                    className="text-[#A8A29E] text-xs font-semibold hover:bg-[#44403C]/40 rounded-xl py-3 mt-2 transition-colors flex justify-center items-center w-full"
                                >
                                    + Add Task
                                </button>
                            </div>

                            {/* Column: Waiting */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] min-w-[320px] bg-[#1A1A1A] rounded-[16px] p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'waiting'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-2 pt-1 pb-2">
                                    <h5 className="text-[15px] font-semibold text-[#D6D3D1]">
                                        Waiting <span className="text-[#A8A29E] font-medium ml-1.5 opacity-80">({getTasksByStatus('waiting').length})</span>
                                    </h5>
                                    <MoreHorizontal className="w-5 h-5 text-[#A8A29E] hover:text-[#D6D3D1] cursor-pointer transition-colors" />
                                </div>

                                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar px-1">
                                    {/* Task Cards */}
                                    {getTasksByStatus('waiting').map(task => (
                                        <div
                                            key={task.id}
                                            draggable={true}
                                            onDragStart={() => setDraggedTaskId(task.id)}
                                            onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                            className={`bg-[#262626] rounded-[12px] border border-[#333333] shadow-[0_8px_16px_rgba(0,0,0,0.5)] p-4 hover:brightness-110 transition-all cursor-pointer relative group ${draggedTaskId === task.id ? 'opacity-50 ring-2 ring-[#D6D3D1] scale-[0.98]' : 'opacity-70'}`}
                                        >
                                            {/* Priority Dash */}
                                            <div className={`w-8 h-1.5 rounded-full mb-3 ${task.priority === 'urgent' ? 'bg-rose-500' : task.priority === 'high' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>

                                            {/* Title */}
                                            <h4 className="text-[#F5F5F4] text-sm font-medium tracking-wide mb-1 leading-snug">
                                                {task.title}
                                            </h4>

                                            {/* Description */}
                                            <p className="text-[#D6D3D1] opacity-70 text-xs mt-2 line-clamp-2 leading-relaxed">
                                                {task.matters?.title || "Unknown Matter"}
                                            </p>

                                            {/* Footer */}
                                            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#57534E]/50">
                                                <div className="flex items-center gap-3 text-[#A8A29E]">
                                                    <div className="flex items-center gap-1.5" title="Task ID">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                        <span className="text-[11px] font-medium uppercase">#{task.id?.substring(0, 4)}</span>
                                                    </div>
                                                    {task.source_note_id && (
                                                        <div
                                                            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/contracts/${task.contract_notes?.contract_id || task.matter_id}?noteId=${task.source_note_id}`; }}
                                                            title="View Source Note"
                                                        >
                                                            <LinkIcon className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-medium uppercase tracking-wider">Note</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Avatars */}
                                                <div className="flex -space-x-1.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-stone-700 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-200 font-medium">JD</div>
                                                    <div className="w-6 h-6 rounded-full bg-stone-600 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-100 font-medium">AL</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Add Task Button */}
                                <button
                                    onClick={() => setIsSopModalOpen(true)}
                                    className="text-[#A8A29E] text-xs font-semibold hover:bg-[#44403C]/40 rounded-xl py-3 mt-2 transition-colors flex justify-center items-center w-full"
                                >
                                    + Add Task
                                </button>
                            </div>

                            {/* Column: Done */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[600px] min-w-[320px] bg-[#1A1A1A] rounded-[16px] p-3 transition-colors duration-200" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); if (draggedTaskId) { await handleUpdateTaskStatus(draggedTaskId, 'done'); setDraggedTaskId(null); } }}>
                                <div className="flex items-center justify-between px-2 pt-1 pb-2">
                                    <h5 className="text-[15px] font-semibold text-[#D6D3D1]">
                                        Done <span className="text-[#A8A29E] font-medium ml-1.5 opacity-80">({getTasksByStatus('done').length})</span>
                                    </h5>
                                    <MoreHorizontal className="w-5 h-5 text-[#A8A29E] hover:text-[#D6D3D1] cursor-pointer transition-colors" />
                                </div>

                                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar px-1">
                                    {/* Task Cards */}
                                    {getTasksByStatus('done').map(task => (
                                        <div
                                            key={task.id}
                                            draggable={true}
                                            onDragStart={() => setDraggedTaskId(task.id)}
                                            onClick={() => { setSelectedTask(task); setIsTaskDetailOpen(true); }}
                                            className={`bg-[#262626] rounded-[12px] border border-[#333333] shadow-[0_8px_16px_rgba(0,0,0,0.5)] p-4 hover:brightness-110 transition-all cursor-pointer relative group ${draggedTaskId === task.id ? 'opacity-50 ring-2 ring-[#D6D3D1] scale-[0.98]' : 'opacity-50'}`}
                                        >
                                            {/* Priority Dash */}
                                            <div className={`w-8 h-1.5 rounded-full mb-3 ${task.priority === 'urgent' ? 'bg-rose-500' : task.priority === 'high' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>

                                            {/* Title */}
                                            <h4 className="text-[#F5F5F4] text-sm font-medium tracking-wide mb-1 leading-snug">
                                                {task.title}
                                            </h4>

                                            {/* Description */}
                                            <p className="text-[#D6D3D1] opacity-70 text-xs mt-2 line-clamp-2 leading-relaxed">
                                                {task.matters?.title || "Unknown Matter"}
                                            </p>

                                            {/* Footer */}
                                            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#57534E]/50">
                                                <div className="flex items-center gap-3 text-[#A8A29E]">
                                                    <div className="flex items-center gap-1.5" title="Task ID">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                        <span className="text-[11px] font-medium uppercase">#{task.id?.substring(0, 4)}</span>
                                                    </div>
                                                    {task.source_note_id && (
                                                        <div
                                                            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/contracts/${task.contract_notes?.contract_id || task.matter_id}?noteId=${task.source_note_id}`; }}
                                                            title="View Source Note"
                                                        >
                                                            <LinkIcon className="w-3.5 h-3.5" />
                                                            <span className="text-[10px] font-medium uppercase tracking-wider">Note</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Avatars */}
                                                <div className="flex -space-x-1.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-stone-700 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-200 font-medium">JD</div>
                                                    <div className="w-6 h-6 rounded-full bg-stone-600 ring-2 ring-[#44403C] flex items-center justify-center text-[10px] text-stone-100 font-medium">AL</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Add Task Button */}
                                <button
                                    onClick={() => setIsSopModalOpen(true)}
                                    className="text-[#A8A29E] text-xs font-semibold hover:bg-[#44403C]/40 rounded-xl py-3 mt-2 transition-colors flex justify-center items-center w-full"
                                >
                                    + Add Task
                                </button>
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
                            <span className="text-[10px] font-mono text-[#B8B8B8] tracking-widest px-2 py-0.5 border border-[#3A3A3A] rounded">
                                {selectedTask?.id?.substring(0, 8).toUpperCase() || 'T-0000'}
                            </span>
                            <div className="flex items-center gap-2">
                                <ConfirmDialog
                                    title="Delete Task"
                                    description="Delete this task permanently? This action cannot be undone."
                                    onConfirm={handleDeleteTask}
                                    trigger={
                                        <button
                                            className="opacity-40 hover:text-red-500 hover:opacity-100 cursor-pointer transition-colors"
                                            title="Delete task"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    }
                                />
                                <button
                                    className="opacity-40 hover:opacity-100 cursor-pointer"
                                    onClick={() => setIsTaskDetailOpen(false)}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* 🚨 THE BILLION-DOLLAR BREADCRUMB 🚨 */}
                        <div className="flex items-center gap-2 text-[10px] font-medium tracking-wide mb-3 flex-wrap">
                            {/* Matter Pill */}
                            <div className="flex items-center gap-1.5 text-gray-400 bg-white/5 px-2 py-1 rounded border border-white/5 cursor-pointer hover:bg-white/10 hover:text-white transition-colors">
                                <Folder size={12} className="text-[#B8B8B8]" />
                                <span className="truncate max-w-[150px]">
                                    {selectedTask?.matters?.title || "Unknown Matter"}
                                </span>
                            </div>

                            <span className="text-gray-600">•</span>

                            {/* Source Document Pill */}
                            {selectedTask?.is_ai_generated && selectedTask?.source_document_name ? (
                                <div
                                    className="flex items-center gap-1.5 text-[#B8B8B8] bg-[#B8B8B8]/10 px-2 py-1 rounded border border-[#2A2A2A] cursor-pointer hover:bg-[#B8B8B8]/20 transition-colors"
                                    title="Click to view source document"
                                >
                                    <FileText size={12} />
                                    <span className="truncate max-w-[200px]">{selectedTask.source_document_name}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 text-gray-500 bg-white/5 px-2 py-1 rounded border border-white/5">
                                    <User size={12} />
                                    <span>Manual Entry</span>
                                </div>
                            )}

                            {/* Source Note Deep Link Pill */}
                            {selectedTask?.source_note_id && (
                                <>
                                    <span className="text-gray-600">•</span>
                                    <Link
                                        href={`/dashboard/contracts/${selectedTask.contract_notes?.contract_id || selectedTask.matter_id}?noteId=${selectedTask.source_note_id}`}
                                        className="flex items-center gap-1.5 text-[#B8B8B8] bg-[#1C1C1C] px-2 py-1 rounded border border-[#2A2A2A] hover:bg-[#B8B8B8]/20 hover:text-[#D4D4D4] transition-colors"
                                        title="View the original AI insight that generated this task"
                                    >
                                        <LinkIcon className="w-3 h-3" />
                                        <span>Source Note</span>
                                    </Link>
                                </>
                            )}
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
                            {selectedTask?.is_ai_generated && (
                                <span className="text-[9px] font-mono px-2 py-1 bg-[#B8B8B8]/10 text-[#B8B8B8] rounded border border-[#2A2A2A] flex items-center gap-1">
                                    <ShieldCheck className="w-2.5 h-2.5" /> AI Verified
                                </span>
                            )}
                        </div>
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setDraftingTask({ matterId: selectedTask.matter_id || selectedTask.id, title: selectedTask.title });
                            }}
                            className="mt-4 w-full bg-[#B8B8B8]/10 hover:bg-[#B8B8B8]/20 border border-[#B8B8B8]/30 text-[#B8B8B8] py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                        >
                            ✨ Open Smart Composer
                        </button>
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
                                    <div className="w-2 h-2 rounded-full bg-[#B8B8B8]"></div>
                                    <span className="text-[9px] font-mono opacity-50">Created</span>
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-[#B8B8B8]"></div>
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

                        {/* AI Assistant Toggle */}
                        <div className="flex p-1 bg-[#18181B] rounded-lg border border-zinc-800/80 mb-6">
                            <button
                                onClick={() => setIsAiMode(false)}
                                className={!isAiMode
                                    ? "bg-[#0a0a0a] text-white shadow-sm rounded-md flex-1 py-2 text-xs font-semibold tracking-wide transition-all cursor-pointer"
                                    : "text-zinc-500 hover:text-zinc-300 flex-1 py-2 text-xs font-semibold tracking-wide transition-all cursor-pointer"}
                            >
                                Task Details
                            </button>
                            <button
                                onClick={() => setIsAiMode(true)}
                                className={isAiMode
                                    ? "bg-[#0a0a0a] text-[#B8B8B8] border border-[#B8B8B8]/20 shadow-sm rounded-md flex-1 py-2 text-xs font-semibold tracking-wide transition-all cursor-pointer"
                                    : "text-zinc-500 hover:text-zinc-300 flex-1 py-2 text-xs font-semibold tracking-wide transition-all cursor-pointer"}
                            >
                                Clause Assistant
                            </button>
                        </div>

                        {isAiMode ? (
                            <div className="flex flex-col h-[500px] bg-[#0a0a0a] border border-zinc-800/50 rounded-xl p-4">
                                <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-2 custom-scrollbar">
                                    {messages.map((msg, idx) => (
                                        <div key={idx} className={msg.role === "ai" ? "bg-[#0a0a0a] border border-zinc-700/50 text-zinc-300 text-xs p-3.5 rounded-2xl rounded-tl-sm leading-relaxed self-start w-[85%]" : "bg-[#B8B8B8]/10 border border-[#B8B8B8]/20 text-[#e5e5e5] text-xs p-3.5 rounded-2xl rounded-tr-sm self-end w-[85%]"}>
                                            {msg.content}
                                        </div>
                                    ))}
                                    {isAiTyping && (
                                        <div className="bg-[#0a0a0a] border border-zinc-700/50 text-zinc-300 text-xs p-3.5 rounded-2xl rounded-tl-sm self-start w-[85%]">
                                            <LuxuryThinkingStepper 
                                                isLoading={true} 
                                                steps={[
                                                    "Initializing Task Assistant...",
                                                    "Fetching active Kanban board...",
                                                    "Analyzing task deadlines & priorities...",
                                                    "Generating workflow recommendations..."
                                                ]} 
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 relative">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSendMessage();
                                        }}
                                        className="w-full bg-[#18181B] border border-zinc-700/60 rounded-xl pl-4 pr-12 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#B8B8B8]/50 focus:ring-1 focus:ring-[#B8B8B8]/50 transition-all"
                                        placeholder="Ask a question or request drafting assistance..."
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B8B8B8] hover:text-[#888888] transition-colors cursor-pointer"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Checklist */}
                                <div data-purpose="checklist">
                                    <div className="mb-6 border-b border-white/10 pb-6 min-h-[150px]">
                                        {/* TITLE & PERCENTAGE TEXT */}
                                        <div className="flex justify-between items-center mb-4">
                                            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Procedural Steps & Checklists</h4>
                                            <span className="text-[10px] font-bold text-[#B8B8B8]">
                                                {proceduralSteps.length === 0 ? 0 : Math.round((proceduralSteps.filter(s => s.is_completed).length / proceduralSteps.length) * 100)}%
                                            </span>
                                        </div>

                                        {/* THE SLEEK PROGRESS BAR */}
                                        <div className="w-full h-0.5 bg-white/10 rounded-full mb-4 overflow-hidden">
                                            <div
                                                className="h-full bg-[#B8B8B8] transition-all duration-500 ease-out"
                                                style={{ width: `${proceduralSteps.length === 0 ? 0 : Math.round((proceduralSteps.filter(s => s.is_completed).length / proceduralSteps.length) * 100)}%` }}
                                            ></div>
                                        </div>

                                        {/* Dynamic List Rendering */}
                                        {proceduralSteps.length > 0 ? (
                                            <ul className="space-y-3 mb-4 animate-in fade-in duration-300">
                                                {proceduralSteps.map(step => (
                                                    <li key={step.id} className="flex items-start gap-3 group relative py-1">
                                                        <input
                                                            type="checkbox"
                                                            checked={step.is_completed}
                                                            onChange={async () => await handleToggleStep(step.id, !step.is_completed)}
                                                            className="mt-1 accent-[#B8B8B8] w-4 h-4 cursor-pointer rounded border-white/10 bg-white/5 shrink-0"
                                                        />
                                                        <span className={`text-sm tracking-wide flex-1 transition-colors ${step.is_completed ? "line-through text-gray-600" : "text-gray-300"}`}>
                                                            {step.title}
                                                        </span>

                                                        {/* DELETE BUTTON - Visible on hover */}
                                                        <button
                                                            onClick={async () => await handleDeleteSubTask(step.id)}
                                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-all cursor-pointer"
                                                            title="Delete sub-task"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-xs text-gray-500 mb-4 italic animate-in fade-in duration-300">No procedural steps defined.</p>
                                        )}

                                        {/* Ad-Hoc Input placed directly below the list */}
                                        <div className="relative mt-2">
                                            <input
                                                type="text"
                                                placeholder="+ Add ad-hoc sub-task and press Enter"
                                                value={newSubTask}
                                                onChange={(e) => setNewSubTask(e.target.value)}
                                                className="w-full bg-black/50 border border-white/10 rounded-lg p-2.5 text-xs text-white outline-none focus:border-[#3A3A3A] transition-colors placeholder:text-gray-600 placeholder:italic"
                                                onKeyDown={async (e) => {
                                                    if (e.key === 'Enter' && newSubTask.trim() !== '') {
                                                        try {
                                                            const token = await getApiToken();
                                                            await createSubTaskAPI(token, selectedTask.id, newSubTask.trim());
                                                            setNewSubTask(''); // Clear input
                                                            await fetchTaskDetails();
                                                        } catch (error) {
                                                            console.error("❌ ERROR INSERTING SUB-TASK:", error);
                                                            toast.error("Failed to add ad-hoc checklist");
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
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
                                                    <div className="text-[#B8B8B8] shrink-0">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                                    </div>
                                                    <div className="overflow-hidden">
                                                        <p className="text-[10px] text-white truncate w-full">{file.file_name}</p>
                                                        <p className="text-[8px] font-mono text-[#888888]/60 mt-0.5">{file.source?.toUpperCase() || 'UPLOADED'}</p>
                                                    </div>
                                                    {/* Delete Button for files */}
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                const token = await getApiToken();
                                                                await deleteAttachmentAPI(token, file.id);
                                                                await fetchTaskDetails();
                                                            } catch (err) {
                                                                toast.error("Failed to delete attachment");
                                                            }
                                                        }}
                                                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs cursor-pointer z-10"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    <label className="mt-3 border border-dashed border-white/10 rounded-lg p-4 flex flex-col items-center justify-center gap-2 hover:border-[#3A3A3A] transition-all cursor-pointer">
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
                                            <span className="text-white/60 hover:text-[#B8B8B8] cursor-pointer">
                                                T-1088 (Evidence Audit)
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <span className="text-emerald-400 font-bold uppercase tracking-tighter">
                                                Blocking
                                            </span>
                                            <span className="text-white/60 hover:text-[#B8B8B8] cursor-pointer">
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
                                                    <div className={`w-4 h-4 rounded-full ${idx === 0 ? 'bg-[#B8B8B8]/20' : 'bg-white/10'} flex items-center justify-center shrink-0 z-10`}>
                                                        <div className={`w-1.5 h-1.5 ${idx === 0 ? 'bg-[#B8B8B8]' : 'bg-white/40'} rounded-full`}></div>
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
                            </>
                        )}
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
                                className="bg-white/5 border border-white/10 text-white rounded p-2 w-full mb-4 focus:ring-1 focus:ring-[#888888]/50 outline-none"
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
                            <div className="glass-card p-5 rounded-md border-white/5 hover:border-[#3A3A3A] cursor-pointer transition-all flex flex-col">
                                <div className="flex justify-between mb-4">
                                    <FilePlus className="w-6 h-6 text-[#B8B8B8] opacity-50" />
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
                                    className="mt-auto pt-4 text-xs font-mono text-[#B8B8B8] text-left cursor-pointer hover:underline"
                                    onClick={() => handleCreateBlankTask(selectedMatterId)}
                                >
                                    SELECT TEMPLATE →
                                </button>
                            </div>

                            {/* 2. DYNAMIC TEMPLATES OR EMPTY STATE */}
                            {customTemplates.length > 0 ? (
                                customTemplates.map((template) => {
                                    // Extract the count from the Supabase relationship array
                                    const itemCount = template.task_template_items?.[0]?.count || 0;

                                    return (
                                        <div key={template.id} onClick={() => {
                                            if (!selectedMatterId) {
                                                toast.error('Matter Required', { description: 'Please select a matter first.', style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' } });
                                                return;
                                            }
                                            handleApplySOPTemplate(template.id, selectedMatterId);
                                        }}
                                            className="bg-white/5 border border-white/10 hover:border-[#3A3A3A] p-5 rounded-xl transition-all duration-300 hover:bg-white/10 cursor-pointer flex flex-col h-full group"
                                        >
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[#B8B8B8]"><Gavel size={20} /></div>
                                                    <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-1 bg-[#B8B8B8]/10 text-[#B8B8B8] rounded border border-[#2A2A2A]">Premium SOP</span>
                                                </div>

                                                <ConfirmDialog
                                                    title="Delete Template"
                                                    description="Delete this SOP Template? This action cannot be undone."
                                                    onConfirm={() => handleDeleteTemplate(template.id)}
                                                    trigger={
                                                        <button
                                                            className="text-gray-500 hover:text-red-400 hover:bg-red-400/10 p-1.5 rounded transition-colors"
                                                            title="Delete Template"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    }
                                                />
                                            </div>
                                            <h3 className="text-lg font-bold text-white mb-2">{template.name}</h3>
                                            <p className="text-xs text-gray-400 leading-relaxed flex-grow">
                                                {template.matter_type ? `Category: ${template.matter_type}` : 'Standardized legal workflow.'}
                                            </p>
                                            <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/10">
                                                <span className="text-[10px] font-bold text-gray-500 tracking-wider uppercase">{itemCount} SUB-TASKS • AI ASSISTED</span>
                                                <span className="text-xs font-semibold text-[#B8B8B8] group-hover:translate-x-1 transition-transform">SELECT TEMPLATE →</span>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                /* EMPTY STATE: No Templates Found */
                                <div className="bg-transparent border-2 border-dashed border-white/10 p-5 rounded-xl flex flex-col items-center justify-center text-center h-full">
                                    <div className="text-gray-500 mb-3"><FileWarning size={28} /></div>
                                    <h3 className="text-sm font-bold text-gray-300 mb-1">No Custom SOPs Found</h3>
                                    <p className="text-xs text-gray-500 mb-4 px-4">Standardize your workflow by creating AI-assisted Task Templates.</p>
                                    <Link href="/dashboard/settings/templates" onClick={() => setIsSopModalOpen(false)} className="text-xs font-semibold text-[#B8B8B8] border border-[#3A3A3A] bg-[#B8B8B8]/10 px-4 py-2 rounded hover:bg-[#B8B8B8]/20 transition-colors">
                                        + Create Template
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* END: SOP Modal Overlay */}

            {/* BEGIN: Task-Specific AI Chat Modal */}
            {activeAiTask && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#0a0a0a] border border-[#3A3A3A] rounded-xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">

                        {/* Header */}
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <div>
                                <h3 className="text-[#B8B8B8] font-serif text-lg flex items-center gap-2">Clause Assistant</h3>
                                <p className="text-[10px] text-white/50 mt-1 uppercase tracking-wider">Context: {activeAiTask.title}</p>
                            </div>
                            <button onClick={() => setActiveAiTask(null)} className="text-white/50 hover:text-white p-2 cursor-pointer">✕</button>
                        </div>

                        {/* Chat Body */}
                        <div className="p-6 text-sm text-white/80 space-y-4 h-[350px] overflow-y-auto flex flex-col">
                            {/* Initial Greeting */}
                            {aiMessages.length === 0 && (
                                <div className="bg-white/5 p-3 rounded-lg border border-white/10 self-start max-w-[85%]">
                                    <p className="mb-2">I am analyzing the documents for <span className="text-[#B8B8B8] font-medium">"{activeAiTask?.matters?.title || 'this matter'}"</span> to assist you with the task: <span className="font-semibold text-white">"{activeAiTask?.title}"</span>.</p>
                                    <p className="text-xs text-white/50">I can draft emails, extract obligations from the contract, or suggest next procedural steps. What do you need?</p>
                                </div>
                            )}

                            {/* Mapped Messages */}
                            {aiMessages.map((msg, idx) => {
                                const safeContent = msg.role === 'ai'
                                    ? assertSafeLlmText(msg.content, 'task_assistant_response')
                                    : msg.content;

                                return (
                                <div key={idx} className={`p-3.5 rounded-xl max-w-[85%] shadow-lg ${msg.role === 'user' ? 'bg-[#B8B8B8]/20 border border-[#3A3A3A] self-end text-[#0A0A0A]' : 'bg-white/5 border border-white/10 self-start text-white/90'}`}>
                                    {msg.role === 'user' ? (
                                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                                    ) : (
                                        <div className="text-sm">
                                            <ReactMarkdown
                                                disallowedElements={DISALLOWED_MARKDOWN_ELEMENTS}
                                                unwrapDisallowed
                                                components={{
                                                    p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-relaxed" {...props} />,
                                                    strong: ({ node, ...props }) => <strong className="font-bold text-[#B8B8B8]" {...props} />,
                                                    ul: ({ node, ...props }) => <ul className="list-disc ml-5 mb-3 space-y-1.5" {...props} />,
                                                    ol: ({ node, ...props }) => <ol className="list-decimal ml-5 mb-3 space-y-1.5" {...props} />,
                                                    li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                                                    a: ({ node, href, children, ...props }) => {
                                                        // Extract the text content safely
                                                        let linkText = '';
                                                        if (Array.isArray(children)) {
                                                            linkText = children.map(c => typeof c === 'string' ? c : c?.props?.children || '').join('');
                                                        } else {
                                                            linkText = String(children);
                                                        }

                                                        // BULLETPROOF CHECK: Does the visible text contain our trigger phrase?
                                                        if (linkText.includes('+ Add Task:')) {
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();

                                                                        const currentTaskId = activeAiTask?.id;
                                                                        console.log("⚡ [DEBUG] Tombol Emas Diklik! Title:", linkText, "Task ID:", currentTaskId);
                                                                        handleCreateAiSubtask(linkText, currentTaskId);
                                                                    }}
                                                                    className="bg-[#B8B8B8]/10 hover:bg-[#B8B8B8]/30 text-[#B8B8B8] border border-[#3A3A3A] px-3 py-1.5 rounded-lg text-xs font-semibold mt-2 mb-2 flex items-center gap-2 transition-all duration-200 shadow-sm cursor-pointer w-fit text-left"
                                                                >
                                                                    ⚡ {linkText}
                                                                </button>
                                                            );
                                                        }

                                                        // Fallback for normal links
                                                        return <a href={safeExternalHref(href)} target="_blank" rel="noopener noreferrer" className="text-[#B8B8B8] underline" onClick={(e) => e.preventDefault()} {...props}>{children}</a>;
                                                    },
                                                    img: ({ alt, src }) => (
                                                        <BlockedMarkdownImage
                                                            alt={alt}
                                                            src={typeof src === 'string' ? src : undefined}
                                                            className="text-zinc-500"
                                                        />
                                                    ),
                                                }}
                                            >
                                                {safeContent}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            )})}

                            {/* Premium Typing Indicator */}
                            {isAiTyping && (
                                <div className="bg-white/5 border border-white/10 self-start p-4 rounded-xl max-w-[85%] shadow-lg w-full">
                                    <LuxuryThinkingStepper 
                                        isLoading={true} 
                                        steps={[
                                            "Initializing Task Assistant...",
                                            "Fetching active Kanban board...",
                                            "Analyzing task deadlines & priorities...",
                                            "Generating workflow recommendations..."
                                        ]} 
                                    />
                                </div>
                            )}
                        </div>

                        {/* Input Area */}
                        <div className="p-4 bg-white/[0.02] border-t border-white/10">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Ask Clause AI to draft, analyze, or summarize..."
                                    className="w-full bg-[#111] border border-white/10 rounded-lg pl-4 pr-12 py-3 text-white focus:ring-1 focus:ring-[#888888] focus:border-[#3A3A3A] text-xs"
                                    value={aiInput}
                                    onChange={(e) => setAiInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSendAiMessage(); }}
                                />
                                <button onClick={handleSendAiMessage} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#B8B8B8] hover:bg-white/10 p-1.5 rounded-md transition-colors cursor-pointer">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )
            }
            {/* END: Task-Specific AI Chat Modal */}

            {draftingTask && (
                <SmartComposer 
                    matterId={draftingTask.matterId} 
                    taskTitle={draftingTask.title} 
                    onClose={() => setDraftingTask(null)} 
                />
            )}
        </div >
    );
}
