"use client";
import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash, Save, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { getPublicApiBase } from '@/lib/public-api-base';

export default function TemplateBuilder() {
    const { orgId, userId, getToken } = useAuth();
    const tenantId = orgId || userId;

    const [name, setName] = useState('');
    const [matterType, setMatterType] = useState('');
    const [items, setItems] = useState([
        { title: '', description: '', days_offset: 0, position: 1, procedural_steps: [] as string[] }
    ]);

    const handleAddItem = () => {
        setItems([...items, { title: '', description: '', days_offset: 0, position: items.length + 1, procedural_steps: [] }]);
    };

    const handleAddStep = (taskIndex: number, stepTitle: string) => {
        if (!stepTitle.trim()) return;
        const newItems = [...items];
        newItems[taskIndex].procedural_steps.push(stepTitle);
        setItems(newItems);
    };

    const handleRemoveStep = (taskIndex: number, stepIndex: number) => {
        const newItems = [...items];
        newItems[taskIndex].procedural_steps.splice(stepIndex, 1);
        setItems(newItems);
    };

    const handleRemoveItem = (index: number) => {
        const newItems = items.filter((_, i) => i !== index);
        // Re-calculate positions
        setItems(newItems.map((item, i) => ({ ...item, position: i + 1 })));
    };

    const handleItemChange = (index: number, field: string, value: string | number) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value as never };
        setItems(newItems);
    };

    const handleSaveTemplate = async () => {
        if (!name) return toast.error("Template name is required.");
        if (items.some(i => !i.title)) return toast.error("All task items must have a title.");

        const payload = {
            name,
            matter_type: matterType,
            items: items.map(item => ({
                title: item.title,
                description: item.description || "",
                days_offset: item.days_offset || 0,
                position: item.position,
                procedural_steps: item.procedural_steps // string[]
            }))
        };

        try {
            // Adjust the URL/Port to match your FastAPI backend
            // Default 127.0.0.1:8000
            const apiUrl = getPublicApiBase();
            const token = await getToken();
            const response = await fetch(`${apiUrl}/api/v1/templates?tenant_id=${tenantId}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error("Failed to save template");

            toast.success("Template Saved Successfully!", {
                description: `SOP "${name}" is now available for new tasks.`,
                style: { background: '#1a1a1a', border: '1px solid #c5a059', color: '#c5a059' }
            });

            // Reset form
            setName(''); setMatterType(''); setItems([{ title: '', description: '', days_offset: 0, position: 1, procedural_steps: [] }]);

        } catch (error) {
            console.error(error);
            toast.error("Operation Failed", {
                description: 'Could not connect to database or save template.',
                style: { background: '#1a1a1a', border: '1px solid #ef4444', color: '#fff' }
            });
        }
    };

    return (
        <div className="h-full overflow-y-auto p-8 pb-32 max-w-5xl mx-auto text-white">

            {/* Back Button */}
            <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-clause-gold transition-colors mb-6">
                <ArrowLeft size={16} /> Back to Settings
            </Link>

            <h1 className="text-2xl font-bold text-clause-gold mb-6">Create Task Template (SOP)</h1>

            {/* Header Form */}
            <div className="bg-white/5 border border-white/10 p-6 rounded-xl mb-6 space-y-4 shadow-lg">
                <div>
                    <label className="block text-sm text-gray-400 mb-1">Template Name (e.g., standard M&A Due Diligence)</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg p-3 outline-none focus:border-clause-gold transition-colors" />
                </div>
                <div>
                    <label className="block text-sm text-gray-400 mb-1">Matter Type Category</label>
                    <input type="text" value={matterType} onChange={e => setMatterType(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg p-3 outline-none focus:border-clause-gold transition-colors" />
                </div>
            </div>

            {/* Dynamic Items Array */}
            <div className="space-y-4 mb-8">
                <h2 className="text-lg font-semibold text-gray-200 border-b border-white/10 pb-2">Tasks (Kanban Cards)</h2>
                <div className="space-y-3">
                    {items.map((item, index) => (
                        <div key={index} className="flex gap-4 items-start bg-white/5 p-5 rounded-xl border border-white/10 shadow-sm transition-all hover:border-white/20 relative group">

                            {/* Number Bubble */}
                            <div className="w-8 h-8 rounded-full bg-clause-gold/20 text-clause-gold flex items-center justify-center font-bold shrink-0 mt-1 shadow-[0_0_10px_rgba(197,160,89,0.2)]">
                                {index + 1}
                            </div>

                            <div className="flex-1 space-y-4">
                                <div className="flex gap-4">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Task Title (Kanban Card)</label>
                                        <input type="text" placeholder="e.g., Conduct Initial Kick-off Meeting" value={item.title} onChange={e => handleItemChange(index, 'title', e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg p-2 outline-none focus:border-clause-gold text-sm text-white" />
                                    </div>
                                    <div className="w-32">
                                        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Days Offset</label>
                                        <input type="number" placeholder="0" value={item.days_offset} onChange={e => handleItemChange(index, 'days_offset', parseInt(e.target.value) || 0)} className="w-full bg-black/50 border border-white/10 rounded-lg p-2 outline-none focus:border-clause-gold text-sm text-white" />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Description / Notes</label>
                                    <input type="text" placeholder="Optional details..." value={item.description} onChange={e => handleItemChange(index, 'description', e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg p-2 outline-none focus:border-clause-gold text-sm text-white" />
                                </div>

                                {/* NESTED PROCEDURAL STEPS (CHECKLISTS) */}
                                <div className="mt-4 pt-4 border-t border-white/5">
                                    <label className="text-[10px] text-clause-gold uppercase tracking-wider mb-2 block">Procedural Steps (Checklists inside this Task)</label>

                                    {item.procedural_steps.length > 0 && (
                                        <ul className="space-y-2 mb-3">
                                            {item.procedural_steps.map((step, sIndex) => (
                                                <li key={sIndex} className="flex justify-between items-center bg-black/30 border border-white/5 p-2 rounded text-xs text-gray-300">
                                                    <span>• {step}</span>
                                                    <button onClick={() => handleRemoveStep(index, sIndex)} className="text-red-400 hover:text-red-300"><Trash size={14} /></button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}

                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            id={`step-input-${index}`}
                                            placeholder="Add a procedural step..."
                                            className="flex-1 bg-black/50 border border-white/10 rounded p-2 outline-none focus:border-clause-gold text-xs text-white"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddStep(index, e.currentTarget.value);
                                                    e.currentTarget.value = '';
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                const input = document.getElementById(`step-input-${index}`) as HTMLInputElement;
                                                handleAddStep(index, input.value);
                                                input.value = '';
                                            }}
                                            className="bg-clause-gold/20 text-clause-gold px-3 rounded text-xs font-bold hover:bg-clause-gold/30"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Delete Button (visible always, but more prominent on hover) */}
                            <button onClick={() => handleRemoveItem(index)} className="p-2.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors absolute top-4 right-4">
                                <Trash size={18} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* ACTION FOOTER */}
            <div className="flex justify-between items-center bg-transparent mt-6 pt-6 border-t border-white/10">
                <button onClick={handleAddItem} className="flex items-center gap-2 text-sm text-clause-gold hover:text-white transition-colors px-4 py-2 bg-clause-gold/10 rounded-lg">
                    <Plus size={16} /> + Add Task
                </button>
                <button onClick={handleSaveTemplate} className="flex items-center gap-2 px-8 py-3 bg-clause-gold text-black font-bold rounded-lg hover:bg-yellow-500 transition-colors shadow-lg shadow-clause-gold/20">
                    <Save size={18} /> Save Template
                </button>
            </div>
        </div>
    );
}
