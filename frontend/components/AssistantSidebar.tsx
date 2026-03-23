'use client'

import { useState, useRef, useEffect } from 'react'
import { chatWithClause } from '@/app/actions/backend'
import { Sparkles, Command, User, Send, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useRouter } from 'next/navigation'
import { LuxuryThinkingStepper } from '@/components/ui/LuxuryThinkingStepper'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    citations?: { contract_id: string; file_name?: string }[]
}

export default function AssistantSidebar() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: "Good morning, Partner. I am securely connected to your isolated RAG vault. How can I assist you with your contracts today?",
        }
    ])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
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

    const handleSend = async () => {
        if (!input.trim() || isLoading) return

        const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input }
        setMessages(prev => [...prev, userMessage])
        setInput('')
        setIsLoading(true)

        try {
            const result = await chatWithClause(userMessage.content)

            // 🚨 CRITICAL FIX: Backend returns {"reply": "..."}, NOT {"answer": "..."}
            const aiContent = typeof result === 'string'
                ? result
                : String(result.reply || result.answer || result.response || result.content || "Mohon maaf, terjadi kesalahan dalam memproses respons.");

            setMessages(prev => [...prev, {
                id: Date.now().toString() + 'ai',
                role: 'assistant',
                content: aiContent,
                citations: result?.citations || result?.sources || []
            }])

        } catch (error: any) {
            setMessages(prev => [...prev, {
                id: Date.now().toString() + 'err',
                role: 'assistant',
                content: `Error: ${error.message || "Failed to communicate with intelligence engine."}`
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
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex flex-col max-w-[90%]`}>
                            <div className={`p-4 text-sm leading-relaxed ${msg.role === 'assistant'
                                ? 'bg-surface/50 rounded-2xl border border-surface-border'
                                : 'bg-primary/10 rounded-2xl border border-primary/20 text-white'
                                }`}>
                                {msg.role === 'assistant' ? (
                                    <div className="text-sm text-gray-200 leading-relaxed space-y-3">
                                        <ReactMarkdown 
                                            components={{
                                                p: ({node, ...props}) => <p className="mb-2" {...props} />,
                                                strong: ({node, ...props}) => <strong className="font-bold text-white tracking-wide" {...props} />,
                                                ul: ({node, ...props}) => <ul className="list-none pl-1 space-y-2 mb-3" {...props} />,
                                                ol: ({node, ...props}) => <ol className="list-decimal pl-4 space-y-2 mb-3" {...props} />,
                                                li: ({node, ...props}) => <li className="leading-relaxed" {...props} />,
                                                a: ({node, href, children, ...props}) => {
                                                    const linkText = String(children);
                                                    const hrefStr = href || '';
                                                    
                                                    // Check if it's a contract link (either by file extension or specific routing)
                                                    if (linkText.match(/\.(?:pdf|docx|txt)$/i) || hrefStr.includes('/dashboard/documents/') || hrefStr.includes('/dashboard/contracts/')) {
                                                        
                                                        // 🚨 CRITICAL FIX: Extract UUID from href if it follows the enterprise routing pattern
                                                        // We prioritize the ID from the href over the link text to prevent routing to filenames.
                                                        let targetId = linkText; 
                                                        
                                                        if (hrefStr.includes('/dashboard/contracts/')) {
                                                            targetId = hrefStr.split('/dashboard/contracts/')[1] || linkText;
                                                        } else if (hrefStr.includes('/dashboard/documents/')) {
                                                            targetId = hrefStr.split('/dashboard/documents/')[1] || linkText;
                                                        }

                                                        const matchedSource = msg.citations?.find((cite: any) => 
                                                            cite.file_name === linkText || cite.contract_id === targetId || cite.contract_id === linkText
                                                        );
                                                        
                                                        const finalId = matchedSource ? matchedSource.contract_id : targetId;

                                                        return (
                                                            <span
                                                                onClick={() => router.push(`/dashboard/contracts/${encodeURIComponent(finalId)}`)}
                                                                className="inline-flex items-center gap-1 bg-clause-gold/10 text-clause-gold border border-clause-gold/30 px-2 py-1 mx-1 rounded text-xs font-bold cursor-pointer hover:bg-clause-gold/20 hover:scale-105 transition-all shadow-sm shadow-clause-gold/10"
                                                                title={`Open Document: ${linkText}`}
                                                            >
                                                                <FileText size={12} className="shrink-0" />
                                                                {linkText}
                                                            </span>
                                                        );
                                                    }
                                                    return <a href={href} className="text-blue-400 hover:underline" {...props}>{children}</a>;
                                                }
                                            }}
                                        >
                                            {processContent(msg.content)}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    msg.content
                                )}
                            </div>

                            {/* Evidence Chips */}
                            {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {msg.citations.map((cite, idx) => {
                                        return (
                                            <button
                                                suppressHydrationWarning
                                                key={idx}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    router.push(`/dashboard/contracts/${cite.contract_id}`);
                                                }}
                                                className="flex items-center gap-1.5 bg-surface-border/60 hover:bg-primary/20 border border-surface-border text-[10px] text-text-muted hover:text-primary px-2 py-1 rounded-full transition-colors cursor-pointer"
                                                title={`Contract ID: ${cite.contract_id}`}
                                            >
                                                <FileText className="w-3 h-3" />
                                                Source: {cite.file_name || 'Document'}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

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
