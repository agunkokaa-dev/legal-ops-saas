'use client'

import { useState, useRef, useEffect } from 'react'
import { chatWithClause } from '@/app/actions/backend'
import { Send, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { CitationPanel } from '@/components/CitationPanel'
import { LuxuryThinkingStepper } from '@/components/ui/LuxuryThinkingStepper'
import { getPublicApiBase } from '@/lib/public-api-base'
import {
    BlockedMarkdownImage,
    DISALLOWED_MARKDOWN_ELEMENTS,
    safeExternalHref,
} from '@/lib/markdownSafety'
import { assertSafeLlmText } from '@/lib/sanitize'
import {
    type AssistantSource,
    normalizeAssistantSources,
    resolveDocumentSourceId,
} from '@/lib/assistantSources'
import {
    CONTRACTS_METADATA_EVENT,
    CONTRACTS_METADATA_STORAGE_KEY,
    type ContractMetadata,
    isLikelyMetadataQuery,
    normalizeContractsMetadata,
    readStoredContractsMetadata,
    publishContractsMetadata,
    tryAnswerFromMetadata,
} from '@/lib/metadataQuery'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    sources?: AssistantSource[]
}

interface AssistantSidebarProps {
    contractsMetadata?: ContractMetadata[]
}

export default function AssistantSidebar({ contractsMetadata }: AssistantSidebarProps) {
    const { getToken, userId } = useAuth()
    const pathname = usePathname()
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: "Good morning, Partner. I am securely connected to your isolated RAG vault. How can I assist you with your contracts today?",
        }
    ])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [fetchedContractsMetadata, setFetchedContractsMetadata] = useState<ContractMetadata[]>([])
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const router = useRouter()

    const processContent = (text: string) => {
        if (!text) return '';
        // Find existing markdown links to avoid messing with them.
        // We look for [text](url) or loose filenames like docs.pdf
        return text.replace(/\[([^\]]+)\]\(([^)]+)\)|([a-zA-Z0-9_.-]+\.(?:pdf|docx|txt))/gi, (match, mdTitle, mdUrl, looseName) => {
            if (looseName) {
                // It's a loose filename, convert to dashboard/documents link
                return `[${looseName}](/dashboard/documents/${looseName})`;
            }
            // It's already a markdown link, return as is
            return match;
        });
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages, isLoading])

    // ── Storage reader + event listener (always active) ──
    // Reads sessionStorage on mount and listens for updates from MetadataBridge
    // in documents page. This must run on ALL pages, not just /dashboard/documents.
    useEffect(() => {
        if (contractsMetadata && contractsMetadata.length > 0) return

        const stored = readStoredContractsMetadata()
        if (stored.length > 0) {
            setFetchedContractsMetadata(stored)
        }

        const handleMetadataUpdate = (event: Event) => {
            const nextMetadata = (event as CustomEvent<ContractMetadata[]>).detail
            if (Array.isArray(nextMetadata)) {
                setFetchedContractsMetadata(normalizeContractsMetadata(nextMetadata))
            }
        }

        window.addEventListener(CONTRACTS_METADATA_EVENT, handleMetadataUpdate)
        return () => window.removeEventListener(CONTRACTS_METADATA_EVENT, handleMetadataUpdate)
    }, [contractsMetadata])

    // ── Fallback: direct API fetch when on /dashboard/documents ──
    // Only fires if no prop metadata AND no stored metadata was found.
    useEffect(() => {
        if (contractsMetadata || pathname !== '/dashboard/documents' || !userId) {
            return
        }

        // Skip if we already have metadata from storage/event
        if (fetchedContractsMetadata.length > 0) return

        let cancelled = false

        const fetchMetadata = async () => {
            try {
                const token = await getToken()
                const response = await fetch(`${getPublicApiBase()}/api/contracts?tab=active`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    cache: 'no-store',
                })

                if (!response.ok) return

                const payload = await response.json()
                const records = Array.isArray(payload)
                    ? payload
                    : Array.isArray(payload?.data)
                        ? payload.data
                        : []

                const normalized = normalizeContractsMetadata(records)

                if (!cancelled) {
                    publishContractsMetadata(normalized)
                    setFetchedContractsMetadata(normalized)
                }
            } catch {
                if (!cancelled) setFetchedContractsMetadata([])
            }
        }

        void fetchMetadata()

        return () => {
            cancelled = true
        }
    }, [contractsMetadata, fetchedContractsMetadata.length, getToken, pathname, userId])

    const handleSend = async () => {
        if (!input.trim() || isLoading) return

        const trimmed = input.trim()
        setInput('')

        // STEP A: fresh metadata read on every submit.
        let activeMeta: ContractMetadata[] = []

        if (contractsMetadata && contractsMetadata.length > 0) {
            activeMeta = normalizeContractsMetadata(contractsMetadata)
        } else if (fetchedContractsMetadata.length > 0) {
            activeMeta = normalizeContractsMetadata(fetchedContractsMetadata)
        }

        if (activeMeta.length === 0) {
            try {
                const stored = window.sessionStorage.getItem(CONTRACTS_METADATA_STORAGE_KEY)
                if (stored) {
                    const parsed = JSON.parse(stored)
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        activeMeta = normalizeContractsMetadata(parsed)
                    }
                }
            } catch {
                activeMeta = []
            }
        }

        const localAnswer = tryAnswerFromMetadata(trimmed, activeMeta)
        console.log('[DEBUG] activeMeta.length:', activeMeta.length);
        console.log('[DEBUG] localAnswer:', localAnswer);

        // STEP B: answer from local metadata before any backend call.
        if (activeMeta.length > 0) {
            if (localAnswer !== null && localAnswer !== undefined && localAnswer !== '') {
                const now = Date.now()
                setMessages(prev => [
                    ...prev,
                    { id: now.toString(), role: 'user', content: trimmed },
                    {
                        id: `${now + 1}metadata`,
                        role: 'assistant',
                        content: localAnswer,
                        sources: [],
                    },
                ])
                return
            }
        }

        if (pathname === '/dashboard/documents' && isLikelyMetadataQuery(trimmed)) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                content: trimmed,
            }, {
                id: Date.now().toString() + 'metadata-fallback',
                role: 'assistant',
                content: activeMeta.length
                    ? `Saya tidak menemukan informasi yang relevan untuk pertanyaan ini dari ${activeMeta.length} kontrak yang tersedia. Coba tanyakan tentang nilai kontrak, status, atau risiko. Untuk analisis mendalam teks kontrak, buka kontrak spesifik terlebih dahulu.`
                    : 'Belum ada kontrak yang tersimpan. Upload kontrak pertama Anda untuk memulai analisis.',
                sources: [],
            }])
            return
        }

        // STEP C: only call backend when local metadata cannot answer.
        setIsLoading(true)
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: trimmed }])

        try {
            const result = await chatWithClause(trimmed)

            // 🚨 CRITICAL FIX: Backend returns {"reply": "..."}, NOT {"answer": "..."}
            let aiContent = typeof result === 'string'
                ? result
                : String(result.reply || result.answer || result.response || result.content || "Mohon maaf, terjadi kesalahan dalam memproses respons.");

            if (
                pathname === '/dashboard/documents' &&
                activeMeta.length > 0 &&
                /tidak ada dokumen|tidak terhubung|no document/i.test(aiContent)
            ) {
                aiContent = `Saya tidak menemukan informasi yang relevan untuk pertanyaan ini dari ${activeMeta.length} kontrak yang tersedia. Coba tanyakan tentang nilai kontrak, status, atau risiko. Untuk analisis mendalam teks kontrak, buka kontrak spesifik terlebih dahulu.`
            }

            setMessages(prev => [...prev, {
                id: Date.now().toString() + 'ai',
                role: 'assistant',
                content: aiContent,
                sources: normalizeAssistantSources(result?.sources || result?.citations || [])
            }])

        } catch (error: unknown) {
            setMessages(prev => [...prev, {
                id: Date.now().toString() + 'err',
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : "Failed to communicate with intelligence engine."}`
            }])
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <aside className="flex flex-col w-full h-full overflow-hidden bg-background-dark border-l border-white/10">
            <div className="px-5 py-4 border-b border-surface-border/50">
                <h2 className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">Clause Assistant</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 relative">
                {messages.map((msg, idx) => {
                    const safeContent = msg.role === 'assistant'
                        ? assertSafeLlmText(msg.content, 'assistant_sidebar_response')
                        : msg.content

                    return (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex flex-col max-w-[90%]`}>
                            <div className={`p-4 text-sm leading-relaxed ${msg.role === 'assistant'
                                ? 'bg-surface/50 rounded-2xl border border-surface-border'
                                : 'bg-primary/10 rounded-2xl border border-primary/20 text-white'
                                }`}>
                                {msg.role === 'assistant' ? (
                                    <div className="text-sm text-gray-200 leading-relaxed space-y-3">
                                        <ReactMarkdown 
                                            disallowedElements={DISALLOWED_MARKDOWN_ELEMENTS}
                                            unwrapDisallowed
                                            components={{
                                                p: ({node, ...props}) => {
                                                    void node
                                                    return <p className="mb-2" {...props} />
                                                },
                                                strong: ({node, ...props}) => {
                                                    void node
                                                    return <strong className="font-bold text-white tracking-wide" {...props} />
                                                },
                                                ul: ({node, ...props}) => {
                                                    void node
                                                    return <ul className="list-none pl-1 space-y-2 mb-3" {...props} />
                                                },
                                                ol: ({node, ...props}) => {
                                                    void node
                                                    return <ol className="list-decimal pl-4 space-y-2 mb-3" {...props} />
                                                },
                                                li: ({node, ...props}) => {
                                                    void node
                                                    return <li className="leading-relaxed" {...props} />
                                                },
                                                a: ({node, href, children, ...props}) => {
                                                    void node
                                                    const linkText = String(children);
                                                    const hrefStr = href || '';
                                                    
                                                    // Check if it's a contract link (either by file extension or specific routing)
                                                    if (linkText.match(/\.(?:pdf|docx|txt)$/i) || hrefStr.includes('/dashboard/documents/') || hrefStr.includes('/dashboard/contracts/')) {
                                                        const finalId = resolveDocumentSourceId(msg.sources, linkText, hrefStr)

                                                        return (
                                                            <span
                                                                onClick={() => router.push(`/dashboard/contracts/${encodeURIComponent(finalId)}`)}
                                                                className="inline-flex items-center gap-1 bg-[#B8B8B8]/10 text-[#B8B8B8] border border-[#3A3A3A] px-2 py-1 mx-1 rounded text-xs font-bold cursor-pointer hover:bg-[#B8B8B8]/20 hover:scale-105 transition-all shadow-sm shadow-[#888888]/10"
                                                                title={`Open Document: ${linkText}`}
                                                            >
                                                                <FileText size={12} className="shrink-0" />
                                                            {linkText}
                                                        </span>
                                                    );
                                                }
                                                    return <a href={safeExternalHref(hrefStr)} target="_blank" rel="noopener noreferrer" className="text-[#B8B8B8] hover:underline" {...props}>{children}</a>;
                                                },
                                                img: ({ alt, src }) => (
                                                    <BlockedMarkdownImage
                                                        alt={alt}
                                                        src={typeof src === 'string' ? src : undefined}
                                                        className="text-zinc-500"
                                                    />
                                                ),
                                            }}
                                        >
                                            {processContent(safeContent)}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    msg.content
                                )}
                            </div>
                            {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                                <CitationPanel citations={msg.sources} messageIndex={idx} />
                            )}
                        </div>
                    </div>
                )})}

                {isLoading && (
                    <div className="flex justify-start">
                        <div className="max-w-[90%] w-full bg-surface/50 p-4 rounded-2xl border border-surface-border">
                            <LuxuryThinkingStepper 
                                isLoading={true} 
                                steps={[
                                    "Initializing Dashboard AI...",
                                    "Scanning Global Portfolio...",
                                    "Cross-referencing high-risk contracts...",
                                    "Synthesizing executive summary..."
                                ]} 
                            />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} className="pb-2" />
            </div>

            <div className="p-4 border-t border-surface-border bg-surface shrink-0">
                <div className="relative">
                    <input
                        suppressHydrationWarning
                        className="w-full bg-background-dark border border-surface-border rounded pl-4 pr-10 py-3 text-sm text-white placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                        placeholder="Query your tenant vault..."
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleSend();
                        }}
                        disabled={isLoading}
                    />
                    <button
                        suppressHydrationWarning
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-white transition-colors p-1 disabled:opacity-30 disabled:hover:text-primary cursor-pointer flex items-center justify-center"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-[10px] text-center text-text-muted mt-2 opacity-50">AI generated insights based on your secured RAG data.</p>
            </div>
        </aside>
    )
}
