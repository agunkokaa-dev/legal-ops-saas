const ALLOWED_TAGS = new Set([
    'mark',
    'p',
    'br',
    'strong',
    'em',
    'span',
    'b',
    'i',
    'u',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'div',
    'section',
]);

const BLOCKED_TAGS = new Set([
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'style',
    'link',
    'meta',
    'base',
    'noscript',
    'template',
]);

const SAFE_ATTRIBUTE_NAMES = new Set([
    'class',
    'title',
    'style',
    'colspan',
    'rowspan',
    'align',
]);

const BLOCKED_CONTENT_PATTERN = /<\s*(script|iframe|object|embed|form|style|link|meta|base|noscript|template|button|select|textarea)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const BLOCKED_SELF_CLOSING_PATTERN = /<\s*(script|iframe|object|embed|form|input|button|select|textarea|style|link|meta|base|noscript|template)[^>]*\/?>/gi;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TAG_PATTERN = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi;
const ATTRIBUTE_PATTERN = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
const DANGEROUS_VALUE_PATTERN = /javascript\s*:|data\s*:\s*text\/html|expression\s*\(/i;

function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sanitizeAllowedAttributes(attrs: string): string {
    const safeAttrs: string[] = [];

    for (const match of attrs.matchAll(ATTRIBUTE_PATTERN)) {
        const rawName = match[1];
        const name = rawName.toLowerCase();
        const value = match[2] ?? match[3] ?? match[4] ?? '';

        if (name.startsWith('on')) {
            continue;
        }

        const isDataAttribute = name.startsWith('data-');
        if (!isDataAttribute && !SAFE_ATTRIBUTE_NAMES.has(name)) {
            continue;
        }

        if (value && DANGEROUS_VALUE_PATTERN.test(value)) {
            continue;
        }

        if (value) {
            safeAttrs.push(`${name}="${escapeAttribute(value)}"`);
        } else if (isDataAttribute || SAFE_ATTRIBUTE_NAMES.has(name)) {
            safeAttrs.push(name);
        }
    }

    return safeAttrs.length ? ` ${safeAttrs.join(' ')}` : '';
}

/**
 * Sanitize raw contract or draft HTML before browser rendering.
 *
 * This preserves structural tags and injected <mark> highlights while removing
 * executable HTML and dangerous attributes.
 */
export function sanitizeContractHtml(html: string | null | undefined): string {
    if (!html) return '';

    let sanitized = html.replace(COMMENT_PATTERN, '');
    sanitized = sanitized.replace(BLOCKED_CONTENT_PATTERN, '');
    sanitized = sanitized.replace(BLOCKED_SELF_CLOSING_PATTERN, '');

    sanitized = sanitized.replace(TAG_PATTERN, (match, rawTag: string, rawAttrs: string) => {
        const tag = rawTag.toLowerCase();
        const isClosing = match.startsWith('</');
        const isSelfClosing = /\/\s*>$/.test(match) || tag === 'br';

        if (BLOCKED_TAGS.has(tag) || !ALLOWED_TAGS.has(tag)) {
            return '';
        }

        if (isClosing) {
            return `</${tag}>`;
        }

        const safeAttrs = sanitizeAllowedAttributes(rawAttrs || '');
        return isSelfClosing ? `<${tag}${safeAttrs} />` : `<${tag}${safeAttrs}>`;
    });

    sanitized = sanitized
        .replace(/javascript\s*:/gi, '')
        .replace(/data\s*:\s*text\/html/gi, '')
        .replace(/on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    return sanitized;
}
