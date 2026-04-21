'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { splitTextWithCitationHints } from '@/lib/law-citation'
import type { LawDetailResponse } from '@/types/laws'

function statusTone(detail: LawDetailResponse | null) {
  if (!detail) return 'text-zinc-300 border-white/10 bg-white/[0.03]'
  if (detail.legal_status === 'diuji_mk') return 'text-amber-200 border-amber-500/30 bg-amber-500/10'
  if (detail.legal_status === 'sebagian_dicabut') return 'text-amber-200 border-amber-500/30 bg-amber-500/10'
  if (detail.legal_status === 'dicabut') return 'text-rose-200 border-rose-500/30 bg-rose-500/10'
  return 'text-emerald-200 border-emerald-500/30 bg-emerald-500/10'
}

function formatStatusTitle(detail: LawDetailResponse | null) {
  if (!detail) return 'Status'
  switch (detail.legal_status) {
    case 'diuji_mk':
      return 'Under MK Review'
    case 'sebagian_dicabut':
      return 'Partially Revoked'
    case 'dicabut':
      return 'Revoked'
    case 'diubah':
      return 'Amended'
    default:
      return detail.is_currently_citable ? 'In Force' : 'Not Currently Citable'
  }
}

export default function PasalDetailPanel({
  isOpen,
  detail,
  loading,
  error,
  onClose,
  onOpenCitationText,
  onOpenNodeDetail,
}: {
  isOpen: boolean
  detail: LawDetailResponse | null
  loading: boolean
  error: string | null
  onClose: () => void
  onOpenCitationText: (text: string) => Promise<void>
  onOpenNodeDetail: (nodeId: string) => Promise<void>
}) {
  const [showRelated, setShowRelated] = useState(false)
  const breadcrumb = useMemo(() => detail?.hierarchy || [], [detail])
  const bodyParts = useMemo(() => splitTextWithCitationHints(detail?.body || ''), [detail?.body])

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] bg-black/55"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-white/10 bg-[#090c10] shadow-[0_24px_80px_rgba(0,0,0,0.5)] md:w-[720px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Regulatory Detail</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{detail?.law.short_name || 'Loading…'}</h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400 transition hover:border-white/20 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 md:p-6">
              {loading ? (
                <div className="flex h-40 items-center justify-center text-sm text-zinc-400">Loading legal detail…</div>
              ) : error ? (
                <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
              ) : detail ? (
                <div className="space-y-5">
                  <div className={`rounded-2xl border p-4 ${statusTone(detail)}`}>
                    <p className="text-[11px] uppercase tracking-[0.24em]">Status: {formatStatusTitle(detail)}</p>
                    <p className="mt-2 text-sm">
                      In force from {detail.effective_from || 'unknown'}
                      {detail.effective_to ? ` until ${detail.effective_to}` : ''}
                    </p>
                    {detail.human_verified_at ? (
                      <p className="mt-1 text-xs text-white/70">Human verified at {detail.human_verified_at}</p>
                    ) : (
                      <p className="mt-1 text-xs text-white/70">Human legal verification pending.</p>
                    )}
                    {detail.legal_status_notes ? (
                      <p className="mt-3 text-sm leading-relaxed">{detail.legal_status_notes}</p>
                    ) : null}
                    {detail.legal_status_source_url ? (
                      <a
                        href={detail.legal_status_source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex text-xs uppercase tracking-[0.2em] underline underline-offset-4"
                      >
                        View status source
                      </a>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      {breadcrumb.map((item, index) => (
                        <button
                          key={item.id}
                          onClick={() => void onOpenNodeDetail(item.id)}
                          className="rounded-full bg-white/[0.03] px-2.5 py-1 transition hover:bg-white/[0.08] hover:text-white"
                        >
                          {item.identifier || item.heading || item.node_type}
                          {index < breadcrumb.length - 1 ? ' /' : ''}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <div className="prose prose-invert max-w-none text-sm leading-8 text-zinc-200">
                      <p>
                        {bodyParts.map((part, index) => part.type === 'citation' ? (
                          <button
                            key={`${part.value}-${index}`}
                            onClick={() => void onOpenCitationText(part.value)}
                            className="rounded-full bg-[#d4af37]/12 px-2 py-0.5 text-left text-[#f4d884] transition hover:bg-[#d4af37]/20"
                          >
                            {part.value}
                          </button>
                        ) : (
                          <span key={`${part.value}-${index}`}>{part.value}</span>
                        ))}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={async () => {
                        const citation = `${detail.law.short_name}, ${detail.hierarchy[detail.hierarchy.length - 1]?.identifier || detail.node_id}`
                        await navigator.clipboard.writeText(citation)
                      }}
                      className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-300 transition hover:border-white/20 hover:text-white"
                    >
                      Copy Citation
                    </button>
                    {detail.law.official_source_url ? (
                      <a
                        href={detail.law.official_source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-300 transition hover:border-white/20 hover:text-white"
                      >
                        View Official Source
                      </a>
                    ) : null}
                    <button
                      onClick={() => setShowRelated((current) => !current)}
                      className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-300 transition hover:border-white/20 hover:text-white"
                    >
                      View Articles In This Chapter
                    </button>
                  </div>

                  {showRelated ? (
                    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Related Nodes</p>
                      <div className="mt-3 space-y-2">
                        {detail.siblings.length ? detail.siblings.map((sibling) => (
                          <button
                            key={sibling.id}
                            onClick={() => void onOpenNodeDetail(sibling.id)}
                            className="block w-full rounded-xl border border-white/8 px-3 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.04]"
                          >
                            <p className="text-sm text-white">{sibling.identifier || sibling.id}</p>
                            {sibling.body ? <p className="mt-1 text-xs text-zinc-400">{sibling.body.slice(0, 140)}</p> : null}
                          </button>
                        )) : (
                          <p className="text-sm text-zinc-500">No sibling nodes are available for this article.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

