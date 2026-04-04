"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { LuxuryThinkingStepper } from '@/components/ui/LuxuryThinkingStepper';
import ClauseLibraryPanel from "../contract-detail/ClauseLibraryPanel";
import HistoryPanel from "./HistoryPanel";
import { toast, Toaster } from 'sonner';
import type { RevisionSnapshot, DraftRevisionsPayload } from '@/types/history';

interface NegotiationIssue {
  id: string;
  deviation_id: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  v1_text?: string;
  v2_text?: string;
  batna?: {
    fallback_clause: string;
    reasoning: string;
    leverage_points?: string[];
  };
}

interface SmartComposerProps {
  matterId: string;
  taskTitle: string;
  initialCounterparty?: string;
  mode?: string;
  contractId?: string;
  focusFindingId?: string;
  draftId?: string;
  onClose: () => void;
}

export default function SmartComposer({
  matterId,
  taskTitle,
  initialCounterparty = "",
  mode,
  contractId,
  focusFindingId,
  draftId,
  onClose,
}: SmartComposerProps) {
  const { getToken } = useAuth();
  const [templateName, setTemplateName] = useState("Mutual NDA");
  const [governingLaw, setGoverningLaw] = useState("State of Delaware");
  const [draftText, setDraftText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant", content: string, suggestion?: string | null }[]>([
    { role: "assistant", content: "I am your Clause Assistant. How can I help you refine this draft today?", suggestion: null }
  ]);
  const [isChatting, setIsChatting] = useState(false);
  const [currentContractId, setCurrentContractId] = useState<string | null>(null);
  const [playbookCategories, setPlaybookCategories] = useState<string[]>([]);
  const [selectedPlaybook, setSelectedPlaybook] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'docs' | 'library' | 'history' | 'warroom'>(mode === 'warroom' ? 'warroom' : 'docs');
  const [negotiationIssues, setNegotiationIssues] = useState<NegotiationIssue[]>([]);
  const [textSelection, setTextSelection] = useState<{ text: string; x: number; y: number; start: number; end: number } | null>(null);
  const [activeRange, setActiveRange] = useState<{ start: number; end: number } | null>(null);
  const [rewriteMode, setRewriteMode] = useState(false);
  const [rewriteInput, setRewriteInput] = useState("");
  const [totalApprovedClauses, setTotalApprovedClauses] = useState(0);
  const [revisionHistory, setRevisionHistory] = useState<RevisionSnapshot[]>([]);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const router = useRouter();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const draftingSteps = [
    "Reading current draft...",
    "Analyzing legal context...",
    "Cross-referencing Playbook...",
    "Drafting clause suggestions..."
  ];

  React.useEffect(() => {
    const loadExistingDraft = async () => {
      try {
        const token = await getToken();
        const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, "");
        
        if (mode === 'warroom' && contractId) {
          // ── War Room → Composer Bridge ──
          // 1. Fetch the V3 draft text from contract_versions
          if (draftId) {
            const vRes = await fetch(`${baseUrl}/api/v1/negotiation/${contractId}/versions`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (vRes.ok) {
              const vData = await vRes.json();
              const targetVersion = (vData.versions || []).find((v: any) => v.id === draftId);
              if (targetVersion?.raw_text) {
                setDraftText(targetVersion.raw_text);
              } else {
                // Fallback: use the latest version's text
                const latest = (vData.versions || []).slice(-1)[0];
                if (latest?.raw_text) setDraftText(latest.raw_text);
              }
            }
          }
          setCurrentContractId(contractId);

          // 2. Fetch negotiation issues with BATNA context
          try {
            const issuesRes = await fetch(`${baseUrl}/api/v1/negotiation/${contractId}/issues`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (issuesRes.ok) {
              const issuesData = await issuesRes.json();
              setNegotiationIssues(issuesData.issues || []);

              // 3. Populate chat history with BATNA context summary
              const openIssues = (issuesData.issues || []).filter((i: any) => i.status === 'open' || i.status === 'under_review');
              if (openIssues.length > 0) {
                setChatHistory([
                  {
                    role: 'assistant',
                    content: `📋 **War Room Context Loaded**\n\nYou have **${openIssues.length}** active deviations from the negotiation round. Check the War Room tab in the sidebar to view BATNA strategies and apply suggested clauses.`,
                    suggestion: null
                  }
                ]);
              }
            }
          } catch (issueErr) {
            console.error('[Composer] Failed to fetch negotiation issues:', issueErr);
          }

        } else if (mode === 'review' && contractId) {
          // Special Review-to-Draft flow: fetch from the review endpoint
          const res = await fetch(`${baseUrl}/api/v1/review/${contractId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.review) {
              setDraftText(data.review.raw_document);
              setCurrentContractId(contractId);
              
              if (focusFindingId) {
                const target = data.review.findings.find((f: any) => f.finding_id === focusFindingId);
                if (target) {
                  // Inject suggestion into chat history
                  setChatHistory([
                    {
                      role: 'assistant',
                      content: `Revising: **${target.title}**\n\n${target.description}`,
                      suggestion: target.suggested_revision || null
                    }
                  ]);
                  // Scroll document and set active range
                  setTimeout(() => {
                    const start = target.coordinates?.start_char;
                    const end = target.coordinates?.end_char;
                    if (start >= 0 && end > start && textareaRef.current) {
                      textareaRef.current.focus();
                      textareaRef.current.setSelectionRange(start, end);
                      setActiveRange({ start, end });
                      // Simple text selection simulation
                      setTextSelection({
                         text: data.review.raw_document.substring(start, end),
                         x: window.innerWidth / 2,
                         y: window.innerHeight / 2,
                         start,
                         end
                      });
                    }
                  }, 500);
                }
              }
            }
          }
        } else {
          // Standard drafting flow
          const res = await fetch(`${baseUrl}/api/v1/drafting/load/${matterId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.found) {
              setDraftText(data.draft_text);
              setCurrentContractId(data.contract_id);

              // Parse history from the full draft_revisions JSONB if available
              if (data.draft_revisions && typeof data.draft_revisions === 'object' && !Array.isArray(data.draft_revisions)) {
                setRevisionHistory(data.draft_revisions.history || []);
              }
            }
          }
        }
      } catch (e) {
        console.error("Failed to load existing draft.", e);
      }
    };
    loadExistingDraft();
  }, [matterId, mode, contractId, focusFindingId, draftId]);

  React.useEffect(() => {
    const fetchPlaybooks = async () => {
      console.log("🚀 [SmartComposer] Attempting to fetch Playbooks...");
      try {
        const token = await getToken();
        const baseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
        const url = `${baseUrl}/api/playbook/categories`;
        console.log("🌐 [SmartComposer] Fetching from:", url);

        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });

        console.log("📥 [SmartComposer] Fetch response status:", res.status);

        if (res.ok) {
          const data = await res.json();
          console.log("📦 [SmartComposer] Playbooks received:", data);
          setPlaybookCategories(data.categories || []);
          if (data.categories?.length > 0) setSelectedPlaybook(data.categories[0]);
        } else {
          console.error("❌ [SmartComposer] Fetch failed. Status:", res.status, await res.text());
        }
      } catch (error) {
        console.error("🚨 [SmartComposer] FATAL Network/CORS error fetching playbooks:", error);
      }
    };

    fetchPlaybooks();
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // Fetch Clerk token from window as requested
      const token = await getToken();
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/v1/drafting/generate`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matter_id: matterId,
          template_name: templateName,
          party_name: initialCounterparty || "Counterparty",
          instructions: "Governing Law: " + governingLaw,
        }),
      });

      if (!res.ok) throw new Error("Failed to generate draft");
      const data = await res.json();
      setDraftText(data.draft_text);
    } catch (error) {
      console.error(error);
      alert("Failed to generate draft. Ensure you are signed in.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAudit = async () => {
    setIsAuditing(true);
    try {
      const token = await getToken();
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/v1/drafting/audit`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matter_id: matterId,
          title: taskTitle,
          draft_text: draftText,
        }),
      });

      if (!res.ok) throw new Error("Failed to run audit");

      alert("Draft sent to LangGraph for Audit!");
      onClose();
    } catch (error) {
      console.error(error);
      alert("Failed to audit draft.");
    } finally {
      setIsAuditing(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatHistory(prev => [...prev, { role: "user", content: userMsg }]);
    setChatInput("");
    setIsChatting(true);
    try {
      const token = await getToken();
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/v1/drafting/chat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draft_text: draftText,
          question: userMsg,
        }),
      });
      if (!res.ok) throw new Error("Failed to get chat response");
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: "assistant", content: data.reply, suggestion: data.suggestion }]);
    } catch (error) {
      console.error(error);
      setChatHistory(prev => [...prev, { role: "assistant", content: "⚠️ Connection error. Please ensure the backend is running.", suggestion: null }]);
    } finally {
      setIsChatting(false);
    }
  };

  const handleSaveDraft = async (actionType: RevisionSnapshot['action_type'] = 'Manual Save', actor: RevisionSnapshot['actor'] = 'User') => {
    try {
      const token = await getToken();
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, "");

      // Create a new revision snapshot
      const newSnapshot: RevisionSnapshot = {
        version_id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        actor,
        action_type: actionType,
        content: draftText,
      };

      const updatedHistory = [...revisionHistory, newSnapshot];

      // Construct the full DraftRevisionsPayload
      const payload: DraftRevisionsPayload = {
        latest_text: draftText,
        history: updatedHistory,
      };

      const res = await fetch(`${baseUrl}/api/v1/drafting/save`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matter_id: matterId,
          title: taskTitle,
          draft_text: payload,  // Send full JSONB object
          contract_id: currentContractId,
        }),
      });

      if (!res.ok) throw new Error("Failed to save draft");
      const data = await res.json();
      setCurrentContractId(data.contract_id);
      setRevisionHistory(updatedHistory);
      
      // Visual feedback states
      setIsSaved(true);
      toast.success(`Draft saved — ${actionType}`);
      
      // Reset button state after 3s
      setTimeout(() => setIsSaved(false), 3000);
    } catch (error) {
      console.error("Save Draft Error:", error);
      toast.error("Failed to save draft.");
    }
  };

  // Surgical Replace: splice the new text at the exact character indices
  const performSurgicalReplace = useCallback((newText: string) => {
    if (activeRange) {
      // Use the stored indices for a precise splice
      setDraftText(prev => {
        const before = prev.substring(0, activeRange.start);
        const after = prev.substring(activeRange.end);
        return before + newText + after;
      });
      toast.success('Clause replaced surgically!');
      setTextSelection(null);
      setActiveRange(null); // Clear the lock after successful replacement
    } else {
      // Fallback: append if no active selection
      toast.error('No active selection. Appending instead.');
      setDraftText(prev => prev + '\n\n' + newText);
    }
  }, [activeRange]);

  const handleAppendClause = (suggestionText: string) => {
    setDraftText((prev) => prev + "\n\n" + suggestionText);
  };

  // Fetch clause count for the empty library guard
  useEffect(() => {
    const fetchClauseCount = async () => {
      try {
        const token = await getToken();
        const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
        const res = await fetch(`${baseUrl}/api/v1/clauses`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setTotalApprovedClauses(Array.isArray(data) ? data.length : 0);
        }
      } catch (e) {
        console.error('[SmartComposer] Failed to fetch clause count:', e);
      }
    };
    fetchClauseCount();
  }, []);

  // Bulletproof text selection handler for <textarea>
  const handleTextSelection = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    // We MUST capture the target and coordinates immediately before the React event pools
    const target = e.currentTarget;
    const clientX = e.clientX;
    const clientY = e.clientY;

    setTimeout(() => {
      setRewriteMode(false);
      setRewriteInput("");
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const selectedText = target.value.substring(start, end).trim();

      if (selectedText && selectedText.length > 5) {
        setTextSelection({
          text: selectedText,
          x: clientX,
          y: clientY - 15,
          start,
          end,
        });
        // LOCK the indices into persistent state
        setActiveRange({ start, end });
      } else {
        setTextSelection(null);
        // Do NOT clear activeRange here, so the user can still replace it from chat!
      }
    }, 50);
  }, []);

  // The "Analyze Clause" handler with empty library guard
  const handleAnalyzeClause = useCallback(() => {
    if (!textSelection) return;

    if (totalApprovedClauses === 0) {
      toast.error('Clause Library is Empty', {
        description: 'You need to add standard clauses before the AI can find semantic matches.',
        action: {
          label: 'Go to Settings',
          onClick: () => router.push('/dashboard/settings/clause-library'),
        },
        style: { background: '#141414', border: '1px solid #d4af37', color: 'white' },
      });
      setTextSelection(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    // This triggers the chat API we just fixed!
    const prompt = `Please review this vendor clause: "${textSelection.text}". Does it violate our playbooks? If so, find a semantic match from our Standard Clause Library to replace it. Provide the response with a [REPLACE_ACTION: clause_id] tag if a match is found.`;
    setChatHistory(prev => [...prev, { role: 'user', content: prompt, suggestion: null }]);
    handleSendChatDirect(prompt);

    setTextSelection(null);
    // Note: Can't clear selection on textarea natively via window.getSelection
  }, [textSelection, totalApprovedClauses, router]);

  // Direct chat sender (bypasses the input field)
  const handleSendChatDirect = async (userMsg: string) => {
    setIsChatting(true);
    try {
      const token = await getToken();
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/v1/drafting/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draft_text: draftText, question: userMsg }),
      });
      if (!res.ok) throw new Error('Failed to get chat response');
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.reply, suggestion: data.suggestion }]);
    } catch (error) {
      console.error(error);
      setChatHistory(prev => [...prev, { role: 'assistant', content: '⚠️ Connection error. Please ensure the backend is running.', suggestion: null }]);
    } finally {
      setIsChatting(false);
    }
  };

  // Dismiss floating menu on click outside
  const handleDocumentClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-floating-menu]')) {
      // Only dismiss if there's no active selection
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.toString().trim().length <= 5) {
          setTextSelection(null);
        }
      }, 100);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [handleDocumentClick]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#0a0a0a] flex flex-col overflow-hidden text-[#e5e2e1] font-['Inter'] selection:bg-[#f2ca50]/30">
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,300;0,400;0,700;1,400&family=Inter:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
            vertical-align: middle;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 10px; }
      `}} />

      {/* TopNavBar */}
      <header className="w-full relative z-50 bg-[#131313] flex justify-between items-center px-8 h-16 shadow-none flex-shrink-0">
        <div className="flex items-center gap-8">
          <button
            onClick={onClose}
            className="text-white flex items-center gap-2 py-2 px-4 hover:bg-white/10 rounded transition-colors"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span className="text-sm tracking-wide">Kembali</span>
          </button>
          <div className="flex-1 ml-6 overflow-hidden">
            <span className="text-white text-sm font-semibold truncate block">
              Drafting: {taskTitle}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => handleSaveDraft()}
            disabled={isSaved}
            className={`text-xs font-semibold transition-all duration-300 ${isSaved ? 'text-primary scale-105' : 'text-zinc-400 hover:text-white'}`}
          >
            {isSaved ? 'DRAFT SAVED! ✓' : 'SAVE DRAFT'}
          </button>
          
          {currentContractId && (
            <button
              onClick={() => router.push(`/dashboard/bilingual/${currentContractId}`)}
              className="relative overflow-hidden border border-blue-500/40 bg-[#0a0a0a] text-blue-400 hover:bg-blue-500/10 hover:border-blue-400 px-6 py-2 rounded text-[10px] font-extrabold tracking-[0.1em] uppercase transition-all duration-300 shadow-[0_0_15px_rgba(59,130,246,0.05)] hover:shadow-[0_0_25px_rgba(59,130,246,0.2)]"
              title="Open the Bilingual Editor (Bahasa Indonesia & English)"
            >
              Bilingual Editor
            </button>
          )}

          <button
            onClick={handleAudit}
            disabled={isAuditing}
            className="relative overflow-hidden border border-[#d4af37]/40 bg-[#0a0a0a] text-[#d4af37] hover:bg-[#d4af37]/10 hover:border-[#d4af37] px-8 py-2.5 rounded text-[10px] font-extrabold tracking-[0.2em] uppercase transition-all duration-300 shadow-[0_0_15px_rgba(212,175,55,0.05)] hover:shadow-[0_0_25px_rgba(212,175,55,0.2)]"
          >
            {isAuditing ? "Auditing..." : "RUN COMPLIANCE AUDIT"}
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* SideNavBar (Left Fixed) */}
        <aside className="w-20 bg-[#0e0e0e] border-r border-[#4d4635]/20 flex flex-col items-center py-6 z-40 flex-shrink-0">
          <div className="space-y-8">
            <div
              onClick={() => setActiveTab('docs')}
              className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${activeTab === 'docs' ? 'text-white border-l-2 border-[#f2ca50] bg-[#1c1b1b] py-3 pl-0 w-full' : 'text-zinc-500 hover:text-white hover:bg-[#1c1b1b] p-2 rounded'}`}
            >
              <span className="material-symbols-outlined text-2xl" style={activeTab === 'docs' ? { fontVariationSettings: "'FILL' 1" } : {}}>description</span>
              <span className={`font-sans text-[10px] tracking-widest uppercase ${activeTab === 'docs' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>Docs</span>
            </div>

            <div
              onClick={() => setActiveTab('library')}
              className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${activeTab === 'library' ? 'text-white border-l-2 border-[#f2ca50] bg-[#1c1b1b] py-3 pl-0 w-full' : 'text-zinc-500 hover:text-white hover:bg-[#1c1b1b] p-2 rounded'}`}
            >
              <span className="material-symbols-outlined text-2xl" style={activeTab === 'library' ? { fontVariationSettings: "'FILL' 1" } : {}}>menu_book</span>
              <span className={`font-sans text-[10px] tracking-widest uppercase ${activeTab === 'library' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>Library</span>
            </div>
            <div
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${activeTab === 'history' ? 'text-white border-l-2 border-[#f2ca50] bg-[#1c1b1b] py-3 pl-0 w-full' : 'text-zinc-500 hover:text-white hover:bg-[#1c1b1b] p-2 rounded'}`}
            >
              <span className="material-symbols-outlined text-2xl" style={activeTab === 'history' ? { fontVariationSettings: "'FILL' 1" } : {}}>history</span>
              <span className={`font-sans text-[10px] tracking-widest uppercase ${activeTab === 'history' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>History</span>
            </div>
          </div>
        </aside>

        {/* Column 1: The Control Room / Clause Library / History Panel */}
        {activeTab === 'library' ? (
          <ClauseLibraryPanel onInsert={handleAppendClause} />
        ) : activeTab === 'history' ? (
          <HistoryPanel
            history={revisionHistory}
            onPreview={(content) => setPreviewText(content)}
            onRestore={(snapshot) => {
              setDraftText(snapshot.content);
              setPreviewText(null);
              toast.success(`Restored to version from ${new Date(snapshot.timestamp).toLocaleString()}`);
              // Auto-save with 'Restored' action type
              setTimeout(() => handleSaveDraft('Restored', 'User'), 300);
            }}
          />
        ) : (
          <section className="w-[320px] p-6 border-r border-[#4d4635]/10 overflow-y-auto bg-[#0a0a0a] custom-scrollbar flex flex-col flex-shrink-0">
            <h2 className="font-serif text-lg text-[#d0c5af] mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-white scale-75">tune</span>
              The Control Room
            </h2>

            <div className="space-y-6 flex-1">
              {/* Template Card */}
              <div className="bg-[#0f0f0f] border border-zinc-800/60 rounded-xl p-5">
                <h3 className="font-['Inter'] text-xs uppercase tracking-[0.2em] text-[#d4af37] mb-4">Draft Template</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">TEMPLATE NAME</label>
                    <select
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      className="w-full bg-[#141414] border-none text-sm text-zinc-300 rounded-md focus:ring-1 focus:ring-[#f2ca50]/40 h-10 px-3 outline-none"
                    >
                      <option>Mutual NDA</option>
                      <option>Master Service Agreement</option>
                      <option>Vendor Agreement</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Intake Variables Card */}
              <div className="bg-[#0f0f0f] border border-zinc-800/60 rounded-xl p-5">
                <h3 className="font-['Inter'] text-xs uppercase tracking-[0.2em] text-[#d4af37] mb-4">Intake Variables</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">EFFECTIVE DATE</label>
                    <input className="w-full bg-[#141414] border-none text-sm text-zinc-300 rounded-md focus:ring-1 focus:ring-[#f2ca50]/40 h-10 px-3 outline-none" type="date" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">GOVERNING LAW</label>
                    <select
                      value={governingLaw}
                      onChange={(e) => setGoverningLaw(e.target.value)}
                      className="w-full bg-[#141414] border-none text-sm text-zinc-300 rounded-md focus:ring-1 focus:ring-[#f2ca50]/40 h-10 px-3 outline-none"
                    >
                      <option>State of Delaware</option>
                      <option>State of New York</option>
                      <option>California Law</option>
                      <option>Republic of Indonesia</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">TERMINATION (MONTHS)</label>
                    <input className="w-full bg-[#141414] border-none text-sm text-zinc-300 rounded-md focus:ring-1 focus:ring-[#f2ca50]/40 h-10 px-3 outline-none" placeholder="12" type="number" />
                  </div>
                </div>
              </div>

              {/* Playbook Library Card */}
              <div className="bg-[#0f0f0f] border border-zinc-800/60 rounded-xl p-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#d4af37] uppercase tracking-[0.2em] mb-4 block">Playbook Library</label>
                  {playbookCategories.length > 0 ? playbookCategories.map((category) => (
                    <div
                      key={category}
                      onClick={() => setSelectedPlaybook(category)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedPlaybook === category
                        ? 'border-[#d4af37]/50 bg-[#141414]'
                        : 'border-white/5 bg-transparent hover:border-white/20'
                        }`}
                    >
                      <div className="text-xs font-semibold text-white">{category}</div>
                      <div className="text-[10px] text-zinc-500 mt-1">Custom rule set</div>
                    </div>
                  )) : (
                    <div className="text-xs text-zinc-500 italic p-2">No playbooks found. Add them in Settings.</div>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`
                w-full py-3.5 px-4 rounded-md uppercase font-bold text-sm tracking-[0.15em] transition-all duration-300 mt-6
                ${isGenerating 
                    ? 'bg-white/5 text-white/30 cursor-not-allowed border border-white/10' 
                    : 'bg-gradient-to-r from-[#d4af37] to-[#bda036] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:shadow-[0_0_25px_rgba(212,175,55,0.4)] hover:scale-[1.02] active:scale-[0.98]'
                }
              `}
            >
              {isGenerating ? "Generating..." : "Generate Draft"}
            </button>
          </section>
        )}

        {/* Column 2: The Live Document */}
        <section className="flex-1 bg-[#0a0a0a] p-8 overflow-y-auto custom-scrollbar flex flex-col items-center relative">
          <div className="max-w-[750px] w-full bg-white text-black border border-zinc-200 rounded-xl shadow-2xl p-16 min-h-[1000px] mb-12 flex flex-col">
            <header className="text-center mb-8">
              <h1 className="font-serif text-3xl mb-2 tracking-tight uppercase">{templateName}</h1>
              <p className="font-serif text-sm italic text-zinc-500">Document ID: NDA-{matterId.substring(0, 8).toUpperCase()}</p>
            </header>

            <div className="flex-1 w-full relative group">
              {previewText !== null ? (
                /* READ-ONLY PREVIEW MODE */
                <div className="relative">
                  <div className="absolute top-0 left-0 right-0 bg-amber-500/90 text-black text-[10px] font-extrabold uppercase tracking-[0.2em] text-center py-1.5 rounded-t-lg z-10">
                    PREVIEWING OLD VERSION
                  </div>
                  <textarea
                    value={previewText}
                    readOnly
                    className="w-full h-full min-h-[700px] bg-zinc-100 border-none text-zinc-600 font-serif text-[15px] leading-relaxed resize-none focus:ring-0 px-0 custom-scrollbar outline-none pt-8 cursor-not-allowed"
                    spellCheck="false"
                  />
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-3">
                    <button
                      onClick={() => setPreviewText(null)}
                      className="px-6 py-2 bg-zinc-800 text-white text-[10px] font-bold uppercase tracking-wider rounded hover:bg-zinc-700 transition-colors"
                    >
                      Exit Preview
                    </button>
                  </div>
                </div>
              ) : draftText ? (
                <textarea
                  ref={textareaRef}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onMouseUp={handleTextSelection}
                  onSelect={(e) => {
                    const start = e.currentTarget.selectionStart;
                    const end = e.currentTarget.selectionEnd;
                    if (start !== end) {
                      setActiveRange({ start, end });
                    }
                  }}
                  className="w-full h-full min-h-[700px] bg-transparent border-none text-black font-serif text-[15px] leading-relaxed resize-none focus:ring-0 px-0 custom-scrollbar outline-none placeholder:text-gray-400"
                  spellCheck="false"
                />
              ) : (
                <div className="w-full h-full min-h-[700px] flex items-center justify-center">
                  <p className="text-zinc-600 font-serif italic">Use the Control Room to generate a draft...</p>
                </div>
              )}
            </div>
          </div>

          <footer className="pb-8 text-center flex-shrink-0">
            <p className="text-[10px] text-zinc-600 tracking-wider">AI generated insights based on your secured RAG data.</p>
          </footer>

          {/* Floating Action Menu (Text Selection) */}
          {textSelection && (
            <div
              data-floating-menu
              className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.6)] bg-[#141414] border border-[#d4af37]/50 rounded-lg p-1 transition-all backdrop-blur-xl"
              style={{ left: textSelection.x, top: textSelection.y, transform: 'translate(-50%, -100%)' }}
            >
              {rewriteMode ? (
                <div className="flex items-center gap-2 p-1 w-64">
                  <span className="text-xl pl-1">🪄</span>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Tell AI how to rewrite..."
                    className="bg-transparent text-xs text-white outline-none w-full placeholder:text-zinc-600 px-1 font-sans"
                    value={rewriteInput}
                    onChange={(e) => setRewriteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && rewriteInput.trim()) {
                        const prompt = `Please rewrite this specific text: "${textSelection.text}"\n\nInstruction: ${rewriteInput}`;
                        setChatHistory(prev => [...prev, { role: 'user', content: prompt, suggestion: null }]);
                        handleSendChatDirect(prompt);
                        setTextSelection(null);
                        setRewriteMode(false);
                      } else if (e.key === 'Escape') {
                        setRewriteMode(false);
                      }
                    }}
                  />
                  <button
                    onClick={() => setRewriteMode(false)}
                    className="text-zinc-500 hover:text-white px-2 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setRewriteMode(true)}
                    className="flex items-center gap-1.5 px-3 py-2 hover:bg-white/5 rounded-md text-xs font-bold uppercase tracking-wider text-zinc-300 hover:text-white transition-colors"
                  >
                    Rewrite
                  </button>
                  <div className="w-[1px] h-5 bg-white/10 mx-1"></div>
                  <button
                    onClick={handleAnalyzeClause}
                    className="flex items-center gap-1.5 px-3 py-2 hover:bg-[#d4af37]/10 rounded-md text-xs font-bold uppercase tracking-wider text-[#d4af37] transition-colors"
                  >
                    Analyze
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Column 3: Clause Assistant */}
        <section className="w-[380px] bg-[#0a0a0a] border-l border-[#4d4635]/10 flex flex-col h-full flex-shrink-0">
          <header className="p-6 border-b border-[#4d4635]/10 bg-[#0f0f0f]/50">
            <h2 className="text-[11px] font-bold text-zinc-400 tracking-widest uppercase">CLAUSE ASSISTANT</h2>
          </header>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
            {chatHistory.map((msg, idx) => (
              msg.role === "assistant" ? (
                <div key={idx} className="flex flex-col items-start max-w-[90%]">
                  <div className="bg-[#0f0f0f] border border-zinc-800/60 rounded-2xl rounded-tl-sm p-4 text-sm text-zinc-300 leading-relaxed shadow-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  {msg.suggestion && (
                    <div className="bg-[#141414] border border-[#d4af37]/30 rounded-xl p-4 space-y-3 mt-3 w-full">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[#f2ca50] uppercase">Draft Suggestion</span>
                        <span className="text-[9px] text-zinc-500">AI Generated</span>
                      </div>
                      <p className="text-xs italic text-zinc-400 font-serif leading-relaxed line-clamp-4">
                        "{msg.suggestion}"
                      </p>
                      <div className="flex gap-2 mt-3 w-full">
                        <button
                          onClick={() => performSurgicalReplace(msg.suggestion!)}
                          className="flex-1 w-full py-2 bg-[#d4af37]/20 hover:bg-[#d4af37]/30 text-[#f2ca50] text-[10px] font-bold uppercase tracking-wider rounded transition-all"
                        >
                          Replace Document
                        </button>
                        <button
                          onClick={() => handleAppendClause(msg.suggestion!)}
                          className="flex-1 w-full py-2 bg-[#d4af37]/20 hover:bg-[#d4af37]/30 text-[#f2ca50] text-[10px] font-bold uppercase tracking-wider rounded transition-all"
                        >
                          Append Clause
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div key={idx} className="flex flex-col items-end max-w-[90%] ml-auto">
                  <div className="bg-[#d4af37]/10 border border-[#d4af37]/20 rounded-2xl rounded-tr-sm p-4 text-sm text-zinc-200 leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              )
            ))}
            {isChatting && (
              <div className="flex justify-start max-w-[85%] mt-4 animate-in fade-in duration-300">
                <LuxuryThinkingStepper isLoading={true} steps={draftingSteps} />
              </div>
            )}
          </div>

          {/* Sticky Input Area */}
          <div className="h-28 border-t border-[#4d4635]/10 bg-[#0f0f0f] p-4 flex flex-col gap-2 flex-shrink-0">
            <div className="relative flex-1">
              <textarea
                className="w-full h-full bg-transparent border-none text-sm text-zinc-300 focus:ring-0 resize-none px-0 outline-none placeholder:text-zinc-600 custom-scrollbar"
                placeholder="Ask the archivist to redraft or analyze..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
              ></textarea>
              <button
                onClick={handleSendChat}
                disabled={isChatting || !chatInput.trim()}
                className="absolute bottom-0 right-0 p-2 text-[#d4af37] hover:scale-110 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isChatting ? (
                  <svg className="animate-spin h-5 w-5 text-[#d4af37]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                )}
              </button>
            </div>
            <div className="flex gap-2">
              <span className="text-[10px] px-2 py-0.5 bg-[#1c1b1b] text-zinc-500 rounded border border-zinc-800 cursor-pointer hover:text-zinc-300 transition-colors">Compare</span>
              <span className="text-[10px] px-2 py-0.5 bg-[#1c1b1b] text-zinc-500 rounded border border-zinc-800 cursor-pointer hover:text-zinc-300 transition-colors">Risk Audit</span>
              <span className="text-[10px] px-2 py-0.5 bg-[#1c1b1b] text-zinc-500 rounded border border-zinc-800 cursor-pointer hover:text-zinc-300 transition-colors">Precedents</span>
            </div>
          </div>
        </section>
      </div>

      {/* Overlay Effects for Luxury Feel */}
      <div className="fixed inset-0 pointer-events-none border-[24px] border-black opacity-10 z-50"></div>
      <div className="fixed bottom-0 left-0 w-full h-32 bg-gradient-to-t from-black to-transparent pointer-events-none opacity-40 z-50"></div>
      
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  );
}
