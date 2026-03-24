// =====================================================
// Version History & Audit Trail — Type Definitions
// =====================================================

export interface RevisionSnapshot {
  version_id: string;       // Unique key, e.g. Date.now().toString()
  timestamp: string;        // ISO 8601 for display
  actor: 'User' | 'AI LangGraph' | 'AI Clause Assistant';
  action_type: 'Manual Save' | 'Compliance Audit' | 'Clause Insertion' | 'Restored';
  content: string;          // Full draft text snapshot
}

export interface DraftRevisionsPayload {
  latest_text: string;
  history: RevisionSnapshot[];
}
