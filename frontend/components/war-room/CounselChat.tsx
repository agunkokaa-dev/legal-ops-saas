'use client'

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import {
    BlockedMarkdownImage,
    DISALLOWED_MARKDOWN_ELEMENTS,
    safeExternalHref,
} from '@/lib/markdownSafety';
import { getPublicApiBase } from '@/lib/public-api-base';
import { assertSafeLlmText } from '@/lib/sanitize';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export default function CounselChat({
    contractId,
    sessionType,
    deviationId,
    deviationTitle,
    onClose
}: {
    contractId: string;
    sessionType: "deviation" | "general_strategy";
    deviationId: string | null;
    deviationTitle: string;
    onClose: () => void;
}) {
    const { getToken } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);

    const buildNegotiationApiUrl = (suffix = '') => {
        const apiBase = getPublicApiBase();
        const negotiationBase = apiBase.endsWith('/api/v1')
            ? `${apiBase}/negotiation/${contractId}`
            : `${apiBase}/api/v1/negotiation/${contractId}`;
        return suffix ? `${negotiationBase}/${suffix.replace(/^\/+/, '')}` : negotiationBase;
    };

    const scrollToBottom = (force = false) => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        let isMounted = true;
        async function loadHistory() {
            try {
                setIsLoadingHistory(true);
                const token = await getToken();
                // Fetch sessions list
                const sessionsRes = await fetch(buildNegotiationApiUrl('counsel/sessions'), {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (sessionsRes.ok) {
                    const data = await sessionsRes.json();
                    const sessions = data.sessions || [];
                    const existingSession = sessions.find((s: any) =>
                        s.session_type === sessionType &&
                        (sessionType === 'deviation' ? s.deviation_id === deviationId : true)
                    );

                    if (existingSession && isMounted) {
                        setSessionId(existingSession.id);
                        // Fetch specific session history
                        const historyRes = await fetch(buildNegotiationApiUrl(`counsel/sessions/${existingSession.id}`), {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (historyRes.ok) {
                            const historyData = await historyRes.json();
                            if (historyData.messages && isMounted) {
                                // Assume backend messages look like {role: "user"|"assistant", content: "..."}
                                const loadedMessages = historyData.messages.map((m: any, i: number) => ({
                                    id: `msg-${i}`,
                                    role: m.role,
                                    content: m.content,
                                    timestamp: m.timestamp || new Date().toISOString()
                                }));
                                setMessages(loadedMessages);
                                setTimeout(() => scrollToBottom(true), 100);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to load history", err);
            } finally {
                if (isMounted) setIsLoadingHistory(false);
            }
        }
        loadHistory();
        return () => { isMounted = false; };
    }, [contractId, sessionType, deviationId, getToken]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (input.trim() && !isStreaming) {
                sendMessage(input);
            }
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        if (textAreaRef.current) {
            textAreaRef.current.style.height = 'auto';
            textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 100) + 'px';
        }
    };

    const sendMessage = async (messageText: string) => {
        if (!messageText.trim() || isStreaming) return;

        setIsStreaming(true);
        const actualInput = messageText;
        setInput('');

        if (textAreaRef.current) {
            textAreaRef.current.style.height = 'auto';
        }

        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: actualInput,
            timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, userMsg]);
        setTimeout(() => scrollToBottom(true), 50);

        const aiMsgId = crypto.randomUUID();
        setMessages(prev => [...prev, {
            id: aiMsgId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString()
        }]);

        try {
            const token = await getToken();
            const response = await fetch(buildNegotiationApiUrl('counsel'), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: actualInput,
                    session_id: sessionId || null,
                    deviation_id: deviationId || null,
                    session_type: sessionType,
                }),
            });

            if (!response.ok) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(errBody?.detail || errBody?.message || "Failed to send message: " + response.statusText);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) throw new Error("No reader from response");

            let currentAssistantContent = "";
            let doneReading = false;
            let partialLine = "";

            while (!doneReading) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = (partialLine + chunk).split('\n');
                // The last element might be an incomplete line
                partialLine = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('data: ')) {
                        try {
                            const dataPayload = JSON.parse(line.replace('data: ', ''));
                            if (dataPayload.type === 'chunk') {
                                currentAssistantContent += dataPayload.content;
                                setMessages(prev => prev.map(m =>
                                    m.id === aiMsgId
                                        ? { ...m, content: currentAssistantContent }
                                        : m
                                ));
                                scrollToBottom();
                            } else if (dataPayload.type === 'session_started') {
                                if (dataPayload.session_id && !sessionId) {
                                    setSessionId(dataPayload.session_id);
                                }
                            } else if (dataPayload.type === 'done') {
                                doneReading = true;
                                if (dataPayload.session_id && !sessionId) {
                                    setSessionId(dataPayload.session_id);
                                }
                            }
                        } catch (e) {
                            console.warn("CounselChat SSE json parse skipping incomplete chunk");
                        }
                    }
                }
            }

            // Reached stream end
            if (partialLine.startsWith('data: ')) {
                try {
                    const dataPayload = JSON.parse(partialLine.replace('data: ', ''));
                    if (dataPayload.type === 'done') {
                        if (dataPayload.session_id && !sessionId) {
                            setSessionId(dataPayload.session_id);
                        }
                    }
                } catch (e) { }
            }

        } catch (error: any) {
            console.error('Counsel chat error:', error);
            toast.error(error.message || 'Error sending message');
            setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: (m.content ? m.content + '\n\n' : '') + `❌ Error: ${error.message}` } : m));
        } finally {
            setIsStreaming(false);
            scrollToBottom();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 w-full bg-[#0c0c0c]">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
                <button
                    onClick={onClose}
                    className="text-zinc-500 hover:text-zinc-300 p-1 -ml-1 rounded hover:bg-zinc-800 transition-colors"
                >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                </button>
                <div>
                    <h2 className="text-sm font-bold text-zinc-100 p-0 m-0 leading-none mb-1">Clause Assistant</h2>
                    <p className="text-[10px] text-[#B8B8B8] opacity-80 m-0 leading-none">
                        {deviationTitle}
                    </p>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar bg-transparent">
                {isLoadingHistory ? (
                    <div className="flex justify-center items-center h-full">
                        <span className="text-zinc-500 text-xs flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-zinc-500/20 rounded-full animate-spin border-t-zinc-500"></span>
                            Loading history...
                        </span>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-3">
                        <span className="text-3xl">🤖</span>
                        <p className="text-xs text-center max-w-[250px]">
                            I'm your Clause Assistant. Ask me to draft counter-proposals or evaluate risks.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4 pb-4">
                        {messages.map((msg) => {
                            const safeContent = msg.role === 'assistant'
                                ? assertSafeLlmText(msg.content, 'counsel_response')
                                : msg.content;

                            return (
                            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                {msg.role === 'assistant' && (
                                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1 ml-1">Clause Assistant</span>
                                )}
                                <div className={`max-w-[85%] text-[13px] leading-relaxed p-3 rounded-lg ${msg.role === 'user'
                                        ? 'bg-zinc-700/50 text-zinc-100 rounded-tr-sm'
                                        : 'bg-zinc-800/30 text-zinc-300 border border-zinc-800/60 rounded-tl-sm'
                                    }`}>
                                    <div className="prose prose-sm prose-invert max-w-none">
                                        <ReactMarkdown
                                            disallowedElements={DISALLOWED_MARKDOWN_ELEMENTS}
                                            unwrapDisallowed
                                            components={{
                                                a: ({ href, children, ...props }) => (
                                                    <a
                                                        href={safeExternalHref(href)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        {...props}
                                                    >
                                                        {children}
                                                    </a>
                                                ),
                                                img: ({ alt, src }) => (
                                                    <BlockedMarkdownImage
                                                        alt={alt}
                                                        src={typeof src === 'string' ? src : undefined}
                                                        className="text-zinc-500"
                                                    />
                                                ),
                                            }}
                                        >
                                            {safeContent}
                                        </ReactMarkdown>
                                    </div>
                                    {msg.role === 'assistant' && msg.content === '' && isStreaming && (
                                        <div className="flex gap-1 items-center mt-1 h-2 text-zinc-500">
                                            <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                                            <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                                            <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )})}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-zinc-800 bg-[#0c0c0c] shrink-0 sticky bottom-0">
                <div className="relative">
                    <textarea
                        ref={textAreaRef}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder="Type your question... (Shift+Enter for new line)"
                        maxLength={1000}
                        rows={1}
                        className="w-full bg-[#141414] border border-zinc-800 rounded-lg pl-3 pr-10 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#3A3A3A] focus:ring-1 focus:ring-[#888888]/50 resize-none custom-scrollbar transition-all"
                        style={{ minHeight: '40px', maxHeight: '100px' }}
                        disabled={isStreaming}
                    />
                    <button
                        onClick={() => sendMessage(input)}
                        disabled={!input.trim() || isStreaming}
                        className="absolute right-2 bottom-2 p-1 text-[#B8B8B8] hover:text-[#D4D4D4] hover:bg-[#1C1C1C] rounded disabled:opacity-30 transition-colors"
                    >
                        <span className="material-symbols-outlined text-sm">send</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
