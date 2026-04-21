export type CitationHint = {
  rawText: string
  isCompleteCitation: boolean
  confidence: 'high' | 'low'
}

const COMPLETE_CITATION_PATTERN =
  /\b(?:(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?:No\.?\s*)?(?:[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*|\d+(?:\/|\s+Tahun\s+)\d{4})\s+)?Pasal\s+\d+[A-Za-z]?(?:\s+ayat\s+\(\d+[A-Za-z]?\))?(?:\s+huruf\s+[a-z])?(?:\s+(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?:No\.?\s*)?(?:[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*|\d+(?:\/|\s+Tahun\s+)\d{4}))?/g

const LAW_REFERENCE_PATTERN =
  /\b(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?:No\.?\s*)?(?:[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*|\d+(?:\/|\s+Tahun\s+)\d{4})\b/i

export function detectCitationHint(text: string): CitationHint | null {
  const query = (text || '').trim()
  if (!query) return null

  const match = query.match(COMPLETE_CITATION_PATTERN)?.[0]
  if (!match) return null

  const hasLawReference = LAW_REFERENCE_PATTERN.test(match)
  return {
    rawText: match,
    isCompleteCitation: hasLawReference && /Pasal\s+\d+/i.test(match),
    confidence: hasLawReference ? 'high' : 'low',
  }
}

export function splitTextWithCitationHints(text: string): Array<{ type: 'text' | 'citation'; value: string }> {
  const value = text || ''
  if (!value) return []

  const matches = Array.from(value.matchAll(new RegExp(COMPLETE_CITATION_PATTERN)))
  if (matches.length === 0) {
    return [{ type: 'text', value }]
  }

  const parts: Array<{ type: 'text' | 'citation'; value: string }> = []
  let cursor = 0
  for (const match of matches) {
    const index = match.index ?? 0
    const raw = match[0]
    if (index > cursor) {
      parts.push({ type: 'text', value: value.slice(cursor, index) })
    }
    parts.push({ type: 'citation', value: raw })
    cursor = index + raw.length
  }
  if (cursor < value.length) {
    parts.push({ type: 'text', value: value.slice(cursor) })
  }
  return parts
}
