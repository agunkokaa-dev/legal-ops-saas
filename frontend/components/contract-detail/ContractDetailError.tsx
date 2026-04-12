'use client'

import { useEffect } from 'react'

export default function ContractDetailError({ message }: { message: string }) {
    useEffect(() => {
        console.error("Detail Fetch Error:", message)
    }, [message])

    return (
        <div className="h-full flex items-center justify-center text-text-muted">
            {message}
        </div>
    )
}
