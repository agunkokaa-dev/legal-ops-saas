'use client'

import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '@clerk/nextjs'
import ReactMarkdown from 'react-markdown'
import { useRouter } from 'next/navigation'
import { FileText, Bookmark } from 'lucide-react'
import { createNote } from '@/app/actions/noteActions'
import { toast } from 'sonner'
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

interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
    sources?: AssistantSource[];
}

type ApiValidationError = {
    loc?: Array<string | number>;
    msg?: string;
}

export interface ClauseAssistantContext {
    deviationId?: string;
    title?: string;
    impactAnalysis?: string;
    v1Text?: string;
    v2Text?: string;
    severity?: string;
    playbookViolation?: string;
}

export default function ClauseAssistant({
    contractId,
    matterId,
    context,
}: {
    contractId: string;
    matterId: string | null;
    context?: ClauseAssistantContext;
}) {
    const { getToken, userId } = useAuth();
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'system-init',
            role: 'ai',
            content: "Hello! I am your Legal AI Assistant. I have context on this contract and its entire matter lineage. How can I help you analyze or draft clauses today?"
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    const clauseSteps = [
        "Initializing Clause Assistant...",
        "Extracting contract & matter context...",
        "Analyzing with Indonesian Civil Code...",
        "Cross-referencing Portfolio Playbook...",
        "Synthesizing World-Class Legal response..."
    ];

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

    // Auto-scroll to bottom of chat
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!input.trim() || isLoading) {
            return;
        }

        const userMsg = input.trim();
        setInput('');

        // Optimistically add user message
        const userMessageId = Date.now().toString();
        setMessages(prev => [...prev, { id: userMessageId, role: 'user', content: userMsg }]);
        setIsLoading(true);

        try {
            // Add temporary AI loading message
            setMessages(prev => [...prev, { id: 'loading', role: 'ai', content: '...' }]);

            const token = await getToken();
            if (!token) {
                throw new Error("Authentication failed: Could not retrieve token.");
            }

            const apiBase = getPublicApiBase();
            const response = await fetch(`${apiBase}/api/chat/clause-assistant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    contractId,
                    matterId: matterId || "general",
                    message: userMsg,
                    userId: userId || null,
                    context: context || null,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = Array.isArray(errorData.detail)
                    ? errorData.detail.map((err: ApiValidationError) => err?.loc ? `${err.loc.join('.')}: ${err.msg}` : err?.msg).join(" | ")
                    : (errorData.detail || `HTTP error! status: ${response.status}`);
                throw new Error(errorMessage);
            }

            const data = await response.json();

            setMessages(prev => prev.filter(m => m.id !== 'loading'));
            
            const botReply = data?.reply || data?.response || data?.content || "Mohon maaf, terjadi kesalahan dalam memproses respons.";
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'ai',
                content: String(botReply),
                sources: normalizeAssistantSources(data?.sources || data?.citations || [])
            }]);

        } catch (error: unknown) {
            console.error("Clause Assistant request failed:", error);
            const errorMessage = error instanceof Error ? error.message : "Terjadi kesalahan saat menghubungi asisten AI.";
            toast.error(errorMessage);
            
            setMessages(prev => prev.filter(m => m.id !== 'loading'));
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'ai',
                content: `Mohon maaf, terjadi gangguan: ${errorMessage}`
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveToNotes = async (content: string) => {
        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const formattedNote = `> **🤖 AI LEGAL INSIGHT**\n> **Date:** ${today}\n> **Source:** Clause Assistant Vault\n\n---\n\n${content}`;
        
        try {
            const { error } = await createNote({
                contractId: contractId,
                quote: formattedNote,
                comment: '',
                // 🚨 CRITICAL FIX: Feed the database a dummy object to satisfy the NOT NULL constraint
                positionData: { boundingRect: null, rects: [], pageNumber: 1 }
            });
            
            if (error) throw error;
            toast.success("Insight saved to Notes");
        } catch (err) {
            console.error("Failed to save note:", err);
            toast.error("Failed to save insight.");
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
            {/* Chat Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                {messages.map((msg, idx) => {
                    const safeContent = msg.role === 'ai'
                        ? assertSafeLlmText(msg.content, 'clause_assistant_response')
                        : msg.content

                    return (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div className="flex max-w-[85%] flex-col">
                        <div className={`
                            relative group max-w-[85%] rounded-2xl px-4 py-3 text-sm
                            ${msg.role === 'user'
                                ? 'bg-[#B8B8B8]/10 border border-[#3A3A3A] text-[#0A0A0A] ml-auto rounded-tr-sm'
                                : 'bg-white/5 border border-lux-border text-lux-text-body mr-auto rounded-tl-sm'
                            }
                        `}>
                            {msg.role === 'ai' && msg.id === 'loading' ? (
                                <LuxuryThinkingStepper isLoading={true} steps={clauseSteps} />
                            ) : msg.role === 'ai' ? (
                                <>
                                    <div className="text-sm text-gray-200 leading-relaxed space-y-3">
                                        <ReactMarkdown 
                                            disallowedElements={DISALLOWED_MARKDOWN_ELEMENTS}
                                            unwrapDisallowed
                                            components={{
                                            p: ({node, ...props}) => {
                                                void node;
                                                return <p className="mb-2" {...props} />;
                                            },
                                            strong: ({node, ...props}) => {
                                                void node;
                                                return <strong className="font-bold text-white tracking-wide" {...props} />;
                                            },
                                            ul: ({node, ...props}) => {
                                                void node;
                                                return <ul className="list-none pl-1 space-y-2 mb-3" {...props} />;
                                            },
                                            ol: ({node, ...props}) => {
                                                void node;
                                                return <ol className="list-decimal pl-4 space-y-2 mb-3" {...props} />;
                                            },
                                            li: ({node, ...props}) => {
                                                void node;
                                                return <li className="leading-relaxed" {...props} />;
                                            },
                                            a: ({node, href, children, ...props}) => {
                                                void node;
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
                                    <button 
                                        onClick={() => handleSaveToNotes(msg.content)}
                                        className="absolute top-2 right-2 p-1.5 bg-neutral-800/80 backdrop-blur text-neutral-400 rounded opacity-0 group-hover:opacity-100 transition-all hover:text-white hover:bg-neutral-700 z-10"
                                        title="Save insight to Notes"
                                    >
                                        <Bookmark className="w-3.5 h-3.5" />
                                    </button>
                                </>
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}
                        </div>
                        {msg.role === 'ai' && msg.sources && msg.sources.length > 0 && (
                            <CitationPanel citations={msg.sources} messageIndex={idx} />
                        )}
                        </div>
                    </motion.div>
                )})}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSubmit} className="flex-none p-4 border-t border-white/10 bg-surface">
                <div className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask about clauses, cross-reference the master agreement..."
                        className="w-full bg-lux-black border border-lux-border rounded-lg pl-4 pr-12 py-3 text-sm text-white placeholder-lux-text-muted focus:outline-none focus:ring-1 focus:ring-[#888888] focus:border-[#3A3A3A] transition-all"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#B8B8B8]/20 hover:bg-[#B8B8B8]/30 text-[#B8B8B8] p-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[18px]">send</span>
                    </button>
                </div>
                <div className="mt-2 text-center">
                    <span className="text-[10px] text-lux-text-muted">AI can make mistakes. Verify important legal information.</span>
                </div>
            </form>

        </div>
    )
}
