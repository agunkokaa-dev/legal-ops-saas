"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAuth, useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import ArchivedContracts from "@/components/ArchivedContracts";
import {
    Search,
    Upload,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    FileText,
    ChevronsUp,
    ChevronsDown,
    Ban,
    Loader2,
    Lock,
    Zap,
} from "lucide-react";

// =====================================================================
// TYPES
// =====================================================================
interface Contract {
    id: string;
    title: string;
    file_name: string;
    counterparty_name: string | null;
    document_category: string | null;
    contract_value: number | null;
    currency: string | null;
    status: string | null;
    risk_level: string | null;
    created_at: string;
    end_date: string | null;
    matter_id: string | null;
}

// =====================================================================
// HELPER: Risk Badge Styling
// =====================================================================
function getRiskBadge(level: string | null | undefined) {
    const normalized = (level || "").toLowerCase().trim();

    switch (normalized) {
        case "high":
            return {
                dotColor: "bg-red-500",
                textColor: "text-red-400",
                bgColor: "bg-red-900/10",
                borderColor: "border-red-900/30",
                label: "HIGH",
            };
        case "medium":
            return {
                dotColor: "bg-yellow-500",
                textColor: "text-yellow-400",
                bgColor: "bg-yellow-900/10",
                borderColor: "border-yellow-900/30",
                label: "MEDIUM",
            };
        case "low":
        case "safe":
            return {
                dotColor: "bg-green-500",
                textColor: "text-green-400",
                bgColor: "bg-green-900/10",
                borderColor: "border-green-900/30",
                label: normalized === "safe" ? "SAFE" : "LOW",
            };
        default:
            return {
                dotColor: "bg-gray-500",
                textColor: "text-gray-400",
                bgColor: "bg-gray-800/20",
                borderColor: "border-gray-700/30",
                label: "N/A",
            };
    }
}

// =====================================================================
// HELPER: Status Badge
// =====================================================================
function getStatusBadge(status: string | null | undefined) {
    const normalized = (status || "").toLowerCase().trim();
    switch (normalized) {
        case "active":
            return "bg-primary/10 text-primary border-primary/20";
        case "executed":
            return "bg-gray-800 text-gray-300 border-gray-700";
        case "in review":
        case "in_review":
            return "bg-yellow-900/10 text-yellow-500 border-yellow-800/30";
        case "expired":
            return "bg-red-900/10 text-red-400 border-red-900/30";
        default:
            return "bg-gray-800 text-gray-400 border-gray-700";
    }
}

// =====================================================================
// HELPER: Currency Formatter
// =====================================================================
function formatCurrency(value: number | null | undefined, currency: string | null | undefined): string {
    const val = Number(value) || 0;
    if (val === 0) return "—";
    const curr = (currency || "IDR").toUpperCase();
    try {
        return new Intl.NumberFormat(curr === "IDR" ? "id-ID" : "en-US", {
            style: "currency",
            currency: curr,
            maximumFractionDigits: 0,
        }).format(val);
    } catch {
        return `${curr} ${val.toLocaleString()}`;
    }
}

