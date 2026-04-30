"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { BilingualClause, ClauseSyncResponse } from "@/types/bilingual";
import ClauseSyncIndicator from "./ClauseSyncIndicator";
import BilingualFindingsPanel from "./BilingualFindingsPanel";
import { toast } from "sonner";
import { getPublicApiBase } from "@/lib/public-api-base";

interface ConsistencyReport {
  findings: Array<{
    clause_id: string;
    id_clause_text: string;
    en_clause_text?: string;
    divergence_type: string;
    severity: "critical" | "warning" | "info";
    explanation: string;
    suggested_correction_language: "id" | "en" | "both";
  }>;
  overall_consistency_score: number;
  id_version_complete: boolean;
  en_version_complete: boolean;
  legally_compliant: boolean;
  compliance_notes: string;
}

interface BilingualEditorLayoutProps {
  contractId: string;
  initialClauses: BilingualClause[];
}

export default function BilingualEditorLayout({ contractId, initialClauses }: BilingualEditorLayoutProps) {
  const { getToken } = useAuth();
  const [clauses, setClauses] = useState<BilingualClause[]>(initialClauses);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncSuggestion, setSyncSuggestion] = useState<{
    clauseId: string;
    suggestion: ClauseSyncResponse;
    targetLang: 'id' | 'en';
  } | null>(null);
  const [consistencyReport, setConsistencyReport] = useState<ConsistencyReport | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showFindingsPanel, setShowFindingsPanel] = useState(false);

  // Debounce helper
  const timeoutRefs = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const handleTextChange = (clauseId: string, lang: 'id' | 'en', newText: string) => {
    // Optimistic update
    setClauses(prev => prev.map(c => {
      if (c.id === clauseId) {
        return {
          ...c,
          [lang === 'id' ? 'id_text' : 'en_text']: newText,
          sync_status: 'out_of_sync',
          edited_language: lang
        };
      }
      return c;
    }));

    // Clear existing timeout
    if (timeoutRefs.current[clauseId]) {
      clearTimeout(timeoutRefs.current[clauseId]);
    }

    // Set new timeout for debounced persistence
    timeoutRefs.current[clauseId] = setTimeout(() => {
      saveClauseUpdate(clauseId, lang, newText);
    }, 800);
  };

  const saveClauseUpdate = async (clauseId: string, lang: 'id' | 'en', text: string) => {
    if (clauseId.startsWith('temp-')) return;

    try {
      const token = await getToken();
      if (!token) return;

      const apiUrl = getPublicApiBase();
      const payload = lang === 'id' ? { id_text: text } : { en_text: text };

      const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/clause/${clauseId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.error("Failed to save clause");
        toast.error("Failed to save draft. Please check your connection.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred while saving the draft.");
    }
  };

  const pollTaskLog = useCallback(async (logId: string, timeoutMs = 90000) => {
    const startedAt = Date.now();
    const apiUrl = getPublicApiBase();

    while (Date.now() - startedAt < timeoutMs) {
      const token = await getToken();
      if (!token) throw new Error("Authentication expired");

      const res = await fetch(`${apiUrl}/api/v1/task-logs/${logId}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to poll task status");
      }

      const data = await res.json();
      const log = data.log;

      if (log?.status === "completed") {
        return log;
      }

      if (log?.status === "failed") {
        throw new Error(log?.error_message || "Background task failed");
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    throw new Error("Background task timed out");
  }, [getToken]);

  const handleSyncRequest = async (clause: BilingualClause) => {
    if (clause.id.startsWith('temp-')) return;
    
    setSyncingId(clause.id);
    setClauses(prev => prev.map(c => c.id === clause.id ? { ...c, sync_status: 'ai_pending' } : c));

    try {
      const token = await getToken();
      const apiUrl = getPublicApiBase();
      
      const sourceLanguage = clause.edited_language || 'id';
      const sourceText = sourceLanguage === 'id' ? clause.id_text : (clause.en_text || '');

      const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/sync-clause`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clause_id: clause.id,
          source_language: sourceLanguage,
          source_text: sourceText
        })
      });

      if (res.status === 202) {
        const queued = await res.json();
        if (!queued.log_id) {
          throw new Error("Missing task log id");
        }
        const log = await pollTaskLog(String(queued.log_id));
        const data = log.result_summary as ClauseSyncResponse;
        setSyncSuggestion({
          clauseId: clause.id,
          suggestion: data,
          targetLang: sourceLanguage === 'id' ? 'en' : 'id'
        });
      } else if (res.ok) {
        const data: ClauseSyncResponse = await res.json();
        setSyncSuggestion({
          clauseId: clause.id,
          suggestion: data,
          targetLang: sourceLanguage === 'id' ? 'en' : 'id'
        });
      } else {
        throw new Error("Sync request failed");
      }
    } catch (err) {
      console.error("Sync error:", err);
      toast.error("Auto-sync failed. Please try again later.");
      setClauses(prev => prev.map(c => c.id === clause.id ? { ...c, sync_status: 'out_of_sync' } : c));
    } finally {
      setSyncingId(null);
    }
  };

  const acceptSyncSuggestion = async () => {
    if (!syncSuggestion) return;
    const { clauseId, suggestion, targetLang } = syncSuggestion;

    setClauses(prev => prev.map(c => {
      if (c.id === clauseId) {
        return {
          ...c,
          [targetLang === 'id' ? 'id_text' : 'en_text']: suggestion.suggested_translation,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          edited_language: null
        };
      }
      return c;
    }));

    setSyncSuggestion(null);

    // Persist changes
    try {
      const token = await getToken();
      const apiUrl = getPublicApiBase();
      const payload = targetLang === 'id' ? { id_text: suggestion.suggested_translation } : { en_text: suggestion.suggested_translation };
      
      // Send both text payload to automatically upgrade state to synced on backend:
      const clause = clauses.find(c => c.id === clauseId);
      const fullPayload = {
        id_text: targetLang === 'id' ? suggestion.suggested_translation : clause?.id_text,
        en_text: targetLang === 'en' ? suggestion.suggested_translation : clause?.en_text
      };

      await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/clause/${clauseId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fullPayload)
      });
      toast.success("Clause synchronized successfully");
    } catch (err) {
      console.error("Failed to commit synced clause", err);
    }
  };

  const dismissSyncSuggestion = () => {
    if (!syncSuggestion) return;
    setClauses(prev => prev.map(c => c.id === syncSuggestion.clauseId ? { ...c, sync_status: 'out_of_sync' } : c));
    setSyncSuggestion(null);
  };

  const scrollToClause = (id: string) => {
    const el = document.getElementById(`clause-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleFinalize = async () => {
    if (isFinalizing) return;
    setIsFinalizing(true);
    try {
      const token = await getToken();
      const apiUrl = getPublicApiBase();
      const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/finalize`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success("Contract finalized and injected into version history!");
      } else {
        const err = await res.json();
        toast.error(err.detail || "Finalization failed.");
      }
    } catch {
      toast.error("Network error during finalization.");
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleValidate = async () => {
    if (isValidating) return;
    setIsValidating(true);
    setShowFindingsPanel(true);
    setConsistencyReport(null);
    try {
      const token = await getToken();
      const apiUrl = getPublicApiBase();
      const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/validate-consistency`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 202) {
        const queued = await res.json();
        if (!queued.log_id) {
          throw new Error("Missing task log id");
        }
        const log = await pollTaskLog(String(queued.log_id));
        setConsistencyReport((log.result_summary?.report || log.result_summary) as ConsistencyReport);
      } else if (res.ok) {
        const data = await res.json();
        setConsistencyReport(data.data);
      } else {
        toast.error("Consistency validation failed.");
        setShowFindingsPanel(false);
      }
    } catch {
      toast.error("Network error during validation.");
      setShowFindingsPanel(false);
    } finally {
      setIsValidating(false);
    }
  };

  const handleExportPDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const token = await getToken();
      const apiUrl = getPublicApiBase();
      const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/export-pdf`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bilingual-contract-${contractId}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success("PDF exported successfully!");
      } else {
        const err = await res.json();
        toast.error(err.detail || "PDF export failed.");
      }
    } catch {
      toast.error("Network error during PDF export.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-gray-200 font-sans">
      {/* Top Toolbar (Silent Luxury UI) */}
      <header className="flex items-center justify-between h-16 w-full px-6 bg-[#0a0a0a] border-b border-zinc-800/40 shrink-0">
        
        {/* 1. LEFT SIDE (Document Identity & Context) */}
        <div className="flex items-center gap-4">
          <div className="text-white text-lg font-medium leading-tight max-w-[500px] truncate" title="Master Service Agreement between PT Sawit Nusantara and PT Nusantara Investama...">
            Master Service Agreement between PT Sawit Nusantara and PT Nusantara Investama...
          </div>
          
          <div className="bg-zinc-950/20 border border-zinc-800/60 text-zinc-500 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded">
            PENDING REVIEW
          </div>
          
          <div className="text-zinc-400 border border-zinc-800 rounded px-2 py-0.5 text-xs hover:border-[#B8B8B8]/30 hover:text-white cursor-pointer transition flex items-center gap-1">
            ID / EN ▾
          </div>
        </div>

        {/* 2. RIGHT SIDE (Actions Stack) */}
        <div className="flex items-center gap-3">
          {/* Functional extension: Keeping the validate button using the new muted style */}
          <button
            onClick={handleValidate}
            disabled={isValidating || clauses.length === 0}
            className="text-zinc-400 border border-zinc-700/60 text-xs px-4 py-1.5 rounded-md hover:border-[#B8B8B8]/40 hover:text-white transition disabled:opacity-40"
          >
            {isValidating ? "Validating..." : "Validate Sync"}
          </button>

          {/* Secondary Action (Muted) Requested by Prompter */}
          <button
            onClick={handleExportPDF}
            disabled={isExporting || clauses.length === 0}
            className="text-zinc-400 border border-zinc-700/60 text-xs px-4 py-1.5 rounded-md hover:border-[#B8B8B8]/40 hover:text-white transition disabled:opacity-40"
          >
            Save Draft
          </button>

          {/* Vertical Separator */}
          <div className="w-px h-6 bg-zinc-800/60"></div>

          {/* Primary Action (Main CTA - Muted Gold) */}
          <button
            onClick={handleFinalize}
            disabled={isFinalizing || clauses.length === 0}
            className="bg-[#B8B8B8] text-[#0A0A0A] text-xs font-bold px-4 py-1.5 rounded-md hover:bg-[#B8B8B8]/90 transition disabled:opacity-40 disabled:hover:bg-[#D4D4D4]"
          >
            {isFinalizing ? "Generating..." : "Generate Final"}
          </button>
        </div>
      </header>

      {/* Body: Sidebar + Main */}
      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r border-gray-800 flex flex-col bg-[#111111] shrink-0">
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Clauses</h2>
        </div>
        <div className="overflow-y-auto flex-1 p-2 space-y-1">
          {clauses.map(c => (
            <button
              key={c.id}
              onClick={() => scrollToClause(c.id)}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded transition-colors flex justify-between items-center"
            >
              <span className="truncate">Clause {c.clause_number}</span>
              {c.sync_status !== 'synced' && (
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-800">
          <button 
            onClick={async () => {
              try {
                const token = await getToken();
                const apiUrl = getPublicApiBase();
                const clauseNumber = `${clauses.length + 1}.0`;
                
                const res = await fetch(`${apiUrl}/api/v1/bilingual/${contractId}/clauses`, {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({ clause_number: clauseNumber })
                });

                if (res.ok) {
                  const data = await res.json();
                  const newClause = data.data;
                  setClauses(prev => [...prev, newClause]);
                  setTimeout(() => scrollToClause(newClause.id), 100);
                } else {
                  toast.error("Failed to create new clause on server");
                }
              } catch (err) {
                console.error("New clause creation error:", err);
                const newId = `temp-${Date.now()}`;
                setClauses(prev => [...prev, {
                  id: newId,
                  contract_id: contractId,
                  clause_number: `${prev.length + 1}.0`,
                  id_text: "",
                  en_text: "",
                  sync_status: 'synced',
                  last_synced_at: null,
                  edited_language: null
                }]);
                setTimeout(() => scrollToClause(newId), 100);
              }
            }}
            className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition font-medium"
          >
             + New Clause
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-7xl mx-auto space-y-12">
          {clauses.map((clause) => (
            <div key={clause.id} id={`clause-${clause.id}`} className="space-y-4 relative">
              
              {/* Toolbar */}
              <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                <h3 className="text-lg font-medium text-gray-100 px-1 py-1 rounded bg-gray-800/50 inline-block border border-gray-700">
                  {clause.clause_number}
                </h3>
                <ClauseSyncIndicator
                  status={clause.sync_status}
                  lastSyncedAt={clause.last_synced_at}
                  isLoading={syncingId === clause.id}
                  onSyncRequest={() => handleSyncRequest(clause)}
                />
              </div>

              {/* Side-by-side editing panes */}
              <div className="flex flex-col lg:flex-row gap-6">
                
                {/* Indonesian Pane (Primary) */}
                <div className="flex-1 flex flex-col space-y-2">
                  <div className="text-sm font-medium text-[#B8B8B8]">Bahasa Indonesia — Versi Primer (Mengikat)</div>
                  <textarea
                    className="w-full h-64 bg-gray-900 border border-[#B8B8B8]/40 rounded-md p-4 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#B8B8B8] focus:ring-1 focus:ring-[#B8B8B8]/50 transition-all resize-y"
                    value={clause.id_text}
                    onChange={(e) => handleTextChange(clause.id, 'id', e.target.value)}
                    placeholder="Masukkan redaksi pasal dalam Bahasa Indonesia..."
                  />
                  
                  {syncSuggestion && syncSuggestion.clauseId === clause.id && syncSuggestion.targetLang === 'id' && (
                    <div className="bg-[#111111] border border-[#3A3A3A] rounded-md p-4 mt-4 shadow-xl">
                      <div className="text-sm font-semibold text-[#B8B8B8] mb-2">AI Suggested Translation</div>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900 p-3 rounded mb-3 border border-gray-800">
                        {syncSuggestion.suggestion.suggested_translation}
                      </div>
                      <div className="text-xs text-gray-500 mb-3 italic">
                        {syncSuggestion.suggestion.legal_notes}
                      </div>
                      <div className="flex space-x-3">
                        <button onClick={acceptSyncSuggestion} className="px-4 py-1.5 bg-[#B8B8B8] hover:bg-[#D4D4D4] text-[#0A0A0A] text-sm rounded shadow-sm transition">Accept Translation</button>
                        <button onClick={dismissSyncSuggestion} className="px-4 py-1.5 bg-transparent border border-gray-600 hover:bg-gray-800 text-gray-300 text-sm rounded transition">Dismiss</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* English Pane (Secondary) */}
                <div className="flex-1 flex flex-col space-y-2">
                  <div className="text-sm font-medium text-slate-400">English — Secondary Version (Reference)</div>
                  <textarea
                    className="w-full h-64 bg-gray-900 border border-slate-700/50 rounded-md p-4 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500/50 transition-all resize-y"
                    value={clause.en_text || ''}
                    onChange={(e) => handleTextChange(clause.id, 'en', e.target.value)}
                    placeholder="English translation not yet added"
                  />

                  {syncSuggestion && syncSuggestion.clauseId === clause.id && syncSuggestion.targetLang === 'en' && (
                    <div className="bg-[#111111] border border-[#3A3A3A] rounded-md p-4 mt-4 shadow-xl">
                      <div className="text-sm font-semibold text-[#B8B8B8] mb-2">AI Suggested Translation</div>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900 p-3 rounded mb-3 border border-gray-800">
                        {syncSuggestion.suggestion.suggested_translation}
                      </div>
                      <div className="text-xs text-gray-500 mb-3 italic">
                        {syncSuggestion.suggestion.legal_notes}
                      </div>
                      <div className="flex space-x-3">
                        <button onClick={acceptSyncSuggestion} className="px-4 py-1.5 bg-[#B8B8B8] hover:bg-[#D4D4D4] text-[#0A0A0A] text-sm rounded shadow-sm transition">Accept Translation</button>
                        <button onClick={dismissSyncSuggestion} className="px-4 py-1.5 bg-transparent border border-gray-600 hover:bg-gray-800 text-gray-300 text-sm rounded transition">Dismiss</button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          ))}

          {clauses.length === 0 && (
            <div className="text-center text-gray-500 py-20 bg-gray-900 rounded-lg border border-gray-800 border-dashed">
              No bilingual clauses have been created for this document yet.
            </div>
          )}

        </div>
      </div>
      </div>{/* End body flex row */}

      {/* Findings Panel Overlay */}
      {showFindingsPanel && (
        <BilingualFindingsPanel
          report={consistencyReport}
          isLoading={isValidating}
          onClose={() => setShowFindingsPanel(false)}
          onFocusClause={scrollToClause}
        />
      )}
    </div>
  );
}
