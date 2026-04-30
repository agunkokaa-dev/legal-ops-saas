'use client'

import type { ReactNode } from 'react'
import { FileText, Loader2, PlayCircle, Upload } from 'lucide-react'

interface EmptyStateProps {
    onUpload?: () => void
    onLoadSample?: () => void
    onWatchDemo?: () => void
    isLoadingSample?: boolean
    isUploading?: boolean
}

export function EmptyState({
    onUpload,
    onLoadSample,
    onWatchDemo,
    isLoadingSample = false,
    isUploading = false,
}: EmptyStateProps) {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-12">
            <div className="relative mb-8">
                <div className="flex h-32 w-32 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/70">
                    <FileText size={48} className="text-zinc-700" strokeWidth={1.5} />
                </div>
                <div className="absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border border-[#3A3A3A] bg-[#1C1C1C]">
                    <span className="text-lg text-[#B8B8B8]">+</span>
                </div>
            </div>

            <h2 className="mb-2 font-display text-2xl font-light text-zinc-100">
                Brankas dokumen Anda kosong
            </h2>
            <p className="mb-10 max-w-md text-center text-sm leading-relaxed text-zinc-500">
                Upload kontrak pertama Anda, atau rasakan value clause.id dalam beberapa menit dengan sample contract yang sudah dianalisis.
            </p>

            <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-3">
                <ActionCard
                    icon={isUploading ? <Loader2 size={20} className="animate-spin text-[#B8B8B8]" /> : <Upload size={20} className="text-[#B8B8B8]" />}
                    title={isUploading ? 'Uploading...' : 'Upload Kontrak'}
                    description="Upload PDF kontrak yang sedang Anda kerjakan untuk analisis."
                    onClick={onUpload}
                    disabled={isUploading || isLoadingSample}
                />

                <ActionCard
                    recommended
                    icon={isLoadingSample ? <Loader2 size={20} className="animate-spin text-[#D4D4D4]" /> : <FileText size={20} className="text-[#D4D4D4]" />}
                    title={isLoadingSample ? 'Loading Samples...' : 'Coba Sample Contract'}
                    description="Jelajahi NDA, MSA, dan SOW Indonesia yang sudah punya review findings."
                    onClick={onLoadSample}
                    disabled={isLoadingSample || isUploading}
                />

                <ActionCard
                    icon={<PlayCircle size={20} className="text-[#B8B8B8]" />}
                    title="Tonton Demo"
                    description="Lihat workflow lengkap clause.id dalam 3 menit."
                    onClick={onWatchDemo}
                    disabled={isLoadingSample || isUploading}
                />
            </div>

            <div className="mt-12 w-full max-w-md border-t border-zinc-800/60 pt-6">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Setup Progress</span>
                    <span className="text-xs text-zinc-400">1 / 3 selesai</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-zinc-950">
                    <div className="h-full rounded-full bg-[#B8B8B8]" style={{ width: '33%' }} />
                </div>
                <div className="mt-3 flex flex-col gap-1.5 text-xs">
                    <div className="flex items-center gap-2 text-zinc-500">
                        <span className="text-[#B8B8B8]">✓</span> Buat akun
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400">
                        <span className="text-zinc-700">○</span> Upload kontrak pertama
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400">
                        <span className="text-zinc-700">○</span> Setup playbook
                    </div>
                </div>
            </div>
        </div>
    )
}

function ActionCard({
    icon,
    title,
    description,
    onClick,
    recommended = false,
    disabled = false,
}: {
    icon: ReactNode
    title: string
    description: string
    onClick?: () => void
    recommended?: boolean
    disabled?: boolean
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`group flex flex-col items-center rounded-xl p-6 text-center transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                recommended
                    ? 'border border-[#3A3A3A] bg-[#0F0F11] hover:bg-[#1C1C1C]'
                    : 'border border-zinc-800 bg-zinc-950/60 hover:border-[#3A3A3A] hover:bg-zinc-950'
            }`}
        >
            <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg border transition-colors ${
                recommended
                    ? 'border-[#3A3A3A] bg-[#222222]'
                    : 'border-[#3A3A3A] bg-[#1C1C1C] group-hover:bg-[#222222]'
            }`}>
                {icon}
            </div>
            <div className="mb-2 text-sm font-medium text-zinc-100">{title}</div>
            <div className="text-xs leading-relaxed text-zinc-500">{description}</div>
            {recommended && (
                <div className="mt-3 text-[10px] font-medium uppercase tracking-wider text-[#B8B8B8]">
                    Recommended
                </div>
            )}
        </button>
    )
}
