import 'server-only'

const DEFAULT_SERVER_API_BASE = 'http://127.0.0.1:8000'

export function getServerApiBase() {
  const configuredBase = process.env.FASTAPI_INTERNAL_URL?.trim()

  if (!configuredBase) {
    return DEFAULT_SERVER_API_BASE
  }

  return configuredBase.replace(/\/+$/, '') || DEFAULT_SERVER_API_BASE
}
