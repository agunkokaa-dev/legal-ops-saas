'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getOnboardingStatus } from '@/app/actions/onboarding'
import { SampleBanner } from './SampleBanner'

export function SampleDataGate() {
    const pathname = usePathname()
    const router = useRouter()
    const [hasSamples, setHasSamples] = useState(false)

    const isSupportedPage = pathname === '/dashboard' || pathname?.startsWith('/dashboard/documents')

    const refreshStatus = useCallback(async () => {
        if (!isSupportedPage) {
            setHasSamples(false)
            return
        }

        const result = await getOnboardingStatus()
        setHasSamples(result.success ? result.data.has_samples : false)
    }, [isSupportedPage])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshStatus()
        }, 0)
        return () => window.clearTimeout(timer)
    }, [refreshStatus])

    useEffect(() => {
        const handleSamplesChanged = () => {
            void refreshStatus()
        }
        window.addEventListener('onboarding:samples-changed', handleSamplesChanged)
        return () => window.removeEventListener('onboarding:samples-changed', handleSamplesChanged)
    }, [refreshStatus])

    if (!isSupportedPage || !hasSamples) {
        return null
    }

    return (
        <SampleBanner
            onCleared={() => {
                setHasSamples(false)
                window.dispatchEvent(new Event('onboarding:samples-changed'))
                router.refresh()
            }}
        />
    )
}
