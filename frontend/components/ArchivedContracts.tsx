"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { getPublicApiBase } from "@/lib/public-api-base";

// =====================================================================
// TYPES
// =====================================================================
interface Contract {
    id: string;
    title: string;
    file_name?: string;
    counterparty_name?: string | null;
    status?: string | null;
    archive_reason?: string | null;
    created_at?: string | null;
    archived_at?: string | null;
}

// =====================================================================
// HELPERS
// =====================================================================
function getReasonBadge(reason: string | null | undefined) {
    const normalized = (reason || "").toLowerCase().trim();
    if (normalized.includes("terminat")) {
        return "px-2.5 py-1 bg-[#2a0000]/20 border border-red-900/30 text-[9px] uppercase text-red-400/50 tracking-widest";
    }
    return "px-2.5 py-1 bg-[#131313] border border-[#4d4635]/20 text-[9px] uppercase text-on-surface-variant/60 tracking-widest";
}

function formatArchiveDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
        return dateStr;
    }
}

function getDocIcon(fileName: string | undefined): string {
    if (!fileName) return "description";
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "picture_as_pdf";
    return "description";
}



// =====================================================================
// COMPONENT
// =====================================================================
export default function ArchivedContracts() {
    const { getToken } = useAuth();
    const [activeTab, setActiveTab] = useState("Archived");
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Archive Modal State
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [selectedContractId, setSelectedContractId] = useState<string>("");
    const [archiveReason, setArchiveReason] = useState("Expired");
    const [isArchiving, setIsArchiving] = useState(false);

    // =====================================================================
    // TASK 1: DYNAMIC GET FETCHING
    // =====================================================================
    useEffect(() => {
        const fetchContracts = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const token = await getToken();
                const apiUrl = getPublicApiBase();
                const res = await fetch(
                    `${apiUrl}/api/contracts?tab=${encodeURIComponent(activeTab)}`,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                    }
                );

                if (!res.ok) {
                    let backendError = `HTTP ${res.status}`;
                    try {
                        const errorJson = await res.json();
                        backendError = errorJson.detail || backendError;
                    } catch (e) {}
                    console.error("API Fetch Error:", backendError);
                    setError(`Gagal memuat data: ${backendError}`);
                    setContracts([]);
                    return;
                }

                const result = await res.json();
                setContracts(result.data || []);
            } catch (err: any) {
                console.error("API Fetch Error:", err);
                setError(err?.message || String(err));
                setContracts([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchContracts();
    }, [activeTab]);

    // =====================================================================
    // TASK 3: PATCH ACTION (OPTIMISTIC UI)
    // =====================================================================
    const executeArchive = useCallback(async () => {
        if (!selectedContractId) return;
        setIsArchiving(true);
        try {
            const token = await getToken();
            const apiUrl = getPublicApiBase();
            const res = await fetch(
                `${apiUrl}/api/${selectedContractId}/archive`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ archive_reason: archiveReason }),
                }
            );

            if (res.ok) {
                // Optimistic update: remove the archived contract from the current view
                setContracts((prev) => prev.filter((c) => c.id !== selectedContractId));
                setIsArchiveModalOpen(false);
                setSelectedContractId("");
                setArchiveReason("Expired");
            } else {
                const errorText = `Archive failed — HTTP ${res.status}`;
                console.error("[VAULT]", errorText);
                setError(errorText);
            }
        } catch (err: any) {
            const errorText = err?.message || String(err);
            console.error("[VAULT] Archive exception:", errorText);
            setError(errorText);
        } finally {
            setIsArchiving(false);
        }
    }, [selectedContractId, archiveReason]);

    // Handler to open archive modal
    const openArchiveModal = (contractId: string) => {
        setSelectedContractId(contractId);
        setArchiveReason("Expired");
        setIsArchiveModalOpen(true);
    };

    return (
        <>
            <div className="p-12 max-w-7xl mx-auto">

                {/* Filters & Status */}
                <section className="flex flex-wrap items-center justify-between mb-8 gap-4">
                    <div className="flex items-center space-x-6">
                        <div className="relative group">
                            <select className="appearance-none bg-[#151515] border border-[#4d4635]/20 text-on-surface-variant text-[10px] uppercase tracking-widest py-2.5 px-4 pr-10 focus:outline-none focus:border-primary/50 transition-colors cursor-pointer min-w-[180px] rounded-sm">
                                <option>Filter by Reason</option>
                                <option>Expired</option>
                                <option>Terminated</option>
                                <option>Superseded</option>
                            </select>
                            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[16px] text-primary/60 pointer-events-none">
                                expand_more
                            </span>
                        </div>
                        <div className="relative group">
                            <select className="appearance-none bg-[#151515] border border-[#4d4635]/20 text-on-surface-variant text-[10px] uppercase tracking-widest py-2.5 px-4 pr-10 focus:outline-none focus:border-primary/50 transition-colors cursor-pointer min-w-[140px] rounded-sm">
                                <option>Archived Year</option>
                                <option>2024</option>
                                <option>2025</option>
                                <option>2026</option>
                            </select>
                            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[16px] text-primary/60 pointer-events-none">
                                calendar_today
                            </span>
                        </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/40 font-medium">
                        Vault Synchronized: Today 14:32 GMT
                    </div>
                </section>

                {/* Table */}
                <div className="bg-[#050505] border border-[#4d4635]/10 shadow-2xl">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-[#0e0e0e]/50 border-b border-[#4d4635]/10">
                                <th className="py-5 px-8 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/50 font-semibold">
                                    Document Name
                                </th>
                                <th className="py-5 px-8 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/50 font-semibold">
                                    Counterparty
                                </th>
                                <th className="py-5 px-8 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/50 font-semibold">
                                    Archived Date
                                </th>
                                <th className="py-5 px-8 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/50 font-semibold">
                                    Reason
                                </th>
                                <th className="py-5 px-8 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/50 font-semibold text-right">
                                    Action
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#4d4635]/10">
                            {/* Loading State */}
                            {isLoading && (
                                <tr>
                                    <td colSpan={5} className="py-16 px-8 text-center">
                                        <span className="text-[11px] uppercase tracking-[0.2em] text-on-surface-variant/30 animate-pulse">
                                            Synchronizing vault data...
                                        </span>
                                    </td>
                                </tr>
                            )}

                            {/* Error State */}
                            {!isLoading && error && (
                                <tr>
                                    <td colSpan={5} className="py-16 px-8 text-center bg-red-900/10">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <span className="material-symbols-outlined text-red-500">error</span>
                                            <span className="text-[11px] uppercase tracking-[0.2em] text-red-400">
                                                {error}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            )}

                            {/* Empty State */}
                            {!isLoading && !error && contracts.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-16 px-8 text-center">
                                        <span className="text-[11px] uppercase tracking-[0.2em] text-on-surface-variant/30">
                                            Tidak ada dokumen di kategori ini.
                                        </span>
                                    </td>
                                </tr>
                            )}

                            {/* Dynamic Data Rows */}
                            {!isLoading &&
                                contracts.map((contract) => {
                                    const reason = contract.archive_reason || contract.status || "Unknown";
                                    const displayDate = contract.archived_at || contract.created_at;

                                    return (
                                        <tr
                                            key={contract.id}
                                            className="group hover:bg-[#131313]/30 transition-colors duration-300"
                                        >
                                            <td className="py-6 px-8">
                                                <div className="flex items-center space-x-4">
                                                    <span className="material-symbols-outlined text-[#4d4635] group-hover:text-primary transition-colors">
                                                        {getDocIcon(contract.file_name)}
                                                    </span>
                                                    <span className="text-sm font-light text-on-surface tracking-wide">
                                                        {contract.title || contract.file_name || "Untitled Document"}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-6 px-8 text-sm text-on-surface-variant/70">
                                                {contract.counterparty_name || "Unknown Entity"}
                                            </td>
                                            <td className="py-6 px-8 text-sm italic font-light text-on-surface-variant/50">
                                                {formatArchiveDate(displayDate)}
                                            </td>
                                            <td className="py-6 px-8">
                                                <span className={getReasonBadge(reason)}>
                                                    {reason}
                                                </span>
                                            </td>

                                            {/* TASK 4: CONDITIONAL ACTION COLUMN */}
                                            <td className="py-6 px-8 text-right">
                                                <div className="flex items-center justify-end space-x-5">
                                                    <button
                                                        className="material-symbols-outlined text-on-surface-variant/30 hover:text-primary transition-colors"
                                                        title="View"
                                                    >
                                                        visibility
                                                    </button>
                                                    <button
                                                        className="material-symbols-outlined text-on-surface-variant/30 hover:text-primary transition-colors"
                                                        title="Download"
                                                    >
                                                        download
                                                    </button>

                                                    {/* Active tab: Show Archive action */}
                                                    {activeTab === "active" && (
                                                        <button
                                                            onClick={() => openArchiveModal(contract.id)}
                                                            className="material-symbols-outlined text-on-surface-variant/30 hover:text-red-400 transition-colors"
                                                            title="Archive"
                                                        >
                                                            archive
                                                        </button>
                                                    )}

                                                    {/* Archived tab: Show read-only reason badge */}
                                                    {activeTab === "archived" && contract.archive_reason && (
                                                        <span className={getReasonBadge(contract.archive_reason)}>
                                                            {contract.archive_reason}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    <div className="px-8 py-5 flex items-center justify-between bg-[#0e0e0e]/30 border-t border-[#4d4635]/10">
                        <span className="text-[10px] text-on-surface-variant/30 uppercase tracking-[0.15em]">
                            Showing {contracts.length > 0 ? 1 : 0}-{contracts.length} of {contracts.length} Records
                        </span>
                        <div className="flex items-center space-x-6">
                            <button className="text-on-surface-variant/30 hover:text-primary transition-colors">
                                <span className="material-symbols-outlined">chevron_left</span>
                            </button>
                            <span className="text-[11px] text-on-surface-variant/60 font-medium tracking-widest">
                                {contracts.length > 0 ? "1 / 1" : "0 / 0"}
                            </span>
                            <button className="text-on-surface-variant/30 hover:text-primary transition-colors">
                                <span className="material-symbols-outlined">chevron_right</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Metrics */}
                <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="p-8 bg-[#0e0e0e] border border-primary/5 relative overflow-hidden">
                        <div className="relative z-10">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-on-surface-variant/30 mb-2">
                                Retention Health
                            </p>
                            <h3 className="serif-headline text-3xl text-on-surface">98.2%</h3>
                            <div className="mt-6 h-[2px] w-full bg-[#131313]">
                                <div className="h-full bg-primary w-[98.2%]"></div>
                            </div>
                        </div>
                    </div>
                    <div className="p-8 bg-[#0e0e0e] border border-primary/5 relative overflow-hidden">
                        <div className="relative z-10">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-on-surface-variant/30 mb-2">
                                Legacy Liability
                            </p>
                            <h3 className="serif-headline text-3xl text-on-surface">$2.4M</h3>
                            <p className="text-[10px] text-red-400/40 mt-3 italic tracking-wide">
                                Potential exposure in archived SOWs
                            </p>
                        </div>
                    </div>
                    <div className="p-8 bg-[#0e0e0e] border border-primary/5 relative overflow-hidden">
                        <div className="relative z-10">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-on-surface-variant/30 mb-2">
                                Purge Schedule
                            </p>
                            <h3 className="serif-headline text-3xl text-on-surface">Q4 2026</h3>
                            <p className="text-[10px] text-primary/40 mt-3 italic tracking-wide">
                                Next scheduled automated cleanup
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            {/* ================================================================= */}
            {/* TASK 2: ARCHIVE CONFIRMATION MODAL                                */}
            {/* ================================================================= */}
            {isArchiveModalOpen && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-[#0A0A0A] border border-[#4d4635]/30 shadow-2xl w-full max-w-md p-8 rounded-sm relative">

                        {/* Close Button */}
                        <button
                            onClick={() => { setIsArchiveModalOpen(false); setSelectedContractId(""); }}
                            className="absolute top-4 right-4 material-symbols-outlined text-on-surface-variant/30 hover:text-on-surface transition-colors"
                        >
                            close
                        </button>

                        {/* Title */}
                        <h2 className="serif-headline text-xl text-primary uppercase tracking-wider mb-2">
                            Confirm Archive
                        </h2>

                        {/* Warning */}
                        <p className="text-on-surface-variant/50 text-xs leading-relaxed mb-6">
                            This document will be moved to the Vault and become{" "}
                            <span className="text-red-400 font-semibold">Read-Only</span>.
                            This action can only be reversed by a system administrator.
                        </p>

                        {/* Reason Selector */}
                        <label className="block mb-2 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/40">
                            Archive Reason
                        </label>
                        <div className="relative mb-8">
                            <select
                                value={archiveReason}
                                onChange={(e) => setArchiveReason(e.target.value)}
                                className="w-full appearance-none bg-[#151515] border border-[#4d4635]/30 text-on-surface-variant text-xs uppercase tracking-widest py-3 px-4 pr-10 focus:outline-none focus:border-primary/50 transition-colors cursor-pointer rounded-sm"
                            >
                                <option value="Expired">Expired</option>
                                <option value="Terminated">Terminated</option>
                                <option value="Superseded">Superseded</option>
                            </select>
                            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[16px] text-primary/60 pointer-events-none">
                                expand_more
                            </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-4">
                            <button
                                onClick={() => { setIsArchiveModalOpen(false); setSelectedContractId(""); }}
                                className="px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/50 border border-[#4d4635]/20 hover:border-on-surface-variant/40 transition-colors rounded-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeArchive}
                                disabled={isArchiving}
                                className="px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] bg-primary text-[#0A0A0A] font-semibold hover:bg-primary/80 transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isArchiving ? "Archiving..." : "Confirm Archive"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
