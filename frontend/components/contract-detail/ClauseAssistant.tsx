'use client'

import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useUser, useAuth } from '@clerk/nextjs'
import ReactMarkdown from 'react-markdown'
import { useRouter } from 'next/navigation'
import { FileText, Bookmark } from 'lucide-react'
import { createNote } from '@/app/actions/noteActions'
import { toast } from 'sonner'

interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
    citations?: { contract_id: string; file_name?: string }[];
}

export default function ClauseAssistant({
    contractId,
    matterId
}: {
    contractId: string,
    matterId: string | null
}) {
    const { user } = useUser();
    const { getToken } = useAuth();
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

        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');

        // Optimistically add user message
        const userMessageId = Date.now().toString();
        setMessages(prev => [...prev, { id: userMessageId, role: 'user', content: userMsg }]);
        setIsLoading(true);

        try {
            // Add temporary AI loading message
            setMessages(prev => [...prev, { id: 'loading', role: 'ai', content: '...' }]);

            // 🎟️ Strict Clerk Token Retrieval
            const token = await getToken();
            console.log("🎟️ AUTH TOKEN STATUS:", token ? "Exists (Ready to send)" : "NULL/MISSING!");

            if (!token) {
                console.error("🚨 HALT: Cannot send request because Clerk token is null!");
                throw new Error("Authentication token is missing. Please refresh the page.");
            }

            const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://173.212.240.143:8000';
            const response = await fetch(`${backendUrl}/api/v1/ai/task-assistant`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    tenant_id: user?.id || "unknown_tenant",
                    matter_id: matterId || "general",
                    task_id: "general_chat",
                    message: userMsg,
                    source_page: "document",
                    document_id: contractId
                })
            });

            setMessages(prev => prev.filter(m => m.id !== 'loading'));

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("🔥 BACKEND ERROR:", JSON.stringify(errorData, null, 2));

                const errorMessage = Array.isArray(errorData.detail)
                    ? errorData.detail.map((e: any) => e.msg || e.type || JSON.stringify(e)).join(", ")
                    : (errorData.detail || `HTTP error! status: ${response.status}`);

                throw new Error(`Backend Error: ${errorMessage}`);
            }

            const data = await response.json();
            const botReply = data?.reply || data?.response || data?.content || "Mohon maaf, terjadi kesalahan dalam memproses respons.";
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'ai',
                content: String(botReply),
                citations: data?.citations || data?.sources || []
            }]);
            setIsLoading(false);

        } catch (error) {
            console.error("Chat error:", error);
            setMessages(prev => prev.filter(m => m.id !== 'loading'));
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'ai',
                content: "I encountered an error trying to process that request."
            }]);
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
                {messages.map((msg) => (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div className={`
                            relative group max-w-[85%] rounded-2xl px-4 py-3 text-sm
                            ${msg.role === 'user'
                                ? 'bg-lux-gold/10 border border-lux-gold/30 text-white ml-auto rounded-tr-sm'
                                : 'bg-white/5 border border-lux-border text-lux-text-body mr-auto rounded-tl-sm'
                            }
                        `}>
                            {msg.role === 'ai' && msg.id === 'loading' ? (
                                <div className="flex gap-1 items-center h-5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-lux-gold animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <div className="w-1.5 h-1.5 rounded-full bg-lux-gold animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <div className="w-1.5 h-1.5 rounded-full bg-lux-gold animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            ) : msg.role === 'ai' ? (
                                <>
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
                    </motion.div>
                ))}
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
                        className="w-full bg-lux-black border border-lux-border rounded-lg pl-4 pr-12 py-3 text-sm text-white placeholder-lux-text-muted focus:outline-none focus:ring-1 focus:ring-lux-gold focus:border-lux-gold transition-all"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-lux-gold/20 hover:bg-lux-gold/30 text-lux-gold p-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
