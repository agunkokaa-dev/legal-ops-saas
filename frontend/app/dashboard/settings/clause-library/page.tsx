"use client";
import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Plus, BookOpenText, X, Save, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Clause {
    id: string;
    category: string;
    clause_type: 'Standard' | 'Fallback';
    title: string;
    content: string;
    guidance_notes?: string;
    created_at: string;
}

export default function ClauseLibrarySettings() {
    const { getToken, isLoaded, userId } = useAuth();
    const [clauses, setClauses] = useState<Clause[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        category: '',
        clause_type: 'Standard',
        title: '',
        content: '',
        guidance_notes: ''
    });

    const fetchClauses = async () => {
        try {
            setIsLoading(true);
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
            const res = await fetch(`${apiUrl}/api/v1/clauses`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            if (res.ok) {
                const data = await res.json();
                setClauses(data);
            } else {
                toast.error("Failed to load clauses.");
            }
        } catch (error) {
            console.error("Error fetching clauses:", error);
            toast.error("An error occurred while fetching clauses.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isLoaded && userId) {
            fetchClauses();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoaded, userId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.category || !formData.title || !formData.content) {
            toast.error("Please fill in all required fields.");
            return;
        }

        setIsSubmitting(true);
        try {
            const token = await getToken();
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
            
            const res = await fetch(`${apiUrl}/api/v1/clauses`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast.success("Clause saved & vectorized successfully!");
                setIsAdding(false);
                setFormData({
                    category: '',
                    clause_type: 'Standard',
                    title: '',
                    content: '',
                    guidance_notes: ''
                });
                fetchClauses(); // Refresh the list
            } else {
                const err = await res.json();
                toast.error(`Error: ${err.detail || 'Failed to save clause'}`);
            }
        } catch (error) {
            console.error("Submit error:", error);
            toast.error("An unexpected error occurred.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-8 max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-serif text-white flex items-center gap-3">
                        <BookOpenText className="text-[#d4af37]" /> Clause Library
                    </h1>
                    <p className="text-sm text-zinc-400 mt-1">Manage your company's gold-standard clauses for AI drafting.</p>
                </div>
                {!isAdding && (
                    <button 
                        onClick={() => setIsAdding(true)}
                        className="bg-[#d4af37] text-black px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-[#b5952f] transition-all shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:shadow-[0_0_20px_rgba(212,175,55,0.4)]"
                    >
                        <Plus className="w-4 h-4 inline mr-1" /> Add New Clause
                    </button>
                )}
            </div>

            {/* Add New Clause Form */}
            {isAdding && (
                <div className="bg-[#141414] border border-white/10 rounded-xl p-6 mb-8 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#d4af37] to-transparent"></div>
                    
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-serif text-white flex items-center gap-2">
                            <Plus className="text-[#d4af37] w-5 h-5" /> 
                            New Standard Clause
                        </h2>
                        <button 
                            onClick={() => setIsAdding(false)}
                            className="bg-white/5 hover:bg-white/10 text-zinc-400 p-2 rounded-full transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                                    Clause Title *
                                </label>
                                <input 
                                    type="text"
                                    value={formData.title}
                                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                                    placeholder="e.g. Mutual Non-Disclosure"
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none transition-all placeholder:text-zinc-600"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                                    Category *
                                </label>
                                <input 
                                    type="text"
                                    value={formData.category}
                                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                                    placeholder="e.g. Confidentiality"
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none transition-all placeholder:text-zinc-600"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                                Clause Type
                            </label>
                            <div className="flex gap-4">
                                <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                                    formData.clause_type === 'Standard' 
                                        ? 'bg-[#d4af37]/10 border-[#d4af37] text-[#d4af37]' 
                                        : 'bg-[#0a0a0a] border-white/10 text-zinc-400 hover:border-white/30'
                                }`}>
                                    <input 
                                        type="radio" 
                                        name="clause_type"
                                        value="Standard" 
                                        checked={formData.clause_type === 'Standard'} 
                                        onChange={() => setFormData({...formData, clause_type: 'Standard'})}
                                        className="sr-only"
                                    />
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span className="text-sm font-semibold tracking-wide">Standard</span>
                                </label>
                                <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                                    formData.clause_type === 'Fallback' 
                                        ? 'bg-amber-500/10 border-amber-500 text-amber-500' 
                                        : 'bg-[#0a0a0a] border-white/10 text-zinc-400 hover:border-white/30'
                                }`}>
                                    <input 
                                        type="radio" 
                                        name="clause_type"
                                        value="Fallback" 
                                        checked={formData.clause_type === 'Fallback'} 
                                        onChange={() => setFormData({...formData, clause_type: 'Fallback'})}
                                        className="sr-only"
                                    />
                                    <ShieldAlert className="w-4 h-4" />
                                    <span className="text-sm font-semibold tracking-wide">Fallback</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                                Legal Text *
                            </label>
                            <textarea 
                                value={formData.content}
                                onChange={(e) => setFormData({...formData, content: e.target.value})}
                                placeholder="Paste the approved legal clause here..."
                                className="w-full h-40 bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white font-serif focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] outline-none transition-all placeholder:text-zinc-600 resize-y"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                                Guidance Notes (Optional)
                            </label>
                            <textarea 
                                value={formData.guidance_notes}
                                onChange={(e) => setFormData({...formData, guidance_notes: e.target.value})}
                                placeholder="Internal instructions on when to use this clause vs the fallback..."
                                className="w-full h-20 bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:border-white/30 focus:ring-1 focus:ring-white/30 outline-none transition-all placeholder:text-zinc-600 resize-y"
                            />
                        </div>

                        <div className="flex justify-end pt-2">
                            <button 
                                type="submit"
                                disabled={isSubmitting}
                                className="bg-[#d4af37] text-black px-6 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-[#b5952f] transition-all flex items-center justify-center gap-2 min-w-[160px] disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                                        Vectorizing...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-4 h-4" /> Save Clause
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Clauses Data Table */}
            {!isAdding && (
                <div className="bg-[#141414] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/10 bg-white/[0.02]">
                                    <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-1/4">Title</th>
                                    <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-1/6">Category</th>
                                    <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-1/6">Type</th>
                                    <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-2/4">Preview</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={4} className="p-8 text-center text-zinc-500">
                                            <div className="w-6 h-6 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                                            Loading Knowledge Base...
                                        </td>
                                    </tr>
                                ) : clauses.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="p-12 text-center border-t border-transparent">
                                            <BookOpenText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                                            <p className="text-zinc-400 font-medium">No approved clauses yet.</p>
                                            <p className="text-zinc-600 text-sm mt-1">Add your first template above to enable AI Draft Matching.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    clauses.map((clause) => (
                                        <tr key={clause.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                                            <td className="p-4 align-top">
                                                <div className="font-semibold text-white text-sm group-hover:text-[#d4af37] transition-colors">
                                                    {clause.title}
                                                </div>
                                            </td>
                                            <td className="p-4 align-top">
                                                <span className="text-xs bg-white/5 text-zinc-300 px-2 py-1 rounded">
                                                    {clause.category}
                                                </span>
                                            </td>
                                            <td className="p-4 align-top">
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                                                    clause.clause_type === 'Standard' 
                                                        ? 'bg-[#d4af37]/10 text-[#d4af37] border-[#d4af37]/30'
                                                        : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                                                }`}>
                                                    {clause.clause_type}
                                                </span>
                                            </td>
                                            <td className="p-4 align-top">
                                                <div className="text-xs text-zinc-400 font-serif line-clamp-2 leading-relaxed">
                                                    {clause.content}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
