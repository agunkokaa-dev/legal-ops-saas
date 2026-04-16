'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs'
import { ListTodo } from 'lucide-react'

const navItems = [
    { href: '/dashboard', icon: 'dashboard', label: 'Dashboard', exact: true, type: 'material' },
    { href: '/dashboard/matters', icon: 'briefcase_meal', label: 'Matters', exact: false, type: 'material' },
    { href: '/dashboard/drafting', icon: 'edit_document', label: 'Drafting', exact: false, type: 'material' },
    { href: '/dashboard/tasks', icon: ListTodo, label: 'Task Management', exact: false, type: 'lucide' },
    { href: '/dashboard/documents', icon: 'description', label: 'Documents', exact: false, type: 'material' },
    { href: '/dashboard/calendar', icon: 'calendar_month', label: 'Calendar', exact: false, type: 'material' },
]

const secondaryItems = [
    { href: '/dashboard/analytics', icon: 'analytics', label: 'Analytics' },
    { href: '/dashboard/settings', icon: 'settings', label: 'Settings' },
]

export default function Sidebar() {
    const pathname = usePathname()
    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    const isActive = (href: string, exact: boolean = false) => {
        if (exact) return pathname === href
        return pathname.startsWith(href)
    }

    return (
        <nav className="w-20 lg:w-64 border-r border-surface-border bg-surface flex flex-col shrink-0 transition-all duration-300">
            <Link href="/dashboard" className="flex items-center px-4 pt-2 pb-1 border-b border-surface-border hover:opacity-80 transition-opacity whitespace-nowrap overflow-hidden">
                {/* Icon-only view on small sidebar, full logo on wide sidebar */}
                <div className="hidden lg:flex items-center w-full">
                    <Image
                        src="/logo-golden.png"
                        alt="Clause Logo"
                        width={200}
                        height={60}
                        className="w-44 object-contain"
                        priority
                    />
                </div>
                {/* Compact icon on small sidebar */}
                <div className="flex lg:hidden items-center w-full">
                    <Image
                        src="/logo-golden.png"
                        alt="Clause"
                        width={40}
                        height={40}
                        className="w-10 object-contain"
                        priority
                    />
                </div>
            </Link>
            <div className="flex-1 overflow-y-auto pt-0 pb-6 flex flex-col gap-2 px-3 mt-2">
                {navItems.map((item) => {
                    const active = isActive(item.href, item.exact)
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={
                                active
                                    ? 'flex items-center gap-3 px-3 py-2 rounded bg-primary/10 border border-primary/20 text-primary group'
                                    : 'flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5 text-text-muted hover:text-white transition-colors group'
                            }
                        >
                            {item.type === 'lucide' ? (
                                <item.icon className="w-5 h-5 mx-0.5" />
                            ) : (
                                <span className="material-symbols-outlined">{item.icon as string}</span>
                            )}
                            <span className="text-sm font-medium hidden lg:block">{item.label}</span>
                        </Link>
                    )
                })}
                <div className="my-2 border-t border-surface-border"></div>
                {secondaryItems.map((item) => {
                    const active = pathname.startsWith(item.href)
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={
                                active
                                    ? 'flex items-center gap-3 px-3 py-2 rounded bg-primary/10 border border-primary/20 text-primary group'
                                    : 'flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5 text-text-muted hover:text-white transition-colors group'
                            }
                        >
                            <span className="material-symbols-outlined">{item.icon}</span>
                            <span className="text-sm font-medium hidden lg:block">{item.label}</span>
                        </Link>
                    )
                })}
            </div>
            <div className="flex items-center gap-3 bg-white/5 p-2 rounded justify-between min-h-[44px]">
                {!isMounted ? (
                    <div className="w-full flex justify-between items-center">
                        <div className="h-8 w-24 bg-white/10 rounded animate-pulse"></div>
                        <div className="h-8 w-8 bg-white/10 rounded-full animate-pulse"></div>
                    </div>
                ) : (
                    <div className="w-full flex justify-between items-center gap-2">
                        <OrganizationSwitcher hidePersonal={true} />
                        <div>
                            <UserButton afterSignOutUrl="/" showName />
                        </div>
                    </div>
                )}
            </div>
        </nav>
    )
}
