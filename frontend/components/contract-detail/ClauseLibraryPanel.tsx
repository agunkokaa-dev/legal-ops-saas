'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@clerk/nextjs'
import Link from 'next/link'
import { getPublicApiBase } from '@/lib/public-api-base'

// Assuming ClauseResponse type matches the backend Pydantic model
interface Clause {
    id: string;
    tenant_id: string;
    category: string;
    clause_type: string;
    title: string;
    content: string;
    guidance_notes?: string;
    created_at: string;
    updated_at: string;
}

export default function ClauseLibraryPanel({ onInsert }: { onInsert: (text: string) => void }) {
    const { getToken, orgId, userId } = useAuth();
    const [clauses, setClauses] = useState<Clause[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const fetchClauses = async () => {
            try {
                const token = await getToken();
                const apiUrl = getPublicApiBase();
                const res = await fetch(`${apiUrl}/api/v1/clauses`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "X-Tenant-Id": orgId || userId || "",
                        "Content-Type": "application/json"
                    }
                });
                
                if (res.ok) {
                    const data = await res.json();
                    setClauses(data);
                    
                    // Auto-open first few categories or all if there aren't many
                    const categories = Array.from(new Set(data.map((c: Clause) => c.category))) as string[];
                    const initOpenState: Record<string, boolean> = {};
                    categories.forEach(cat => initOpenState[cat] = true); // open all by default
                    setOpenCategories(initOpenState);
                } else {
                    console.error("Failed to fetch clauses", await res.text());
                }
            } catch (e) {
                console.error("Error fetching clause library", e);
            } finally {
                setIsLoading(false);
            }
        };
        fetchClauses();
    }, [getToken]);

    // Grouping & Filtering
    const categories = useMemo(() => {
        const filtered = clauses.filter(c => 
            c.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
            c.content.toLowerCase().includes(searchQuery.toLowerCase())
        );

        return filtered.reduce((acc, clause) => {
            if (!acc[clause.category]) acc[clause.category] = [];
            acc[clause.category].push(clause);
            return acc;
        }, {} as Record<string, Clause[]>);
    }, [clauses, searchQuery]);

    const toggleCategory = (cat: string) => {
        setOpenCategories(prev => ({
            ...prev,
            [cat]: !prev[cat]
        }));
    };

    return (
        <section className="w-80 h-full flex-shrink-0 bg-[#0f0f0f] border-r border-zinc-800/60 flex flex-col z-10 transition-all duration-300 relative">
            {/* Panel Header */}
            <header className="border-b border-zinc-800/60 p-5 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-white tracking-widest uppercase font-['Inter']">CLAUSE LIBRARY</h2>
                <span className="material-symbols-outlined text-zinc-500 text-sm">filter_list</span>
            </header>

            {/* Padded Container */}
            <div className="p-5 flex flex-col gap-6 overflow-y-auto flex-1">
                {/* Area A: Search Bar */}
                <div className="bg-[#141414] border border-zinc-700/60 rounded-xl p-3 flex items-center gap-2.5 shadow-inner">
                    <span className="material-symbols-outlined text-zinc-500 text-xl">search</span>
                    <input 
                        className="text-sm text-[#A1A1AA] bg-transparent border-none outline-none w-full focus:ring-0 placeholder:text-zinc-600 font-['Inter']" 
                        placeholder="Search for approved clauses..." 
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {/* Area B: Categories */}
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#B8B8B8] tracking-wider uppercase font-['Inter']">APPROVED CLAUSES</span>
                        <span className="text-[10px] text-zinc-500 font-['Inter']">{clauses.length} TOTAL</span>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center py-10">
                            <div className="w-5 h-5 border-2 border-[#B8B8B8] border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : clauses.length === 0 ? (
                        <div className="flex flex-col items-center justify-center mt-8 p-6 text-center border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
                            <div className="w-10 h-10 rounded-full bg-[#B8B8B8]/10 flex items-center justify-center mb-4">
                                <span className="material-symbols-outlined text-[#B8B8B8] text-xl">menu_book</span>
                            </div>
                            <h4 className="text-zinc-300 text-[11px] font-bold uppercase tracking-widest mb-2">
                                Library Empty
                            </h4>
                            <p className="text-[10px] text-zinc-500 mb-5 leading-relaxed">
                                No standard clauses found. Set up your corporate playbook to enable AI matching.
                            </p>
                            <Link 
                                href="/dashboard/settings/clause-library" 
                                className="text-[10px] text-[#B8B8B8] border border-[#B8B8B8]/30 hover:border-[#B8B8B8] hover:bg-[#B8B8B8]/10 px-5 py-2 rounded tracking-wider uppercase font-semibold transition-all"
                            >
                                Configure Settings
                            </Link>
                        </div>
                    ) : (
                        Object.entries(categories).map(([categoryName, items]) => (
                            <div key={categoryName} className="flex flex-col gap-1">
                                <button 
                                    onClick={() => toggleCategory(categoryName)}
                                    className={`flex items-center justify-between text-sm font-medium p-3 rounded-lg border transition-all font-['Inter'] ${
                                        openCategories[categoryName] 
                                            ? "text-white bg-[#141414] border-zinc-800/60 hover:border-zinc-700" 
                                            : "text-[#71717a] bg-transparent border-zinc-800/40 hover:bg-[#141414] hover:text-white"
                                    }`}
                                >
                                    <span className="uppercase">{categoryName}</span>
                                    <span className="material-symbols-outlined text-zinc-600 text-lg">
                                        {openCategories[categoryName] ? 'expand_more' : 'chevron_right'}
                                    </span>
                                </button>
                                
                                {openCategories[categoryName] && (
                                    <div className="p-2 flex flex-col gap-3">
                                        {items.map(clause => (
                                            <div key={clause.id} className="bg-[#0a0a0a] border border-zinc-800 rounded-lg p-3 hover:border-[#B8B8B8]/40 transition-all flex items-center justify-between group">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm text-white font-medium font-['Inter']">
                                                            {clause.title}
                                                        </span>
                                                        {clause.clause_type !== 'Standard' && (
                                                            <span className="text-[10px] text-[#B8B8B8] bg-[#B8B8B8]/15 rounded-md px-1.5 py-0.5 border border-[#B8B8B8]/30 font-medium font-['Inter']">
                                                                Fallback
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-[#71717a] mt-1 font-['Inter']">
                                                        {clause.guidance_notes || "Standard provision."}
                                                    </span>
                                                </div>
                                                <button 
                                                    onClick={() => onInsert(clause.content)}
                                                    className="text-[#B8B8B8] bg-[#B8B8B8]/10 rounded-full w-7 h-7 flex items-center justify-center border border-[#B8B8B8]/30 hover:bg-[#B8B8B8]/20 transition-colors flex-shrink-0 ml-3"
                                                    title="Insert Clause"
                                                >
                                                    <span className="material-symbols-outlined text-base">add</span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Bottom Metadata */}
            <div className="mt-auto p-5 border-t border-zinc-800/60 bg-[#0c0c0c]">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#B8B8B8]/10 flex items-center justify-center border border-[#B8B8B8]/20">
                        <span className="material-symbols-outlined text-[#B8B8B8] text-sm">auto_awesome</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] text-[#B8B8B8]/80 font-bold uppercase tracking-widest font-['Inter']">Library Pulse</span>
                        <span className="text-[11px] text-zinc-500 italic font-['Inter']">Library vectors mapped asynchronously.</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
