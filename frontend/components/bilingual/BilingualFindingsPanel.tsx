"use client";

import React from "react";
import { XCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

interface Finding {
  clause_id: string;
  id_clause_text: string;
  en_clause_text?: string;
  divergence_type: string;
  severity: "critical" | "warning" | "info";
  explanation: string;
  suggested_correction_language: "id" | "en" | "both";
}

interface Report {
  findings: Finding[];
  overall_consistency_score: number;
  id_version_complete: boolean;
  en_version_complete: boolean;
  legally_compliant: boolean;
  compliance_notes: string;
}

interface BilingualFindingsPanelProps {
  report: Report | null;
  isLoading: boolean;
  onClose: () => void;
  onFocusClause: (clauseId: string) => void;
}

export default function BilingualFindingsPanel({ report, isLoading, onClose, onFocusClause }: BilingualFindingsPanelProps) {
  if (isLoading) {
    return (
      <div className="fixed right-0 top-0 w-96 h-screen bg-[#111111] border-l border-gray-800 shadow-2xl flex flex-col z-50 animate-in slide-in-from-right">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">Consistency Audit</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 text-sm">Analyzing semantic equivalence across dual languages...</p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="fixed right-0 top-0 w-[400px] h-screen bg-[#111111] border-l border-gray-800 shadow-2xl flex flex-col z-50 animate-in slide-in-from-right">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#1a1a1a]">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            Consistency Report
            {report.legally_compliant ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            )}
          </h2>
          <div className="text-xs text-gray-400 mt-1">Score: {(report.overall_consistency_score * 100).toFixed(0)}%</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition p-1">
          <XCircle className="w-6 h-6" />
        </button>
      </div>
      
      <div className="overflow-y-auto flex-1 p-4 space-y-6">
        <div className="bg-gray-900 rounded p-3 text-sm text-gray-300 border border-gray-800">
          <div className="font-semibold text-gray-200 mb-1">Audit Summary</div>
          {report.compliance_notes}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Identified Divergences</h3>
          {report.findings.length === 0 ? (
            <div className="text-center py-8 text-gray-500 bg-gray-900 rounded border border-gray-800 border-dashed">
              No critical consistency issues found.
            </div>
          ) : (
            <div className="space-y-4">
              {report.findings.map((f, i) => (
                <div key={i} className="bg-[#1a1a1a] rounded-lg border border-gray-800 p-4 space-y-2 relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${f.severity === 'critical' ? 'bg-red-500' : f.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                  <div className="flex justify-between items-start">
                    <span className={`text-xs font-bold uppercase tracking-wider ${f.severity === 'critical' ? 'text-red-400' : f.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'}`}>
                      {f.severity}
                    </span>
                    <button 
                      onClick={() => onFocusClause(f.clause_id)}
                      className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition"
                    >
                      View Clause
                    </button>
                  </div>
                  <div className="text-sm font-medium text-gray-200">{f.divergence_type}</div>
                  <p className="text-sm text-gray-400">{f.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
