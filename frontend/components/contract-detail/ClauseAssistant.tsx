'use client'

import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useUser } from '@clerk/nextjs'
import ReactMarkdown from 'react-markdown'

interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
}

export default function ClauseAssistant({
    contractId,
    matterId
}: {
    contractId: string,
    matterId: string | null
}) {
    const { user } = useUser();
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

            const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const response = await fetch(`${backendUrl}/api/chat/clause-assistant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    contractId,
                    matterId,
                    userId: user?.id
                })
            });

            setMessages(prev => prev.filter(m => m.id !== 'loading'));

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("🔥 BACKEND ERROR:", errorData);
                throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const botReply = data?.reply || data?.response || data?.content || "Mohon maaf, terjadi kesalahan dalam memproses respons.";
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'ai',
                content: String(botReply)
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
                            max-w-[85%] rounded-2xl px-4 py-3 text-sm
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
                                <div className="prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
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
