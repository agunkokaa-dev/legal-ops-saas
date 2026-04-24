export const DISALLOWED_MARKDOWN_ELEMENTS = [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'style',
    'link',
] as const;

export const MARKDOWN_DISALLOWED_ELEMENTS = DISALLOWED_MARKDOWN_ELEMENTS;

export function safeExternalHref(href?: string): string {
    return /^https?:\/\//i.test(href || '') ? href! : '#';
}

export function BlockedMarkdownImage({
    alt,
    src,
    className,
}: {
    alt?: string;
    src?: string;
    className?: string;
}) {
    return <span className={className || 'text-zinc-500'}>[image: {alt || src}]</span>;
}
