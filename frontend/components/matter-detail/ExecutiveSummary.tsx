'use client'

import { useState } from 'react'
import { updateMatterSummary } from '@/app/actions/matterActions'
import { toast } from 'sonner'

export default function ExecutiveSummary({ matterId, initialDescription }: { matterId: string, initialDescription: string }) {
    const [isEditing, setIsEditing] = useState(false);
    const [description, setDescription] = useState(initialDescription || '');
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        const res = await updateMatterSummary(matterId, description);
        if (res.success) {
            setIsEditing(false);
        } else {
            toast.error("Failed to save summary: " + res.error);
        }
        setIsSaving(false);
    };

    return (
        <div className="bg-surface lg:col-span-8 border border-surface-border rounded p-6 flex flex-col h-full relative group transition-all duration-300 hover:border-gray-700">
            <div className="flex items-center justify-between mb-4 border-b border-surface-border pb-4">
                <h2 className="text-xs font-semibold text-text-muted uppercase tracking-widest flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">description</span>
                    Executive Summary
                </h2>
                {!isEditing && (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="text-text-muted hover:text-primary transition-colors p-1 rounded hover:bg-white/5 flex items-center gap-1 text-xs"
                    >
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                        Edit
                    </button>
                )}
            </div>

            <div className="flex-grow flex flex-col">
                {isEditing ? (
                    <div className="flex flex-col gap-3 h-full">
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full h-full min-h-[150px] bg-[#0a0a0a] border border-surface-border rounded p-3 text-sm text-gray-300 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all font-light leading-relaxed resize-none"
                            placeholder="Enter executive summary..."
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => {
                                    setDescription(initialDescription || '');
                                    setIsEditing(false);
                                }}
                                className="px-3 py-1.5 text-xs text-text-muted hover:text-white transition-colors"
                                disabled={isSaving}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs bg-primary text-[#0A0A0A] font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                                {isSaving ? 'Saving...' : 'Save'}
                                {isSaving && <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="prose prose-invert prose-sm max-w-none">
                        {description ? (
                            <p className="text-gray-300 leading-relaxed font-light whitespace-pre-wrap">
                                {description}
                            </p>
                        ) : (
                            <p className="text-text-muted italic font-light">No executive summary provided. Click edit to add one.</p>
                        )}
                    </div>
                )}
            </div>

            <div className="mt-6 pt-4 border-t border-surface-border flex items-center justify-between text-[10px] text-text-muted">
                <span>Data dynamically linked to Matter ID</span>
                <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">visibility</span>
                    Active View
                </span>
            </div>
        </div>
    )
}
