"use client";

import React from "react";

export interface ClauseSyncIndicatorProps {
  status: 'synced' | 'out_of_sync' | 'needs_review' | 'ai_pending';
  lastSyncedAt: string | null;
  onSyncRequest: () => void;
  isLoading: boolean;
}

export default function ClauseSyncIndicator({ status, lastSyncedAt, onSyncRequest, isLoading }: ClauseSyncIndicatorProps) {
  let indicatorColor = "";
  let label = "";
  let pulse = false;
  let isActionable = false;

  if (isLoading || status === 'ai_pending') {
    indicatorColor = "bg-blue-500";
    label = "AI Translating...";
    pulse = true;
  } else if (status === 'synced') {
    indicatorColor = "bg-green-500";
    label = "Synced";
  } else if (status === 'out_of_sync') {
    indicatorColor = "bg-amber-500";
    label = "Out of Sync";
    pulse = true;
    isActionable = true;
  } else if (status === 'needs_review') {
    indicatorColor = "bg-red-500";
    label = "Needs Review";
    isActionable = true;
  }

  const tooltipText = lastSyncedAt ? `Last synced: ${new Date(lastSyncedAt).toLocaleString()}` : "Not yet synced";

  return (
    <div className="flex items-center space-x-2 text-sm text-gray-400 group relative">
      <div className="flex items-center space-x-1.5" title={tooltipText}>
        <div className={`w-2 h-2 rounded-full ${indicatorColor} ${pulse ? "animate-pulse" : ""}`}></div>
        <span>{label}</span>
      </div>
      
      {isActionable && (
        <button
          onClick={onSyncRequest}
          disabled={isLoading}
          className="ml-2 px-2 py-0.5 text-xs bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded hover:bg-amber-500/20 hover:text-amber-400 disabled:opacity-50 transition-colors"
        >
          Auto-Sync
        </button>
      )}

      <div className="absolute bottom-full mb-1 hidden group-hover:block w-max bg-gray-800 text-xs text-gray-200 px-2 py-1 rounded border border-gray-700 shadow-xl z-10">
        {tooltipText}
      </div>
    </div>
  );
}
