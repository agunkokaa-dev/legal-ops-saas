'use client';

import React from 'react';
import type { RevisionSnapshot } from '@/types/history';

interface HistoryPanelProps {
  history: RevisionSnapshot[];
  onPreview: (content: string) => void;
  onRestore: (snapshot: RevisionSnapshot) => void;
}

const actorConfig: Record<RevisionSnapshot['actor'], { icon: string; color: string }> = {
  'User': { icon: 'person', color: '#a1a1aa' },
  'AI LangGraph': { icon: 'smart_toy', color: '#888888' },
  'AI Clause Assistant': { icon: 'auto_awesome', color: '#B8B8B8' },
};

const actionBadgeColor: Record<RevisionSnapshot['action_type'], string> = {
  'Manual Save': 'bg-zinc-700/50 text-zinc-300',
  'Compliance Audit': 'bg-[#1C1C1C] text-[#B8B8B8]',
  'Clause Insertion': 'bg-[#B8B8B8]/15 text-[#B8B8B8]',
  'Restored': 'bg-emerald-500/15 text-emerald-400',
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${day} · ${time}`;
  } catch {
    return iso;
  }
}

export default function HistoryPanel({ history, onPreview, onRestore }: HistoryPanelProps) {
  const sorted = [...history].sort((a, b) => Number(b.version_id) - Number(a.version_id));

  return (
    <section className="w-[320px] h-full flex-shrink-0 bg-[#0a0a0a] border-r border-zinc-800/60 flex flex-col z-10 overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800/60 p-5 flex items-center justify-between flex-shrink-0">
        <h2 className="text-xs font-semibold text-white tracking-widest uppercase font-['Inter']">
          VERSION HISTORY
        </h2>
        <span className="text-[10px] text-zinc-500 font-['Inter']">{history.length} SNAPSHOTS</span>
      </header>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-12 p-6 text-center border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-zinc-500 text-xl">history</span>
            </div>
            <h4 className="text-zinc-300 text-[11px] font-bold uppercase tracking-widest mb-2">
              No History Yet
            </h4>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Save your draft to create the first audit trail snapshot.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[15px] top-4 bottom-4 w-[1px] bg-zinc-800/80" />

            <div className="flex flex-col gap-4">
              {sorted.map((snap, idx) => {
                const config = actorConfig[snap.actor];
                const badge = actionBadgeColor[snap.action_type];

                return (
                  <div key={snap.version_id} className="relative pl-10 group">
                    {/* Timeline dot */}
                    <div
                      className="absolute left-[9px] top-3 w-[13px] h-[13px] rounded-full border-2 transition-all"
                      style={{
                        borderColor: config.color,
                        backgroundColor: idx === 0 ? config.color : 'transparent',
                      }}
                    />

                    {/* Card */}
                    <div
                      onClick={() => onPreview(snap.content)}
                      className="bg-[#141414] border border-zinc-800/60 rounded-lg p-4 cursor-pointer hover:border-[#B8B8B8]/30 transition-all group-hover:shadow-[0_0_20px_rgba(184, 184, 184,0.03)]"
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="material-symbols-outlined text-base"
                            style={{ color: config.color }}
                          >
                            {config.icon}
                          </span>
                          <span className="text-[11px] font-semibold text-white font-['Inter']">
                            {snap.actor}
                          </span>
                        </div>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${badge}`}>
                          {snap.action_type}
                        </span>
                      </div>

                      {/* Timestamp */}
                      <p className="text-[10px] text-zinc-500 font-['Inter'] mb-3">
                        {formatTimestamp(snap.timestamp)}
                      </p>

                      {/* Content preview */}
                      <p className="text-[11px] text-zinc-400 font-['Inter'] line-clamp-2 leading-relaxed mb-3">
                        {snap.content.substring(0, 120)}{snap.content.length > 120 ? '...' : ''}
                      </p>

                      {/* Restore button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestore(snap);
                        }}
                        className="w-full py-1.5 text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#B8B8B8] border border-[#B8B8B8]/20 hover:border-[#B8B8B8]/60 hover:bg-[#B8B8B8]/10 rounded transition-all"
                      >
                        Restore This Version
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto p-5 border-t border-zinc-800/60 bg-[#0c0c0c] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
            <span className="material-symbols-outlined text-emerald-400 text-sm">verified</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-widest font-['Inter']">Audit Trail</span>
            <span className="text-[11px] text-zinc-500 italic font-['Inter']">All changes are persisted to Supabase.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
