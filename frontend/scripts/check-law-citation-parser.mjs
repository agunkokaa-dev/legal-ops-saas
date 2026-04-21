import fs from 'node:fs'
import path from 'node:path'

const fixturePath = path.resolve(process.cwd(), '..', 'testdata', 'law_citation_cases.json')
const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

const completeCitationPattern =
  /\b(?:(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?:No\.?\s*)?(?:[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*|\d+(?:\/|\s+Tahun\s+)\d{4})\s+)?Pasal\s+\d+[A-Za-z]?(?:\s+ayat\s+\(\d+[A-Za-z]?\))?(?:\s+huruf\s+[a-z])?(?:\s+(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?:No\.?\s*)?(?:[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*|\d+(?:\/|\s+Tahun\s+)\d{4}))?/g
const lawReferencePattern =
  /\b(?:UU|PP|Perpres|Permen|POJK|Perda)\s+(?:No\.?\s*)?(?:[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*|\d+(?:\/|\s+Tahun\s+)\d{4})\b/i

function detectCitationHint(text) {
  const query = (text || '').trim()
  if (!query) return null
  const match = query.match(completeCitationPattern)?.[0]
  if (!match) return null
  return {
    isCompleteCitation: lawReferencePattern.test(match) && /Pasal\s+\d+/i.test(match),
  }
}

const failures = []
for (const fixture of cases) {
  const parsed = detectCitationHint(fixture.text)
  const isComplete = Boolean(parsed?.isCompleteCitation)
  if (isComplete !== fixture.expect_complete) {
    failures.push({ text: fixture.text, expected: fixture.expect_complete, actual: isComplete })
  }
}

if (failures.length) {
  console.error(JSON.stringify({ failures }, null, 2))
  process.exit(1)
}

console.log(`Law citation fixture check passed for ${cases.length} case(s).`)

