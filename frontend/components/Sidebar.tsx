'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ClerkLoaded, ClerkLoading, OrganizationSwitcher, UserButton } from '@clerk/nextjs'
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
    const [collapsed, setCollapsed] = useState(false)

    useEffect(() => {
        const saved = window.localStorage.getItem('sidebar-collapsed')
        if (saved !== null) {
            setCollapsed(saved === 'true')
        }
    }, [])

    const isActive = (href: string, exact: boolean = false) => {
        if (exact) return pathname === href
        return pathname.startsWith(href)
    }

    const toggleCollapse = () => {
        setCollapsed((prev) => {
            const next = !prev
            window.localStorage.setItem('sidebar-collapsed', String(next))
            return next
        })
    }

    return (
        <nav
            className={`border-r border-surface-border bg-surface flex flex-col shrink-0 transition-all duration-300 ease-in-out ${collapsed ? 'w-[60px]' : 'w-[240px]'}`}
        >
            <button
                type="button"
                onClick={toggleCollapse}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={`flex min-h-[64px] items-center border-b border-surface-border transition-colors hover:bg-white/5 ${collapsed ? 'justify-center px-2' : 'px-4 py-3'}`}
            >
                {!collapsed ? (
                    <Image
                        src="/logo-clause.png"
                        alt="Clause Logo"
                        width={200}
                        height={64}
                        className="w-auto h-12 object-contain"
                        priority
                    />
                ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg hover:bg-white/5 transition-colors">
                        <Image src="/image_6.png.png" alt="Clause" width={48} height={48} className="object-contain opacity-90" />
                    </div>
                )}
            </button>
            <div className="flex-1 overflow-y-auto pt-0 pb-6 flex flex-col gap-2 px-3 mt-2">
                {navItems.map((item) => {
                    const active = isActive(item.href, item.exact)
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            title={collapsed ? item.label : undefined}
                            className={
                                active
                                    ? `relative flex items-center rounded border border-primary/20 bg-primary/10 text-primary group ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'}`
                                    : `relative flex items-center rounded text-text-muted transition-colors group hover:bg-white/5 hover:text-white ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'}`
                            }
                        >
                            {item.type === 'lucide' ? (
                                <item.icon className="w-5 h-5 mx-0.5" />
                            ) : (
                                <span className="material-symbols-outlined">{item.icon as string}</span>
                            )}
                            {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>}
                            {collapsed && (
                                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                    {item.label}
                                </span>
                            )}
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
                            title={collapsed ? item.label : undefined}
                            className={
                                active
                                    ? `relative flex items-center rounded border border-primary/20 bg-primary/10 text-primary group ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'}`
                                    : `relative flex items-center rounded text-text-muted transition-colors group hover:bg-white/5 hover:text-white ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'}`
                            }
                        >
                            <span className="material-symbols-outlined">{item.icon}</span>
                            {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>}
                            {collapsed && (
                                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                    {item.label}
                                </span>
                            )}
                        </Link>
                    )
                })}
            </div>
            <div className={`border-t border-surface-border p-2 ${collapsed ? 'flex justify-center' : ''}`}>
                <ClerkLoading>
                    {collapsed ? (
                        <div className="h-8 w-8 bg-white/10 rounded-full animate-pulse"></div>
                    ) : (
                        <div className="w-full flex justify-between items-center gap-2">
                            <div className="h-8 w-24 bg-white/10 rounded animate-pulse"></div>
                            <div className="h-8 w-8 bg-white/10 rounded-full animate-pulse"></div>
                        </div>
                    )}
                </ClerkLoading>
                <ClerkLoaded>
                    {collapsed ? (
                        <div className="flex justify-center">
                            <UserButton afterSignOutUrl="/" />
                        </div>
                    ) : (
                        <div className="w-full flex justify-between items-center gap-2 overflow-hidden">
                            <div className="min-w-0 overflow-hidden">
                                <OrganizationSwitcher hidePersonal={true} />
                            </div>
                            <div className="shrink-0">
                                <UserButton afterSignOutUrl="/" showName />
                            </div>
                        </div>
                    )}
                </ClerkLoaded>
            </div>
        </nav>
    )
}
