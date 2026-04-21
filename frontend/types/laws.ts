export type LawSearchFilter = {
  category?: string
  law_short?: string
  contract_relevance?: 'high' | 'medium' | 'low'
  contract_type?: string
}

export type LawSearchContext = {
  source_type?: string
  title?: string | null
  impact_analysis?: string | null
  v1_text?: string | null
  v2_text?: string | null
  severity?: string | null
  playbook_violation?: string | null
}

export type LawSearchResult = {
  node_id: string
  law_short: string
  law_full_name: string
  identifier_full: string
  body_snippet: string
  category: string
  legal_status: string
  is_currently_citable: boolean
  effective_from?: string | null
  effective_to?: string | null
  legal_status_notes?: string | null
  legal_status_source_url?: string | null
  verification_status: 'unreviewed' | 'human_verified' | 'human_rejected' | string
  human_verified_at?: string | null
  confidence_score: number
  confidence_label: 'abstain' | 'warning' | 'high'
  warning_note?: string | null
  retrieval_path?: 'citation' | 'graph' | 'semantic' | null
  reference_type?: 'direct' | 'conditional' | 'implementing' | null
  reference_context?: string | null
}

export type LawSearchResponse = {
  intent: 'citation' | 'filter_heavy' | 'conceptual'
  query: string
  effective_as_of: string
  resolved_query_category?: string | null
  results: LawSearchResult[]
  corpus_status: {
    total_laws_in_corpus: number
    category_coverage: Record<string, any>
    query_coverage_note?: string | null
  }
}

export type CitationLookupResponse = {
  query_text: string
  parsed_citation: Record<string, any>
  resolution_status: 'resolved' | 'not_found' | 'ambiguous' | 'not_currently_citable'
  resolution_note?: string | null
  effective_as_of: string
  results: LawSearchResult[]
}

export type LawDetailResponse = {
  node_id: string
  law: {
    id: string
    short_name: string
    full_name: string
    category: string
    official_source_url?: string | null
  }
  version: {
    id: string
    version_number: number
    effective_from?: string | null
    effective_to?: string | null
  }
  hierarchy: Array<{
    id: string
    node_type: string
    identifier?: string | null
    heading?: string | null
  }>
  body?: string | null
  siblings: Array<{
    id: string
    identifier?: string | null
    body?: string | null
    legal_status?: string | null
    verification_status?: string | null
  }>
  legal_status: string
  is_currently_citable: boolean
  effective_from?: string | null
  effective_to?: string | null
  legal_status_notes?: string | null
  legal_status_source_url?: string | null
  verification_status: 'unreviewed' | 'human_verified' | 'human_rejected' | string
  human_verified_at?: string | null
}

export type LawsCatalogResponse = {
  laws: Array<Record<string, any>>
  coverage: Array<Record<string, any>>
}

export type CoverageResponse = {
  total_laws_in_corpus: number
  category_coverage: Record<string, any>
  query_coverage_note?: string | null
}
