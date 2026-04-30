'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useUser } from '@clerk/nextjs'
import { X } from 'lucide-react'

const ONBOARDING_KEY = 'clause:welcome_seen'

interface WelcomeModalProps {
    onStart: () => void
}

export function WelcomeModal({ onStart }: WelcomeModalProps) {
    const { user } = useUser()
    const [canShow, setCanShow] = useState(() => (
        typeof window !== 'undefined' && !window.localStorage.getItem(ONBOARDING_KEY)
    ))

    const handleSkip = () => {
        window.localStorage.setItem(ONBOARDING_KEY, 'skipped')
        setCanShow(false)
    }

    const handleStart = () => {
        window.localStorage.setItem(ONBOARDING_KEY, 'completed')
        setCanShow(false)
        onStart()
    }

    const isOpen = Boolean(user) && canShow
    if (!isOpen) return null

    const firstName = user?.firstName || 'Partner'

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
            <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
                <button
                    type="button"
                    onClick={handleSkip}
                    aria-label="Close welcome modal"
                    className="absolute right-4 top-4 text-zinc-500 transition-colors hover:text-zinc-300"
                >
                    <X size={20} />
                </button>

                <div className="px-8 pb-6 pt-10">
                    <div className="mb-3 text-[11px] uppercase tracking-widest text-zinc-500">
                        Selamat Datang di clause.id
                    </div>
                    <h1 className="mb-2 font-display text-3xl font-light text-white">
                        Halo, {firstName}.
                    </h1>
                    <p className="max-w-xl text-sm leading-relaxed text-zinc-400">
                        Mulai dengan platform contract intelligence yang dibangun khusus untuk workflow hukum Indonesia.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-5 border-t border-zinc-800/60 px-8 py-6 md:grid-cols-3">
                    <Benefit number="01" title="AI Analysis">
                        Review otomatis dengan referensi UU PDP dan praktik kontrak Indonesia.
                    </Benefit>
                    <Benefit number="02" title="Negotiation War Room">
                        Bandingkan versi kontrak dengan smart diff, BATNA, dan playbook.
                    </Benefit>
                    <Benefit number="03" title="Clause Assistant">
                        AI counsel dengan konteks dokumen, playbook, dan hukum nasional.
                    </Benefit>
                </div>

                <div className="flex flex-col gap-4 border-t border-zinc-800/60 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
                    <button
                        type="button"
                        onClick={handleSkip}
                        className="text-left text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                        Skip dan jelajahi sendiri
                    </button>
                    <button
                        type="button"
                        onClick={handleStart}
                        className="rounded-lg bg-[#B8B8B8] px-6 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-[#D4D4D4]"
                    >
                        Mulai dengan Sample Contract
                    </button>
                </div>
            </div>
        </div>
    )
}

function Benefit({
    number,
    title,
    children,
}: {
    number: string
    title: string
    children: ReactNode
}) {
    return (
        <div>
            <div className="mb-2 text-2xl font-light text-[#B8B8B8]">{number}</div>
            <div className="mb-1 text-sm font-medium text-zinc-200">{title}</div>
            <div className="text-xs leading-relaxed text-zinc-500">{children}</div>
        </div>
    )
}
