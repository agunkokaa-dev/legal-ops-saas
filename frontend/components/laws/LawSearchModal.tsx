'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

import { searchLaws } from '@/app/actions/backend'
import { detectCitationHint } from '@/lib/law-citation'
import type { LawSearchFilter, LawSearchResponse, LawSearchResult } from '@/types/laws'

const CATEGORY_PILLS = [
  { label: 'All', value: undefined },
  { label: 'Data Protection', value: 'data_protection' },
  { label: 'Labor', value: 'labor' },
  { label: 'Financial', value: 'financial_services' },
  { label: 'Language', value: 'language' },
]

function resultStatusLabel(result: LawSearchResult) {
  if (result.legal_status === 'diuji_mk') return 'MK Review'
  if (result.legal_status === 'sebagian_dicabut') return 'Partial Revocation'
  if (result.legal_status === 'dicabut') return 'Revoked'
  if (result.legal_status === 'diubah') return 'Amended'
  return 'In Force'
}

export default function LawSearchModal({
  isOpen,
  initialQuery,
  initialFilters,
  onClose,
  onOpenResult,
  onResolvedCategory,
}: {
  isOpen: boolean
  initialQuery?: string
  initialFilters?: LawSearchFilter
  onClose: () => void
  onOpenResult: (nodeId: string) => Promise<void>
  onResolvedCategory?: (category?: string | null) => void
}) {
  const [query, setQuery] = useState(initialQuery || '')
  const [filters, setFilters] = useState<LawSearchFilter | undefined>(initialFilters)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<LawSearchResponse | null>(null)

  const citationHint = useMemo(() => detectCitationHint(query), [query])

  useEffect(() => {
    if (!isOpen) return
    setQuery(initialQuery || '')
    setFilters(initialFilters)
    setError(null)
  }, [initialFilters, initialQuery, isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (query.trim().length < 3) {
      setResponse(null)
      setError(null)
      return
    }

    const timer = window.setTimeout(async () => {
      setLoading(true)
      const result = await searchLaws(query, filters, undefined, 10)
      setLoading(false)
      if (!result.success || !result.data) {
        setError(result.error || 'Unable to search regulations right now.')
        setResponse(null)
        return
      }
      setError(null)
      const payload = result.data as LawSearchResponse
      setResponse(payload)
      onResolvedCategory?.(payload.resolved_query_category)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [filters, isOpen, onResolvedCategory, query])

  const coverageCopy = useMemo(() => {
    if (!response?.corpus_status) return null
    const totalCategories = Object.keys(response.corpus_status.category_coverage || {}).length
    return {
      summary: `${response.corpus_status.total_laws_in_corpus} law(s) active · ${totalCategories} categories planned`,
      note: response.corpus_status.query_coverage_note || 'Coverage is surfaced from the canonical corpus and may still be in progress for some categories.',
    }
  }, [response])

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm p-3 md:p-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0d11] shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-white/10 px-5 py-4 md:px-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="material-symbols-outlined text-zinc-400">search</span>
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search regulations..."
                    className="w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-zinc-400 transition hover:border-white/20 hover:text-white"
                >
                  Esc
                </button>
              </div>
              {citationHint?.isCompleteCitation ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-amber-300">
                  Citation Mode Detected
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px]">
                    {citationHint.rawText}
                  </span>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {CATEGORY_PILLS.map((pill) => {
                  const active = (filters?.category || undefined) === pill.value
                  return (
                    <button
                      key={pill.label}
                      onClick={() => setFilters((current) => ({
                        ...current,
                        category: pill.value,
                      }))}
                      className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
                        active
                          ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#f4d884]'
                          : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {pill.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6 md:py-6">
              {coverageCopy ? (
                <div className="mb-5 rounded-2xl border border-[#d4af37]/15 bg-[linear-gradient(135deg,rgba(212,175,55,0.12),rgba(17,17,17,0.7))] p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[#d4af37]">Coverage</p>
                  <p className="mt-2 text-sm text-white">{coverageCopy.summary}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{coverageCopy.note}</p>
                </div>
              ) : null}

              {loading ? (
                <div className="flex h-40 items-center justify-center text-sm text-zinc-400">Searching…</div>
              ) : error ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
              ) : response?.results?.length ? (
                <div className="space-y-3">
                  {response.results.map((result) => (
                    <button
                      key={result.node_id}
                      onClick={async () => {
                        onClose()
                        await onOpenResult(result.node_id)
                      }}
                      className="block w-full rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-left transition hover:border-white/15 hover:bg-white/[0.04]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-white">{result.law_short} · {result.identifier_full}</span>
                            {result.verification_status === 'human_verified' ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-300">Verified</span>
                            ) : null}
                            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                              {resultStatusLabel(result)}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">{result.law_full_name}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${
                          result.confidence_label === 'high'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}>
                          {result.confidence_label === 'high' ? 'High Relevance' : 'Needs Review'}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{result.body_snippet}</p>
                      {(result.warning_note || result.legal_status_notes) ? (
                        <p className="mt-3 text-xs leading-relaxed text-amber-200">{result.warning_note || result.legal_status_notes}</p>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : query.trim().length >= 3 ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                  <p className="text-sm text-white">No results.</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {response?.corpus_status?.query_coverage_note || 'Try another keyword or check the current coverage status.'}
                  </p>
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
                  Start with a citation or a concept query.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
