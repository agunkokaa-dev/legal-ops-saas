/**
 * frontend/lib/api.ts
 * 
 * Centralized fetch wrapper for Client Components.
 * 
 * Handles:
 *   - Injecting the Clerk Authorization header
 *   - Intercepting 429 Too Many Requests globally with a toast notification
 *   - Throwing typed ApiError for consistent error handling
 * 
 * Usage:
 *   import { apiFetch } from '@/lib/api'
 *   const data = await apiFetch('/api/contracts', { token })
 */

import { toast } from 'sonner'

type ApiFetchOptions = RequestInit & {
  /** Clerk JWT from useAuth().getToken() */
  token: string | null
  /** Base URL override (defaults to NEXT_PUBLIC_API_URL) */
  baseUrl?: string
  /** If true, suppress the global 429 toast (for polling etc) */
  silentRateLimit?: boolean
}

export class ApiError extends Error {
  status: number
  retryAfter: number | null

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

export async function apiFetch<T = any>(
  path: string,
  { token, baseUrl, silentRateLimit = false, ...init }: ApiFetchOptions
): Promise<T> {
  const url = `${baseUrl ?? BASE_URL}${path}`

  const headers = new Headers(init.headers)
  headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, { ...init, headers })

  // ── 429 Rate Limit Exceeded ──
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After')
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60

    let message = 'Terlalu banyak permintaan. Silakan tunggu sebentar.'
    try {
      const body = await response.json()
      message = body.message || body.message_en || message
    } catch {
      // ignore JSON parse failure
    }

    if (!silentRateLimit) {
      toast.error(message, {
        description: `Coba lagi dalam ${retryAfter} detik.`,
        duration: Math.min(retryAfter * 1000, 10000),
        style: {
          background: '#1a1a1a',
          border: '1px solid #ef4444',
          color: '#fff',
        },
      })
    }

    throw new ApiError(message, 429, retryAfter)
  }

  // ── Generic HTTP Errors ──
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      detail = body.detail || body.message || detail
    } catch {
      // ignore JSON parse failure
    }
    throw new ApiError(detail, response.status)
  }

  // ── 204 No Content ──
  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

/**
 * Convenience wrappers
 */
export const apiGet  = <T = any>(path: string, opts: ApiFetchOptions) =>
  apiFetch<T>(path, { method: 'GET', ...opts })

export const apiPost = <T = any>(path: string, body: unknown, opts: ApiFetchOptions) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body), ...opts })

export const apiPatch = <T = any>(path: string, body: unknown, opts: ApiFetchOptions) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body), ...opts })

export const apiDelete = <T = any>(path: string, opts: ApiFetchOptions) =>
  apiFetch<T>(path, { method: 'DELETE', ...opts })
