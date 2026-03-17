'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect, Suspense } from 'react'

function MattersToolbarContent() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    const [query, setQuery] = useState(searchParams.get('query') || '')

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            const params = new URLSearchParams(searchParams)
            if (query) {
                params.set('query', query)
            } else {
                params.delete('query')
            }
            router.replace(`${pathname}?${params.toString()}`, { scroll: false })
        }, 300)

        return () => clearTimeout(timeoutId)
    }, [query, searchParams, pathname, router])

    const handleFilter = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams)
        if (value) {
            params.set(key, value)
        } else {
            params.delete(key)
        }
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }

    return (
        <div className="px-4 py-4 border-b border-surface-border flex flex-col md:flex-row justify-between items-center gap-4 bg-background-dark/30">
            <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
                {/* Search Bar */}
                <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
                    <input
                        suppressHydrationWarning
                        type="text"
                        placeholder="Search ID, Client, or Keyword..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="bg-black/50 border border-surface-border rounded-md pl-9 pr-4 py-1.5 text-sm text-white focus:border-primary focus:outline-none w-64 transition-colors"
                    />
                </div>

                {/* Divider */}
                <div className="w-px h-6 bg-surface-border mx-1"></div>

                {/* Filters */}
                <select
                    suppressHydrationWarning
                    className="bg-transparent border border-surface-border rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-white focus:border-primary focus:outline-none appearance-none cursor-pointer"
                    onChange={(e) => handleFilter('client', e.target.value)}
                    value={searchParams.get('client') || ''}
                >
                    <option value="">All Clients</option>
                    <option value="Acme Corp">Acme Corp</option>
                    <option value="Wayne Enterprises">Wayne Enterprises</option>
                </select>
                <select
                    suppressHydrationWarning
                    className="bg-transparent border border-surface-border rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-white focus:border-primary focus:outline-none appearance-none cursor-pointer"
                    onChange={(e) => handleFilter('practice_area', e.target.value)}
                    value={searchParams.get('practice_area') || ''}
                >
                    <option value="">All Practice Areas</option>
                    <option value="Corporate">Corporate</option>
                    <option value="Litigation">Litigation</option>
                    <option value="Intellectual Property">Intellectual Property</option>
                    <option value="Real Estate">Real Estate</option>
                </select>
                <select
                    suppressHydrationWarning
                    className="bg-transparent border border-surface-border rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-white focus:border-primary focus:outline-none appearance-none cursor-pointer"
                    onChange={(e) => handleFilter('status', e.target.value)}
                    value={searchParams.get('status') || ''}
                >
                    <option value="">All Statuses</option>
                    <option value="Open">Open</option>
                    <option value="Closed">Closed</option>
                    <option value="Critical">Critical</option>
                </select>
                <select
                    suppressHydrationWarning
                    className="bg-transparent border border-surface-border rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-white focus:border-primary focus:outline-none appearance-none cursor-pointer"
                    onChange={(e) => handleFilter('lead_lawyer', e.target.value)}
                    value={searchParams.get('lead_lawyer') || ''}
                >
                    <option value="">All Lead Lawyers</option>
                    <option value="Harvey Specter">Harvey Specter</option>
                    <option value="Mike Ross">Mike Ross</option>
                </select>
            </div>
        </div>
    )
}

export default function MattersToolbar() {
    return (
        <Suspense fallback={<div className="h-16 border-b border-surface-border bg-background-dark/30"></div>}>
            <MattersToolbarContent />
        </Suspense>
    )
}
