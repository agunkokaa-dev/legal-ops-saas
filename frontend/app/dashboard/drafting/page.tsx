"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { getPublicApiBase } from "@/lib/public-api-base";

export default function DraftingGatekeeper() {
  return (
    <Suspense fallback={<div>Loading workspace...</div>}>
      <DraftingGatekeeperContent />
    </Suspense>
  );
}

function DraftingGatekeeperContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken, isLoaded, orgId, userId } = useAuth();

  // ── Review-to-Draft Bridge: bypass gatekeeper ──
  useEffect(() => {
    const mode = searchParams.get('mode');
    const contractId = searchParams.get('contract_id');
    const focusFinding = searchParams.get('focus_finding');

    if (mode === 'review' && contractId) {
      // We need a matterId for the route. Fetch the contract's matter_id.
      const resolveMatter = async () => {
        try {
          const token = await getToken();
          const apiUrl = getPublicApiBase();
          const res = await fetch(`${apiUrl}/api/v1/review/${contractId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            const matterId = data.review?.matter_id || data.matter_id || contractId;
            const qs = `mode=review&contract_id=${contractId}${focusFinding ? `&focus_finding=${focusFinding}` : ''}`;
            router.replace(`/dashboard/drafting/${matterId}?${qs}`);
          }
        } catch (e) {
          console.error('Review-to-Draft redirect failed:', e);
        }
      };
      if (isLoaded) resolveMatter();
    }
  }, [searchParams, isLoaded, getToken, router]);

  const [matters, setMatters] = useState<any[]>([]);
  const [selectedMatterId, setSelectedMatterId] = useState<string>("NEW_MATTER");
  const [newMatterName, setNewMatterName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchMatters = async () => {
      if (!isLoaded) return;
      try {
        const token = await getToken();
        if (!token) return;

        const apiUrl = getPublicApiBase();
        const res = await fetch(`${apiUrl}/api/v1/matters`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-Tenant-Id": orgId || userId || ""
          }
        });

        if (res.ok) {
          const result = await res.json();
          setMatters(result.data || []);
        } else {
          console.error("Failed to fetch matters, Status:", res.status);
        }
      } catch (err) {
        console.error("Failed to fetch matters:", err);
      }
    };
    fetchMatters();
  }, [isLoaded, getToken]);

  const handleInitialize = async () => {
    setIsLoading(true);
    let targetMatterId = selectedMatterId;

    try {
      const token = await getToken();
      const apiUrl = getPublicApiBase();

      // Step 1: Create new matter if requested
      if (selectedMatterId === "NEW_MATTER") {
        const matterRes = await fetch(`${apiUrl}/api/v1/matters`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-Tenant-Id": orgId || userId || "",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ name: newMatterName, description: "Auto-generated for drafting session" })
        });

        if (!matterRes.ok) throw new Error("Failed to create matter");

        const matterData = await matterRes.json();
        targetMatterId = matterData.data[0].id; // Based on Pariana schema, data is array of inserted row(s)
      }

      // Step 2: Create a blank contract linked to the Matter using /api/v1/drafting/save
      const contractRes = await fetch(`${apiUrl}/api/v1/drafting/save`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Tenant-Id": orgId || userId || "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          matter_id: targetMatterId,
          title: "Untitled Draft",
          draft_text: ""
        })
      });

      if (!contractRes.ok) throw new Error("Failed to initialize draft workspace");

      const contractData = await contractRes.json();

      // Step 3: Redirect to the SmartComposer (Deep Work Mode)
      router.push(`/dashboard/drafting/${targetMatterId}`);

    } catch (error) {
      console.error("Initialization failed:", error);
      setIsLoading(false);
    }
  };

  const isFormValid = selectedMatterId !== "NEW_MATTER" || newMatterName.trim().length > 0;

  return (
    <div className="h-full min-h-[calc(100vh-4rem)] w-full flex items-center justify-center bg-[#0a0a0a] text-white p-6">
      <div className="bg-surface border border-surface-border w-full max-w-2xl rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden relative z-50 animate-in fade-in zoom-in-95 duration-300">

        <div className="flex justify-between items-center p-6 border-b border-surface-border bg-surface/50">
          <div>
            <h2 className="text-xl font-display text-white">Initialize New Draft</h2>
            <p className="text-xs text-text-muted mt-1">Select an existing matter or create a new one to begin deep work.</p>
          </div>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Select Matter</label>
              <div className="relative">
                <select
                  value={selectedMatterId}
                  onChange={(e) => setSelectedMatterId(e.target.value)}
                  className="bg-[#0a0a0a] border border-surface-border w-full rounded p-3 text-white text-sm focus:border-primary focus:outline-none transition-colors appearance-none cursor-pointer"
                >
                  <option value="NEW_MATTER" className="font-medium text-primary">[ + Create New Matter ]</option>
                  {matters.map((m) => (
                    <option key={m.id} value={m.id}>{m.title || m.name || "Untitled Matter"}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">expand_more</span>
              </div>
            </div>

            {selectedMatterId === "NEW_MATTER" && (
              <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-xs font-medium text-text-muted uppercase tracking-wider">New Matter Name</label>
                <input
                  type="text"
                  value={newMatterName}
                  onChange={(e) => setNewMatterName(e.target.value)}
                  placeholder="e.g. Project Phoenix M&A"
                  className="bg-[#0a0a0a] border border-surface-border rounded p-3 text-white text-sm focus:border-primary focus:outline-none transition-colors"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end pt-4 border-t border-surface-border">
            <button
              onClick={handleInitialize}
              disabled={!isFormValid || isLoading}
              className="bg-primary px-6 py-2.5 rounded text-sm text-[#0A0A0A] font-medium hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(var(--primary),0.3)] group"
            >
              {isLoading ? 'INITIALIZING...' : 'INITIALIZE WORKSPACE '}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
