'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'

import { citationLookup, getPasalDetail } from '@/app/actions/backend'
import LawSearchModal from '@/components/laws/LawSearchModal'
import PasalDetailPanel from '@/components/laws/PasalDetailPanel'
import type { LawDetailResponse, LawSearchFilter } from '@/types/laws'

type SearchOpenOptions = {
  initialQuery?: string
  initialFilters?: LawSearchFilter
}

type LawsUIContextValue = {
  openSearch: (options?: SearchOpenOptions) => void
  closeSearch: () => void
  openNodeDetail: (nodeId: string) => Promise<void>
  openCitationText: (text: string) => Promise<void>
}

const LawsUIContext = createContext<LawsUIContextValue | null>(null)

function extractMatterId(pathname: string): string | null {
  const match = pathname.match(/\/dashboard\/matters\/([^/?#]+)/)
  return match?.[1] || null
}

export function LawsUIProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [initialQuery, setInitialQuery] = useState('')
  const [initialFilters, setInitialFilters] = useState<LawSearchFilter | undefined>(undefined)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<LawDetailResponse | null>(null)

  const activeMatterId = extractMatterId(pathname)

  const recordResolvedCategory = useCallback((category?: string | null) => {
    if (!category || !activeMatterId || typeof window === 'undefined') return
    window.sessionStorage.setItem(`laws:last-category:${activeMatterId}`, category)
    window.dispatchEvent(new CustomEvent('laws:resolved-category', {
      detail: {
        matterId: activeMatterId,
        category,
      },
    }))
  }, [activeMatterId])

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false)
  }, [])

  const openSearch = useCallback((options?: SearchOpenOptions) => {
    setInitialQuery(options?.initialQuery || '')
    setInitialFilters(options?.initialFilters)
    setIsSearchOpen(true)
  }, [])

  const openNodeDetail = useCallback(async (nodeId: string) => {
    setDetailLoading(true)
    setDetailError(null)
    setDetailOpen(true)
    const response = await getPasalDetail(nodeId)
    if (!response.success || !response.data) {
      setDetailError(response.error || 'Unable to load legal provision detail.')
      setDetailLoading(false)
      return
    }

    setDetail(response.data as LawDetailResponse)
    setDetailLoading(false)
  }, [])

  const openCitationText = useCallback(async (text: string) => {
    const response = await citationLookup(text)
    if (!response.success || !response.data) {
      toast.error(response.error || 'Unable to resolve the citation.')
      openSearch({ initialQuery: text })
      return
    }

    const data = response.data as { resolution_status: string; resolution_note?: string; results: Array<{ node_id: string }> }
    if (data.resolution_status === 'resolved' && data.results?.[0]?.node_id) {
      await openNodeDetail(data.results[0].node_id)
      return
    }

    if (data.resolution_note) {
      toast.error(data.resolution_note)
    }
    openSearch({ initialQuery: text })
  }, [openNodeDetail, openSearch])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

  const value = useMemo<LawsUIContextValue>(() => ({
    openSearch,
    closeSearch,
    openNodeDetail,
    openCitationText,
  }), [closeSearch, openCitationText, openNodeDetail, openSearch])

  return (
    <LawsUIContext.Provider value={value}>
      {children}
      <LawSearchModal
        isOpen={isSearchOpen}
        initialQuery={initialQuery}
        initialFilters={initialFilters}
        onClose={closeSearch}
        onOpenResult={openNodeDetail}
        onResolvedCategory={recordResolvedCategory}
      />
      <PasalDetailPanel
        isOpen={detailOpen}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setDetailOpen(false)}
        onOpenCitationText={openCitationText}
        onOpenNodeDetail={openNodeDetail}
      />
    </LawsUIContext.Provider>
  )
}

export function useLawsUI() {
  const context = useContext(LawsUIContext)
  if (!context) {
    throw new Error('useLawsUI must be used within a LawsUIProvider')
  }
  return context
}