// =====================================================================
// MAIN PAGE COMPONENT
// =====================================================================
export default function DocumentsPage() {
    const { userId, orgId } = useAuth();
    const { session } = useSession();
    const tenantId = orgId || userId;

    // State
    const [documents, setDocuments] = useState<Contract[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState("");
    const [filterRisk, setFilterRisk] = useState("");
    const [filterStatus, setFilterStatus] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [activeTab, setActiveTab] = useState("active");
    const ITEMS_PER_PAGE = 15;

    // =====================================================================
    // DATA FETCHING (WITH AGGRESSIVE CTO LOGGING)
    // =====================================================================
    useEffect(() => {
        console.log("📋 [VAULT] useEffect triggered. tenantId:", tenantId, "| session:", !!session);
        if (!tenantId || !session) {
            console.warn("⚠️ [VAULT] SKIPPING FETCH — tenantId or session is falsy. tenantId:", tenantId, "session:", !!session);
            return;
        }

        const fetchDocuments = async () => {
            try {
                setIsLoading(true);
                console.log("1️⃣ [VAULT] Starting fetch... Tenant ID:", tenantId);

                const supabaseAccessToken = await session.getToken({ template: "supabase" });
                console.log("2️⃣ [VAULT] Clerk Token Retrieved:", !!supabaseAccessToken, "| Token preview:", supabaseAccessToken?.substring(0, 30) + "...");

                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
                console.log("3️⃣ [VAULT] Supabase URL:", supabaseUrl, "| Anon Key exists:", !!supabaseAnonKey);

                if (!supabaseUrl || !supabaseAnonKey) {
                    console.error("🚨 [VAULT] CRITICAL: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY!");
                    setDocuments([]);
                    return;
                }

                const supabase = createClient(
                    supabaseUrl,
                    supabaseAnonKey,
                    { global: { headers: { Authorization: `Bearer ${supabaseAccessToken}` } } }
                );

                // Using select('*') temporarily to rule out column mismatch errors
                const { data, error } = await supabase
                    .from("contracts")
                    .select("*")
                    .eq("tenant_id", tenantId)
                    .neq("status", "ARCHIVED")
                    .order("created_at", { ascending: false });

                if (error) {
                    console.error("4️⃣ [VAULT] ❌ Supabase Fetch Error:", JSON.stringify(error, null, 2));
                    setDocuments([]);
                } else {
                    console.log("4️⃣ [VAULT] ✅ Supabase Data Retrieved! Count:", data?.length, "| First record:", data?.[0]);
                    setDocuments(data || []);
                }
            } catch (err: any) {
                console.error("🔥 [VAULT] Exception fetching documents:", err?.message || JSON.stringify(err, null, 2));
                setDocuments([]);
            } finally {
                setIsLoading(false);
                console.log("5️⃣ [VAULT] Fetch complete. isLoading set to false.");
            }
        };

        fetchDocuments();
    }, [tenantId, session]);

    // =====================================================================
    // FILTERING & SEARCH (Client-Side)
    // =====================================================================
    const filteredDocuments = useMemo(() => {
        let result = documents;

        // Text search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (doc) =>
                    (doc.title || "").toLowerCase().includes(q) ||
                    (doc.file_name || "").toLowerCase().includes(q) ||
                    (doc.counterparty_name || "").toLowerCase().includes(q) ||
                    (doc.document_category || "").toLowerCase().includes(q)
            );
        }

        // Filter by document type
        if (filterType) {
            result = result.filter((doc) => {
                const cat = (doc.document_category || "").toLowerCase();
                return cat.includes(filterType.toLowerCase());
            });
        }

        // Filter by risk level
        if (filterRisk) {
            result = result.filter(
                (doc) => (doc.risk_level || "").toLowerCase() === filterRisk.toLowerCase()
            );
        }

        // Filter by status
        if (filterStatus) {
            result = result.filter(
                (doc) => (doc.status || "").toLowerCase() === filterStatus.toLowerCase()
            );
        }

        return result;
    }, [documents, searchQuery, filterType, filterRisk, filterStatus]);

    // Pagination
    const totalPages = Math.ceil(filteredDocuments.length / ITEMS_PER_PAGE);
    const paginatedDocuments = filteredDocuments.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, filterType, filterRisk, filterStatus]);

    // Extract unique types for filter dropdown
    const uniqueTypes = useMemo(() => {
        const types = new Set<string>();
        documents.forEach((d) => {
            if (d.document_category) types.add(d.document_category);
        });
        return Array.from(types).sort();
    }, [documents]);

    // =====================================================================
    // RENDER
    // =====================================================================
    return (
        <>
            {/* ==================== HEADER ==================== */}
            <header
                className="border-b border-surface-border bg-background/80 backdrop-blur-md sticky top-0 z-50 px-8 py-6 shrink-0"
                data-purpose="primary-header"
            >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    {/* Brand & Title */}
                    <div className="flex flex-col">
                        <h1 className="text-3xl font-display tracking-tight text-white">
                            Global Intelligence Vault
                        </h1>
                        <p className="text-xs text-text-muted uppercase tracking-[0.2em] mt-1">
                            Enterprise Document Repository
                        </p>
                    </div>

                    {/* AI Search Bar */}
                    <div className="flex-grow max-w-2xl relative" data-purpose="search-container">
                        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                            <Zap className="w-4 h-4 text-primary opacity-60" />
                        </div>
                        <input
                            className="w-full bg-surface border border-surface-border rounded-lg py-3 pl-12 pr-4 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary placeholder-gray-600 transition-all shadow-[0_0_15px_rgba(212,175,53,0.05)]"
                            placeholder="Search contracts, clauses, or parties via Semantic AI..."
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            id="vault-search"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard"
                            className="bg-primary hover:bg-primary/80 text-background font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
                        >
                            <Upload className="w-4 h-4" />
                            + Secure Upload
                        </Link>
                    </div>
                </div>
            </header>

            {/* ==================== MAIN CONTENT ==================== */}
            <main className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
                {/* Navigation Tabs */}
                {/* Navigation Tabs */}
                <nav className="flex items-center border-b border-surface-border mb-8 relative z-10" data-purpose="vault-navigation">
                    <div className="flex gap-10">
                        <button
                            onClick={() => { console.log("Tab clicked: Active Contracts"); setActiveTab("active"); }}
                            className={`pb-4 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
                                activeTab === "active"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-gray-500 hover:text-gray-300"
                            }`}
                        >
                            Active Contracts
                        </button>
                        <button
                            onClick={() => { console.log("Tab clicked: Templates"); setActiveTab("templates"); }}
                            className={`pb-4 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
                                activeTab === "templates"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-gray-500 hover:text-gray-300"
                            }`}
                        >
                            Templates &amp; Playbooks
                        </button>
                        <button
                            onClick={() => { console.log("Tab clicked: Archived"); setActiveTab("archived"); }}
                            className={`pb-4 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
                                activeTab === "archived"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-gray-500 hover:text-gray-300"
                            }`}
                        >
                            Archived
                        </button>
                    </div>
                </nav>

                {/* ====== TAB: Active Contracts ====== */}
                {activeTab === "active" && (<>
                {/* Filter Section */}
                <section className="flex flex-wrap items-center gap-4 mb-6" data-purpose="table-filters">
                    {/* Filter by Type */}
                    <div className="relative group">
                        <select
                            className="appearance-none bg-surface border border-surface-border rounded-lg text-xs text-white px-4 py-2 pr-10 focus:ring-1 focus:ring-primary cursor-pointer hover:border-gray-600 transition-colors"
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            id="filter-type"
                        >
                            <option value="">Filter by Type</option>
                            {uniqueTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <ChevronDown className="w-3 h-3 text-gray-500" />
                        </span>
                    </div>

                    {/* Filter by Risk */}
                    <div className="relative">
                        <select
                            className="appearance-none bg-surface border border-surface-border rounded-lg text-xs text-white px-4 py-2 pr-10 focus:ring-1 focus:ring-primary cursor-pointer"
                            value={filterRisk}
                            onChange={(e) => setFilterRisk(e.target.value)}
                            id="filter-risk"
                        >
                            <option value="">Risk Level</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <ChevronDown className="w-3 h-3 text-gray-500" />
                        </span>
                    </div>

                    {/* Filter by Status */}
                    <div className="relative">
                        <select
                            className="appearance-none bg-surface border border-surface-border rounded-lg text-xs text-white px-4 py-2 pr-10 focus:ring-1 focus:ring-primary cursor-pointer"
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            id="filter-status"
                        >
                            <option value="">Status</option>
                            <option value="executed">Executed</option>
                            <option value="active">Active</option>
                            <option value="in_review">In Review</option>
                        </select>
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <ChevronDown className="w-3 h-3 text-gray-500" />
                        </span>
                    </div>

                    {/* Result Count */}
                    <div className="ml-auto text-xs text-gray-500 italic">
                        Showing {paginatedDocuments.length} of {filteredDocuments.length} Intelligence Nodes
                    </div>
                </section>

                {/* ==================== DATA TABLE ==================== */}
                <section
                    className="bg-surface border border-surface-border rounded-lg overflow-hidden"
                    data-purpose="document-table-container"
                >
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse" id="intelligence-vault-table">
                            <thead>
                                <tr className="bg-background border-b border-surface-border">
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                        Document Name
                                    </th>
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                        Counterparty
                                    </th>
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                        Type
                                    </th>
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                        Value
                                    </th>
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                        Status
                                    </th>
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                        Risk Level
                                    </th>
                                    <th className="px-6 py-4 text-[10px] font-semibold text-gray-500 uppercase tracking-widest text-center">
                                        Lineage
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-border">
                                {/* Loading State */}
                                {isLoading && (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center gap-4">
                                                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                                                <div>
                                                    <p className="text-sm text-white font-display">Decrypting Vault...</p>
                                                    <p className="text-xs text-gray-500 mt-1">Authenticating and loading intelligence nodes</p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                {/* Empty State */}
                                {!isLoading && filteredDocuments.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center gap-4">
                                                <div className="w-16 h-16 rounded-full bg-surface-border/50 flex items-center justify-center">
                                                    <Lock className="w-6 h-6 text-gray-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm text-white font-display">Empty Vault</p>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        {searchQuery || filterType || filterRisk || filterStatus
                                                            ? "No documents match your current filters. Try adjusting your search criteria."
                                                            : "No documents have been uploaded yet. Use 'Secure Upload' to add your first contract."}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                {/* Data Rows */}
                                {!isLoading &&
                                    paginatedDocuments.map((doc) => {
                                        const risk = getRiskBadge(doc.risk_level);
                                        const statusClass = getStatusBadge(doc.status);
                                        const displayTitle = doc.title || doc.file_name || "Untitled Document";

                                        return (
                                            <tr
                                                key={doc.id}
                                                className="hover:bg-white/[0.02] transition-colors group cursor-pointer"
                                            >
                                                {/* Document Name */}
                                                <td className="px-6 py-5">
                                                    <Link
                                                        href={`/dashboard/contracts/${doc.id}`}
                                                        className="flex items-center gap-3"
                                                    >
                                                        <FileText className="w-4 h-4 text-primary opacity-70 shrink-0" />
                                                        <span className="text-sm font-semibold text-gray-200 group-hover:text-primary transition-colors truncate max-w-[280px]">
                                                            {displayTitle}
                                                        </span>
                                                    </Link>
                                                </td>

                                                {/* Counterparty */}
                                                <td className="px-6 py-5 text-sm text-gray-400">
                                                    {doc.counterparty_name || "—"}
                                                </td>

                                                {/* Type */}
                                                <td className="px-6 py-5 text-sm text-gray-400">
                                                    {doc.document_category || "—"}
                                                </td>

                                                {/* Value */}
                                                <td className="px-6 py-5">
                                                    <span
                                                        className={`text-sm font-display tracking-wide ${doc.contract_value ? "text-primary" : "text-gray-600"
                                                            }`}
                                                    >
                                                        {formatCurrency(doc.contract_value, doc.currency)}
                                                    </span>
                                                </td>

                                                {/* Status */}
                                                <td className="px-6 py-5">
                                                    <span
                                                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium capitalize border ${statusClass}`}
                                                    >
                                                        {doc.status || "Unknown"}
                                                    </span>
                                                </td>

                                                {/* Risk Level */}
                                                <td className="px-6 py-5">
                                                    <div
                                                        className={`flex items-center gap-2 px-3 py-1 ${risk.bgColor} border ${risk.borderColor} rounded-full w-fit`}
                                                    >
                                                        <span className={`w-1.5 h-1.5 rounded-full ${risk.dotColor}`}></span>
                                                        <span
                                                            className={`text-[10px] font-bold ${risk.textColor} uppercase tracking-wider`}
                                                        >
                                                            {risk.label}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Lineage */}
                                                <td className="px-6 py-5 text-center">
                                                    <Link
                                                        href={`/dashboard/contracts/${doc.id}`}
                                                        className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-surface-border text-gray-500 hover:text-primary hover:border-primary transition-all"
                                                        title="View document lineage"
                                                    >
                                                        <ChevronsDown className="w-3 h-3" />
                                                    </Link>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>

                    {/* Table Footer / Pagination */}
                    <footer
                        className="bg-background px-6 py-4 flex items-center justify-between border-t border-surface-border"
                        data-purpose="table-pagination"
                    >
                        <span className="text-xs text-gray-500">
                            Viewing {filteredDocuments.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–
                            {Math.min(currentPage * ITEMS_PER_PAGE, filteredDocuments.length)} of{" "}
                            {filteredDocuments.length} entries
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage <= 1}
                                className="p-2 border border-surface-border rounded-lg text-gray-500 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            {totalPages > 1 && (
                                <span className="text-xs text-gray-500 px-2">
                                    {currentPage} / {totalPages}
                                </span>
                            )}
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage >= totalPages}
                                className="p-2 border border-surface-border rounded-lg text-gray-500 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </footer>
                </section>
                </>)}

                {/* ====== TAB: Archived ====== */}
                {activeTab === "archived" && <ArchivedContracts />}

                {/* ====== TAB: Templates & Playbooks ====== */}
                {activeTab === "templates" && (
                    <div className="flex items-center justify-center py-20">
                        <p className="text-gray-500 text-sm">Templates &amp; Playbooks — Coming Soon</p>
                    </div>
                )}
            </main>
        </>
    );
}
