import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const ignoredDirs = new Set([
  '.git',
  '.next',
  '.pytest_cache',
  '__pycache__',
  'node_modules',
])
const scannedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
])

const corruptionPattern = /\[([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\]\(https?:\/\/\1\)/g
const findings = []

function scanFile(filePath) {
  const ext = path.extname(filePath)
  if (!scannedExtensions.has(ext)) return

  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return
  }
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    corruptionPattern.lastIndex = 0
    let match
    while ((match = corruptionPattern.exec(line)) !== null) {
      findings.push({
        filePath,
        lineNumber: index + 1,
        snippet: match[0],
      })
    }
  }
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue

    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(entryPath)
      continue
    }

    let stats
    try {
      stats = statSync(entryPath)
    } catch {
      continue
    }

    if (entry.isFile() && stats.size <= 2_000_000) {
      scanFile(entryPath)
    }
  }
}

walk(repoRoot)

if (findings.length > 0) {
  console.error('Markdown-link corruption detected in codebase:')
  for (const finding of findings) {
    console.error(
      `${path.relative(repoRoot, finding.filePath)}:${finding.lineNumber}: ${finding.snippet}`
    )
  }
  process.exit(1)
}

console.log('No markdown-link method/property corruption found.')
