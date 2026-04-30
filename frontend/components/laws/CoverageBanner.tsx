'use client'

import { useEffect, useMemo, useState } from 'react'

import { getLawCoverage } from '@/app/actions/backend'

function resolveCategory(matterType?: string | null, practiceArea?: string | null, sessionCategory?: string | null) {
  const normalizedMatterType = (matterType || '').toLowerCase()
  const normalizedPracticeArea = (practiceArea || '').toLowerCase()

  if (normalizedMatterType.includes('privacy') || normalizedMatterType.includes('data')) return 'data_protection'
  if (normalizedMatterType.includes('employment') || normalizedMatterType.includes('labor')) return 'labor'
  if (normalizedMatterType.includes('finance') || normalizedMatterType.includes('bank')) return 'financial_services'
  if (normalizedMatterType.includes('language') || normalizedMatterType.includes('bahasa')) return 'language'
  if (normalizedMatterType.includes('corporate') || normalizedMatterType.includes('business')) return 'general_business'

  if (normalizedPracticeArea.includes('privacy') || normalizedPracticeArea.includes('data')) return 'data_protection'
  if (normalizedPracticeArea.includes('employment') || normalizedPracticeArea.includes('labor')) return 'labor'
  if (normalizedPracticeArea.includes('finance') || normalizedPracticeArea.includes('bank')) return 'financial_services'
  if (normalizedPracticeArea.includes('language') || normalizedPracticeArea.includes('bahasa')) return 'language'
  if (normalizedPracticeArea.includes('corporate') || normalizedPracticeArea.includes('business')) return 'general_business'

  return sessionCategory || null
}

export default function CoverageBanner({
  matterId,
  matterType,
  practiceArea,
}: {
  matterId: string
  matterType?: string | null
  practiceArea?: string | null
}) {
  const [coverage, setCoverage] = useState<Record<string, any> | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [sessionCategory, setSessionCategory] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void getLawCoverage().then((result) => {
      if (!mounted || !result.success || !result.data) return
      setCoverage(result.data.category_coverage || null)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    setSessionCategory(window.sessionStorage.getItem(`laws:last-category:${matterId}`))

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ matterId?: string; category?: string }>
      if (customEvent.detail?.matterId === matterId && customEvent.detail?.category) {
        setSessionCategory(customEvent.detail.category)
      }
    }

    window.addEventListener('laws:resolved-category', handler as EventListener)
    return () => window.removeEventListener('laws:resolved-category', handler as EventListener)
  }, [matterId])

  const resolvedCategory = useMemo(
    () => resolveCategory(matterType, practiceArea, sessionCategory),
    [matterType, practiceArea, sessionCategory],
  )

  const categoryCoverage = resolvedCategory && coverage ? coverage[resolvedCategory] : null
  const dismissKey = useMemo(() => {
    if (!matterId || !resolvedCategory || !categoryCoverage?.last_reviewed_at) return null
    return `coverage-banner:${matterId}:${resolvedCategory}:${categoryCoverage.last_reviewed_at}`
  }, [categoryCoverage?.last_reviewed_at, matterId, resolvedCategory])

  useEffect(() => {
    if (!dismissKey || typeof window === 'undefined') {
      setDismissed(false)
      return
    }
    setDismissed(window.localStorage.getItem(dismissKey) === 'dismissed')
  }, [dismissKey])

  if (!resolvedCategory || !categoryCoverage || categoryCoverage.coverage_level !== 'in_progress' || dismissed) {
    return null
  }

  return (
    <div className="mb-5 rounded-2xl border border-[#2A2A2A] bg-[#1C1C1C] px-4 py-3 text-sm text-[#E8E8E8]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#B8B8B8]">Coverage Notice</p>
          <p className="mt-2">
            The regulation dataset for {categoryCoverage.category_label_en || resolvedCategory} is still in development.
            {' '}
            {categoryCoverage.ingested_laws} of {categoryCoverage.total_planned_laws} planned law(s) are currently in the corpus.
          </p>
          {categoryCoverage.coverage_notes ? (
            <p className="mt-1 text-xs text-[#E8E8E8]/80">{categoryCoverage.coverage_notes}</p>
          ) : null}
        </div>
        <button
          onClick={() => {
            if (dismissKey && typeof window !== 'undefined') {
              window.localStorage.setItem(dismissKey, 'dismissed')
            }
            setDismissed(true)
          }}
          className="rounded-full border border-[#2A2A2A] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#D4D4D4] transition hover:border-[#3A3A3A] hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
