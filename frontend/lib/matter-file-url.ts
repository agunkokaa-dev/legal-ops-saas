const MATTER_FILES_BUCKET = 'matter-files'

function encodeStoragePath(path: string) {
  return path
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment))
      } catch {
        return encodeURIComponent(segment)
      }
    })
    .join('/')
}

export function resolveMatterFileUrl(fileUrl: string | null | undefined) {
  if (!fileUrl) {
    return ''
  }

  const normalizedFileUrl = fileUrl.trim()
  if (!normalizedFileUrl) {
    return ''
  }

  if (
    normalizedFileUrl.startsWith('http://') ||
    normalizedFileUrl.startsWith('https://') ||
    normalizedFileUrl.startsWith('//') ||
    normalizedFileUrl.startsWith('/') ||
    normalizedFileUrl.startsWith('blob:') ||
    normalizedFileUrl.startsWith('data:')
  ) {
    return normalizedFileUrl
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!supabaseUrl) {
    return normalizedFileUrl
  }

  return `${supabaseUrl}/storage/v1/object/public/${MATTER_FILES_BUCKET}/${encodeStoragePath(normalizedFileUrl)}`
}
