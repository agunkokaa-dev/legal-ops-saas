'use client'

import { deleteDocument } from '@/app/actions/documentActions'
import ConfirmDialog from '../ui/ConfirmDialog'
import { toast } from 'sonner'

export default function DeleteDocButton({ documentId, fileUrl, matterId }: { documentId: string, fileUrl: string, matterId: string }) {
    
    const handleDelete = async () => {
        const res = await deleteDocument(documentId, fileUrl, matterId)
        if (res?.error) {
            toast.error(res.error)
            throw new Error(res.error) // This throws to ConfirmDialog so it handles the loading state reset correctly natively
        } else {
            toast.success("Document deleted")
        }
    }

    return (
        <ConfirmDialog
            title="Delete Document"
            description="Are you sure you want to permanently delete this document?"
            confirmText="Delete"
            variant="destructive"
            onConfirm={handleDelete}
            trigger={
                <button
                    className="p-1 text-text-muted hover:text-red-500 transition-colors disabled:opacity-50"
                    title="Delete Document"
                >
                    <span className="material-symbols-outlined text-[16px]">
                        delete
                    </span>
                </button>
            }
        />
    )
}
