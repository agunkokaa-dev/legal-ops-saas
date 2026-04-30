'use client'

import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadDocument } from '@/app/actions/documentActions';

interface UploadNextVersionButtonProps {
    matterId: string;
    contractId: string;
    onUploaded: () => Promise<void> | void;
}

export default function UploadNextVersionButton({
    matterId,
    contractId,
    onUploaded,
}: UploadNextVersionButtonProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsUploading(true);
            toast.loading(`Uploading iterative version: ${file.name}...`, { id: 'upload-v' });

            const formData = new FormData();
            formData.append('file', file);

            // Bypass automated matchmaking by passing contractId as parentContractId
            const res = await uploadDocument(matterId, formData, contractId);

            if (res.error) throw new Error(res.error);

            toast.success("New version ingested. Computing Playbook Smart Diff...", { id: 'upload-v' });

            // Reload the WarRoom data seamlessly
            await onUploaded();
        } catch (error: any) {
            toast.error(error.message || 'Upload failed', { id: 'upload-v' });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="pt-2">
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".pdf,.docx,.txt"
                onChange={handleFileUpload}
            />
            <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full mt-3 py-3 border border-dashed border-zinc-700 hover:border-[#3A3A3A] text-zinc-500 hover:text-[#B8B8B8] text-[10px] font-bold uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isUploading ? (
                    <>
                        <span className="w-3 h-3 border-2 border-[#2A2A2A] rounded-full animate-spin border-t-[#B8B8B8]" />
                        UPLOADING...
                    </>
                ) : (
                    <>
                        <span className="material-symbols-outlined text-xs">arrow_upward</span>
                        UPLOAD NEXT VERSION
                    </>
                )}
            </button>
        </div>
    );
}
