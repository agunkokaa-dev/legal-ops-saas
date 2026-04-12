const DEFAULT_PUBLIC_API_BASE = ''

const LEGACY_PUBLIC_API_SUFFIXES = ['/api/proxy', '/api']

function normalizePublicApiBase(value: string) {
  let normalized = value.trim().replace(/\/+$/, '')

  if (!normalized) {
    return DEFAULT_PUBLIC_API_BASE
  }

  for (const suffix of LEGACY_PUBLIC_API_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length)
      break
    }
  }

  return normalized.replace(/\/+$/, '')
}

export function getPublicApiBase() {
  return normalizePublicApiBase(process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_PUBLIC_API_BASE)
}
