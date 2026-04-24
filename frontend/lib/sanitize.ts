/**
 * Sanitization helpers for LLM-authored text rendered in the browser.
 *
 * These helpers preserve Markdown while removing HTML and obvious script
 * execution patterns. They are a second line of defense behind backend
 * persistence sanitization.
 */

const REMOVE_BLOCK_PATTERNS = [
    /<script[\s\S]*?<\/script\s*>/gi,
    /<style[\s\S]*?<\/style\s*>/gi,
    /<iframe[\s\S]*?<\/iframe\s*>/gi,
    /<object[\s\S]*?<\/object\s*>/gi,
    /<embed[\s\S]*?<\/embed\s*>/gi,
];

const HTML_TAG_PATTERN = /<[^>]+>/g;
const DANGEROUS_TEXT_PATTERNS = [
    /javascript\s*:\s*[^\s)"'>]+(?:\([^)]*\))?/gi,
    /data\s*:\s*text\/html[^\s"'>]*/gi,
    /vbscript\s*:\s*[^\s"'>]+/gi,
    /on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
];

export function stripHtml(text: string | null | undefined): string {
    if (!text) return '';

    let sanitized = text;
    for (const pattern of REMOVE_BLOCK_PATTERNS) {
        sanitized = sanitized.replace(pattern, '');
    }

    sanitized = sanitized.replace(HTML_TAG_PATTERN, '');
    for (const pattern of DANGEROUS_TEXT_PATTERNS) {
        sanitized = sanitized.replace(pattern, '');
    }

    return sanitized.trim();
}

export function assertSafeLlmText(
    text: string | null | undefined,
    fieldName: string = 'unknown',
): string {
    if (!text) return '';

    const dangerousPatterns = [
        /<script/i,
        /javascript\s*:/i,
        /data\s*:\s*text\/html/i,
        /on\w+\s*=/i,
    ];

    if (dangerousPatterns.some((pattern) => pattern.test(text))) {
        if (process.env.NODE_ENV === 'development') {
            console.warn(
                `[sanitize] Dangerous pattern in field '${fieldName}':`,
                text.slice(0, 120),
            );
        }
        return stripHtml(text);
    }

    return text;
}
