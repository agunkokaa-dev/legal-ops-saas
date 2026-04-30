'use client'

import { Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { clearSampleContracts } from '@/app/actions/onboarding'

export function SampleBanner({ onCleared }: { onCleared: () => void }) {
    const handleClear = async () => {
        if (!window.confirm('Hapus sample contracts dan mulai dengan data Anda sendiri?')) {
            return
        }

        const result = await clearSampleContracts()
        if (!result.success) {
            toast.error(result.error)
            return
        }

        toast.success('Sample contracts removed.')
        onCleared()
    }

    return (
        <div className="border-b border-[#3A3A3A]/70 bg-[#0B0B0C] px-8 py-3">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 rounded-lg border border-[#3A3A3A] bg-[#1C1C1C] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <Sparkles size={16} className="shrink-0 text-[#B8B8B8]" />
                    <div>
                        <div className="text-sm font-medium text-zinc-200">
                            Anda sedang mengeksplorasi dengan sample data
                        </div>
                        <div className="text-xs text-zinc-500">
                            Upload kontrak Anda sendiri untuk analisis nyata.
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleClear}
                    className="flex w-fit items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                    <X size={12} />
                    Reset dan Mulai Sendiri
                </button>
            </div>
        </div>
    )
}
