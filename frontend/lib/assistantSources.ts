export type AssistantSourceType = 'law' | 'playbook' | 'document'

export interface AssistantSource {
    type: AssistantSourceType
    identifier: string
    identifier_full?: string
    short_name?: string
    law_type?: string
    number?: string
    year?: number
    body: string
    official_source_url?: string | null
    relevance_score?: number | null
    contract_id?: string
    file_name?: string
    page_reference?: string | null
    category?: string | null
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asOptionalString(value: unknown): string | undefined {
    const cleaned = asString(value).trim()
    return cleaned || undefined
}

function asOptionalNullableString(value: unknown): string | null | undefined {
    const cleaned = asString(value).trim()
    return cleaned || null
}

function asOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return undefined
}

function asOptionalScore(value: unknown): number | null | undefined {
    const parsed = asOptionalNumber(value)
    if (parsed == null) return null
    return parsed
}

function normalizeSourceRecord(record: Record<string, unknown>): AssistantSource | null {
    const recordType = asString(record.type).trim().toLowerCase()
    const body = asString(record.body || record.body_snippet || record.rule_text).trim()

    if (recordType === 'law' || recordType === 'playbook' || recordType === 'document') {
        const identifier = asOptionalString(record.identifier)
            || asOptionalString(record.identifier_full)
            || asOptionalString(record.file_name)
            || 'Source'

        return {
            type: recordType,
            identifier,
            identifier_full: asOptionalString(record.identifier_full),
            short_name: asOptionalString(record.short_name),
            law_type: asOptionalString(record.law_type),
            number: asOptionalString(record.number),
            year: asOptionalNumber(record.year),
            body,
            official_source_url: asOptionalNullableString(record.official_source_url),
            relevance_score: asOptionalScore(record.relevance_score),
            contract_id: asOptionalString(record.contract_id),
            file_name: asOptionalString(record.file_name),
            page_reference: asOptionalNullableString(record.page_reference),
            category: asOptionalNullableString(record.category),
        }
    }

    const contractId = asOptionalString(record.contract_id)
    const fileName = asOptionalString(record.file_name)
    if (contractId || fileName) {
        const label = fileName || contractId || 'Dokumen Kontrak'
        return {
            type: 'document',
            identifier: `Kontrak — ${label}`,
            identifier_full: `Kontrak — ${label}`,
            body,
            official_source_url: null,
            contract_id: contractId,
            file_name: fileName,
            relevance_score: asOptionalScore(record.relevance_score),
        }
    }

    return null
}

export function normalizeAssistantSources(value: unknown): AssistantSource[] {
    if (!Array.isArray(value)) return []

    const deduped = new Map<string, AssistantSource>()
    for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const normalized = normalizeSourceRecord(item as Record<string, unknown>)
        if (!normalized) continue

        const key = [
            normalized.type,
            normalized.contract_id || '',
            normalized.identifier_full || normalized.identifier,
            normalized.body.slice(0, 80),
        ].join('::')

        if (!deduped.has(key)) {
            deduped.set(key, normalized)
        }
    }

    return Array.from(deduped.values())
}

export function resolveDocumentSourceId(
    sources: AssistantSource[] | undefined,
    linkText: string,
    href: string,
): string {
    let targetId = linkText

    if (href.includes('/dashboard/contracts/')) {
        targetId = href.split('/dashboard/contracts/')[1] || linkText
    } else if (href.includes('/dashboard/documents/')) {
        targetId = href.split('/dashboard/documents/')[1] || linkText
    }

    const matchedSource = sources?.find((source) =>
        source.type === 'document' && (
            source.file_name === linkText
            || source.contract_id === targetId
            || source.contract_id === linkText
        )
    )

    return matchedSource?.contract_id || targetId
}
