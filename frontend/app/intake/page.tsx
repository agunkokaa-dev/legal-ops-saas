"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { getPublicApiBase } from "@/lib/public-api-base";

export default function IntakePortal() {
  const { getToken, isLoaded, orgId, userId } = useAuth();
  
  const [requestType, setRequestType] = useState("NDA");
  const [counterparty, setCounterparty] = useState("");
  const [urgency, setUrgency] = useState("Standard");
  const [businessContext, setBusinessContext] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [matters, setMatters] = useState<any[]>([]);
  const [selectedMatterId, setSelectedMatterId] = useState<string>("");

  const fetchRecentRequests = async () => {
    if (!isLoaded) return;
    try {
      const token = await getToken();
      if (!token) return;
      const apiUrl = getPublicApiBase();
      const res = await fetch(`${apiUrl}/api/v1/intake/requests`, {
        headers: { 
          "Authorization": `Bearer ${token}`,
          "X-Tenant-Id": orgId || userId || ""
        }
      });
      if (res.ok) {
        const data = await res.json();
        setRecentRequests(data);
      }
    } catch (err) {
      console.error("Failed to fetch recent requests:", err);
    }
  };

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
      }
    } catch (err) {
      console.error("Failed to fetch matters:", err);
    }
  };

  useEffect(() => {
    if (isLoaded) {
      fetchRecentRequests();
      fetchMatters();
    }
  }, [isLoaded]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage({ type: "", text: "" });

    try {
      const token = await getToken();

      const payload = {
        request_type: requestType,
        counterparty,
        urgency,
        business_context: businessContext,
        matter_id: selectedMatterId || null
      };

      const apiUrl = getPublicApiBase();
      const response = await fetch(`${apiUrl}/api/v1/intake/request`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Tenant-Id": orgId || userId || "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to submit request");
      }

      setMessage({ type: "success", text: "Request submitted successfully!" });
      
      // Clear form on success
      setRequestType("NDA");
      setCounterparty("");
      setUrgency("Standard");
      setBusinessContext("");
      setSelectedMatterId("");
      
      fetchRecentRequests();
      
    } catch (error) {
      console.error("Submission error:", error);
      const err = error as Error;
      setMessage({ type: "error", text: err.message || "An error occurred during submission" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-full overflow-y-auto overflow-x-hidden relative bg-[#0a0a0a] text-[#e5e2e1] font-['Manrope'] custom-scrollbar antialiased">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;500;600&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
        }
        .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #4d4635;
            border-radius: 10px;
        }
      `}} />

      {/* TopNavBar - Anchored Shared Component */}
      <nav className="bg-[#0a0a0a] dark:bg-[#0a0a0a] sticky full-width top-0 z-50">
        <div className="flex justify-between items-center w-full px-8 py-6 max-w-[800px] mx-auto">
          <div className="text-lg font-light tracking-[0.2em] text-[#D4AF37] uppercase">
            CLAUSE | Business Portal
          </div>
          <div className="flex items-center gap-6">
            <button className="text-zinc-400 hover:text-[#D4AF37] transition-colors duration-300 scale-95 ease-in-out">
              <span className="material-symbols-outlined" data-icon="notifications">notifications</span>
            </button>
            <div className="w-8 h-8 rounded-full overflow-hidden border border-zinc-700/30">
              <img 
                alt="User profile avatar" 
                className="w-full h-full object-cover" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAQzjCJD-O5vSIk1Q7qFpy1lSrb5ubfndJ4AvHTVmweL4cAwR_6qtv3Se9XxEZuDzCGuAn26luuwck09uFDr2oDFOW5Cqjwka70uTG7DyHpjx9OZsxVz3FzOv_20TQ8pJOhr5WcgLkxKtZAE3za9a9YMHj5A2zDXlEf0SoDxYO5zxM5_sRMT4_0Ujwn3FhsfSMiCf9fhyMtPRiJ6eVsFJqp2jXC9snhoEYVaT12nMIMbPX4ZV7ppRa9OJkgsRGgHK__Vs5e_t_5woQ"
              />
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto pt-12 pb-40 px-6">
        {/* Section 1: Welcome Section */}
        <header className="mb-12">
          <h1 className="text-3xl font-light tracking-wide text-zinc-100">
            Good morning, Sales Team.
          </h1>
          <p className="text-sm text-zinc-400 mt-2 font-light tracking-[0.05em]">
            What legal assistance do you need today?
          </p>
        </header>

        {/* Section 2: Intake Form Card */}
        <section className="bg-[#1C1917] border border-zinc-800 rounded-2xl p-8 mb-16 shadow-2xl relative overflow-hidden">
          {/* Subtle architectural glow */}
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#f2ca50]/5 blur-[100px] rounded-full"></div>
          
          <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
            
            {message.text && (
              <div className={`p-4 rounded-xl text-xs font-medium tracking-wide ${message.type === 'error' ? 'bg-[#93000a]/20 text-[#ffb4ab] border border-[#ffb4ab]/30' : 'bg-emerald-900/30 text-emerald-200/80 border border-emerald-900/50'}`}>
                {message.text}
              </div>
            )}

            {/* Matter Selection */}
            <div className="flex flex-col space-y-2">
              <label className="text-[10px] font-medium tracking-[0.15em] text-[#99907c] uppercase italic">Linked Project (Optional)</label>
              <select 
                value={selectedMatterId}
                onChange={(e) => setSelectedMatterId(e.target.value)}
                className="bg-[#292524] border border-zinc-700/50 rounded-lg p-3 text-zinc-200 text-sm focus:ring-1 focus:ring-[#f2ca50]/30 focus:border-[#f2ca50]/30 outline-none transition-all appearance-none cursor-pointer"
              >
                <option value="">+ Create New Project / Matter</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-[9px] text-zinc-500 font-light">Select an existing project to group this request, or leave as is to create a new one.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Request Type */}
              <div className="flex flex-col space-y-2">
                <label className="text-[10px] font-medium tracking-[0.15em] text-[#99907c] uppercase">Request Type</label>
                <select 
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="bg-[#292524] border border-zinc-700/50 rounded-lg p-3 text-zinc-200 text-sm focus:ring-1 focus:ring-[#f2ca50]/30 focus:border-[#f2ca50]/30 outline-none transition-all appearance-none cursor-pointer"
                >
                  <option value="NDA">NDA</option>
                  <option value="Master Service Agreement">Master Service Agreement</option>
                  <option value="Vendor Contract Review">Vendor Contract Review</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Counterparty Name */}
              <div className="flex flex-col space-y-2">
                <label className="text-[10px] font-medium tracking-[0.15em] text-[#99907c] uppercase">Counterparty Name</label>
                <input 
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  required
                  className="bg-[#292524] border border-zinc-700/50 rounded-lg p-3 text-zinc-200 text-sm placeholder:text-zinc-600 focus:ring-1 focus:ring-[#f2ca50]/30 focus:border-[#f2ca50]/30 outline-none transition-all" 
                  placeholder="E.g., PT Teknologi Nusantara" 
                  type="text"
                />
              </div>
            </div>

            {/* Urgency (Pill Buttons) */}
            <div className="flex flex-col space-y-4">
              <label className="text-[10px] font-medium tracking-[0.15em] text-[#99907c] uppercase">Urgency Level</label>
              <div className="flex gap-4">
                <label className="flex-1 cursor-pointer group">
                  <input 
                    checked={urgency === 'Standard'}
                    onChange={() => setUrgency('Standard')}
                    name="urgency" 
                    type="radio" 
                    className="hidden peer"
                  />
                  <div className="flex items-center justify-center py-3 px-4 rounded-xl border border-zinc-700/50 bg-[#292524] text-zinc-400 peer-checked:bg-[#353534] peer-checked:text-[#e5e2e1] peer-checked:border-zinc-600 transition-all duration-300 group-hover:bg-[#35312f]">
                    <span className="text-xs font-medium tracking-wide">Standard (3-5 Days)</span>
                  </div>
                </label>
                
                <label className="flex-1 cursor-pointer group">
                  <input 
                    checked={urgency === 'High'}
                    onChange={() => setUrgency('High')}
                    name="urgency" 
                    type="radio" 
                    className="hidden peer"
                  />
                  <div className="flex items-center justify-center py-3 px-4 rounded-xl border border-zinc-700/50 bg-[#292524] text-zinc-400 peer-checked:bg-[#93000a]/20 peer-checked:text-[#ffb4ab] peer-checked:border-[#ffb4ab]/30 transition-all duration-300 group-hover:bg-[#35312f]">
                    <span className="text-xs font-medium tracking-wide">Expedited (24 Hours)</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Business Context */}
            <div className="flex flex-col space-y-2">
              <label className="text-[10px] font-medium tracking-[0.15em] text-[#99907c] uppercase">Business Context</label>
              <textarea 
                required
                value={businessContext}
                onChange={(e) => setBusinessContext(e.target.value)}
                className="bg-[#292524] border border-zinc-700/50 rounded-lg p-3 text-zinc-200 text-sm placeholder:text-zinc-600 focus:ring-1 focus:ring-[#f2ca50]/30 focus:border-[#f2ca50]/30 outline-none transition-all resize-none" 
                placeholder="Briefly describe the commercial objective and any deal-specific constraints..." 
                rows={4}
              ></textarea>
            </div>

            {/* Section 3: Submit Button */}
            <button 
              disabled={isLoading}
              type="submit" 
              className={`w-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/20 py-4 rounded-xl font-medium tracking-widest uppercase text-xs flex items-center justify-center gap-2 transition-all duration-500 group ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:gap-4'}`}
            >
              {isLoading ? 'Submitting...' : 'Submit to Legal H.Q.'}
              {!isLoading && <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-1" data-icon="arrow_forward">arrow_forward</span>}
            </button>
          </form>
        </section>

        {/* Section 4: Recent Requests Table */}
        <section className="mt-16">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[10px] font-bold tracking-[0.2em] text-[#99907c] uppercase">Recent Activity</h2>
            <a className="text-[10px] font-medium tracking-widest text-[#f2ca50]/70 hover:text-[#f2ca50] uppercase transition-colors" href="#">View All Archive</a>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-3">
              <thead>
                <tr>
                  <th className="px-6 py-2 text-[10px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Request</th>
                  <th className="px-6 py-2 text-[10px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Counterparty</th>
                  <th className="px-6 py-2 text-[10px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Date</th>
                  <th className="px-6 py-2 text-[10px] font-medium tracking-[0.15em] text-zinc-500 uppercase text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRequests.map((req) => {
                  let type = "Unknown";
                  let cparty = "Unknown";
                  if (req.title && req.title.includes(" - ")) {
                    const parts = req.title.split(" - ");
                    type = parts[0];
                    cparty = parts.slice(1).join(" - ");
                  } else if (req.title) {
                    type = req.title;
                  }

                  const dateStr = req.created_at ? new Date(req.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A";
                  
                  const statusRaw = req.tasks && req.tasks.length > 0 ? req.tasks[0].status : null;
                  const status = statusRaw || "In Queue";

                  let statusBg = "bg-zinc-800 text-zinc-300";
                  let icon = "description";
                  
                  const statusLower = status.toLowerCase();
                  if (statusLower.includes("progress") || statusLower.includes("review")) {
                    statusBg = "bg-amber-900/30 text-amber-200/80";
                    icon = "gavel";
                  } else if (statusLower === "done" || statusLower === "completed") {
                    statusBg = "bg-emerald-900/30 text-emerald-200/80";
                    icon = "verified";
                  }

                  let displayStatus = status;
                  if (statusLower === "backlog") displayStatus = "In Queue";
                  else if (statusLower.replace("_", " ") === "in progress") displayStatus = "In Progress";
                  else if (statusLower === "done") displayStatus = "Completed";

                  return (
                    <tr key={req.id} className="group cursor-pointer">
                      <td className="px-6 py-5 bg-[#1c1b1b] rounded-l-xl border-y border-l border-transparent group-hover:border-zinc-800 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded bg-zinc-800/50">
                            <span className="material-symbols-outlined text-sm text-zinc-400" data-icon={icon}>{icon}</span>
                          </div>
                          <span className="text-sm font-light text-[#e5e2e1]">{type}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 bg-[#1c1b1b] border-y border-transparent group-hover:border-zinc-800 transition-all">
                        <span className="text-sm text-zinc-400 font-light">{cparty}</span>
                      </td>
                      <td className="px-6 py-5 bg-[#1c1b1b] border-y border-transparent group-hover:border-zinc-800 transition-all">
                        <span className="text-xs text-zinc-500 font-light">{dateStr}</span>
                      </td>
                      <td className="px-6 py-5 bg-[#1c1b1b] rounded-r-xl border-y border-r border-transparent group-hover:border-zinc-800 text-right transition-all">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-tighter ${statusBg}`}>
                          {displayStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* BottomNavBar - Anchored Shared Component */}
      <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-6 pb-8 pt-4 bg-[#131313]/80 backdrop-blur-xl border-t border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.5)] z-50">
        <a className="flex flex-col items-center justify-center text-[#D4AF37] transition-all duration-300 active:scale-90 group" href="#">
          <span className="material-symbols-outlined mb-1" style={{ fontVariationSettings: "'FILL' 1" }} data-icon="add_circle">add_circle</span>
          <span className="font-['Manrope'] text-[10px] font-medium tracking-widest uppercase">New Request</span>
        </a>
        <a className="flex flex-col items-center justify-center text-zinc-500 hover:bg-white/5 transition-all duration-300 active:scale-90 p-2 rounded-lg" href="#">
          <span className="material-symbols-outlined mb-1" data-icon="history">history</span>
          <span className="font-['Manrope'] text-[10px] font-medium tracking-widest uppercase">My History</span>
        </a>
        <a className="flex flex-col items-center justify-center text-zinc-500 hover:bg-white/5 transition-all duration-300 active:scale-90 p-2 rounded-lg" href="#">
          <span className="material-symbols-outlined mb-1" data-icon="contact_support">contact_support</span>
          <span className="font-['Manrope'] text-[10px] font-medium tracking-widest uppercase">Support</span>
        </a>
      </nav>
    </div>
  );
}
