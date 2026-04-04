export type ClauseSyncStatus = 'synced' | 'out_of_sync' | 'needs_review' | 'ai_pending';

export interface BilingualClause {
  id: string;
  contract_id: string;
  clause_number: string;
  id_text: string;
  en_text: string | null;
  sync_status: ClauseSyncStatus;
  last_synced_at: string | null;
  edited_language: 'id' | 'en' | null;
}

export interface ClauseSyncResponse {
  suggested_translation: string;
  confidence_score: number;
  legal_notes: string;
}
