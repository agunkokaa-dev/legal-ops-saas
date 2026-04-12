'use client'

import { useState } from 'react'
import { deleteMatter } from '@/app/actions/matterActions'
import ConfirmDialog from './ui/ConfirmDialog'
import { toast } from 'sonner'

export default function DeleteMatterModal({ matterId, matterTitle }: { matterId: string, matterTitle: string }) {
    const [isOpen, setIsOpen] = useState(false)

    const handleDelete = async () => {
        const res = await deleteMatter(matterId)
        if (res.success) {
            setIsOpen(false)
            toast.success("Matter deleted successfully")
        } else {
            toast.error("Failed to delete: " + res.error)
        }
    }

    return (
        <ConfirmDialog
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            title="Delete Matter"
            description={
                <>Are you sure you want to permanently delete <strong className="text-white">{matterTitle}</strong>? This action cannot be undone.</>
            }
            confirmText="Delete Permanently"
            variant="destructive"
            onConfirm={handleDelete}
            trigger={
                <button
                    title="Delete Matter"
                    className="text-text-muted hover:text-red-500 transition-colors p-2 rounded hover:bg-red-500/10 flex items-center justify-center"
                >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
            }
        />
    )
}
