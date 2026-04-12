'use client'

import { useState, useEffect } from 'react'
import { useUser, useAuth } from '@clerk/nextjs'
import { supabaseClient } from '@/lib/supabase'
import { Plus, Loader2, BookOpen, AlertCircle, CheckCircle2 } from 'lucide-react'
import { getPublicApiBase } from '@/lib/public-api-base'

export default function CompanyPlaybookPage() {
    const { user, isLoaded: isUserLoaded } = useUser()
    const { getToken } = useAuth()

    const [rules, setRules] = useState<any[]>([])
    
    // Structured form state
    const [category, setCategory] = useState('Governing Law')
    const [standardPosition, setStandardPosition] = useState('')
    const [fallbackPosition, setFallbackPosition] = useState('')
    const [redline, setRedline] = useState('')
    const [riskSeverity, setRiskSeverity] = useState('Medium Risk')

    const [isLoading, setIsLoading] = useState(true)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)

    useEffect(() => {
        if (isUserLoaded && user) {
            fetchRules()
        }
    }, [isUserLoaded, user])

    const fetchRules = async () => {
        try {
            setIsLoading(true)
            setError(null)

            if (!user) {
                throw new Error("User session not found. Please log in again.");
            }

            const token = await getToken({ template: 'supabase' })
            const supabase = await supabaseClient(token || '')

            // 2. Fetch the rules for this specific user
            const { data, error } = await supabase
                .from('company_playbooks')
                .select('*')
                .eq('user_id', user.id) // Explicitly filter
                .order('created_at', { ascending: false })

            if (error) {
                // Stringify the error to expose the hidden Supabase details
                console.error('Supabase Error Details:', JSON.stringify(error, null, 2));
                throw new Error(error.message || 'Failed to fetch rules from database.');
            }

            setRules(data || [])
        } catch (err: any) {
            console.error('Detailed fetch error:', err)
            setError(err.message || 'An unexpected error occurred.')
        } finally {
            setIsLoading(false)
        }
    }

    const handleAddRule = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!standardPosition.trim() || !user) return

        setIsSubmitting(true)
        setError(null)
        setSuccessMsg(null)

        try {
            const token = await getToken({ template: 'supabase' })
            const supabase = await supabaseClient(token || '')

            // 1. Insert into Supabase
            const fallbackStr = fallbackPosition.trim() || null
            const redlineStr = redline.trim() || null
            const ruleTextFallback = `[${category}] ${standardPosition.trim()}`

            const { data: newRule, error: supaError } = await supabase
                .from('company_playbooks')
                .insert([{ 
                    user_id: user.id, 
                    category,
                    standard_position: standardPosition.trim(),
                    fallback_position: fallbackStr,
                    redline: redlineStr,
                    risk_severity: riskSeverity,
                    rule_text: ruleTextFallback
                }])
                .select()
                .single()

            if (supaError) throw supaError

            // Update UI optimistically
            setRules([{ ...newRule }, ...rules])
            setCategory('Governing Law')
            setStandardPosition('')
            setFallbackPosition('')
            setRedline('')
            setRiskSeverity('Medium Risk')

            // 2. Send to Backend Vectorizer
            const backendUrl = getPublicApiBase()
            const vectorRes = await fetch(`${backendUrl}/api/playbook/vectorize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: newRule.id,
                    user_id: newRule.user_id,
                    rule_text: newRule.rule_text,
                    category: newRule.category || null,
                    standard_position: newRule.standard_position || null,
                    fallback_position: newRule.fallback_position || null,
                    redline: newRule.redline || null,
                    risk_severity: newRule.risk_severity || null
                })
            })

            if (!vectorRes.ok) {
                const errData = await vectorRes.json()
                console.error("Vectorization Failed:", errData)
                setError(`Rule saved to database, but vectorization failed: ${errData.detail || 'Unknown error'}`)
            } else {
                setSuccessMsg('Rule successfully saved and vectorized!')
                setTimeout(() => setSuccessMsg(null), 3000)
            }

        } catch (err: any) {
            console.error('Error adding rule:', err)
            setError(err.message || 'Failed to submit rule.')
        } finally {
            setIsSubmitting(false)
        }
    }

    if (!isUserLoaded) {
        return <div className="p-8 flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-neutral-500" /></div>
    }

    return (
        <div className="flex-1 w-full h-full p-8 overflow-y-auto bg-[#0a0a0a]">
            {/* Header Section */}
            <div className="mb-8 max-w-4xl mx-auto">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <BookOpen className="w-6 h-6 text-primary" />
                    </div>
                    <h1 className="text-3xl font-serif text-white tracking-tight">Company Playbook</h1>
                </div>
                <p className="text-neutral-400 text-sm">
                    Define your custom contract guidelines. Our AI will automatically enforce these rules during contract review.
                </p>
            </div>

            <div className="max-w-4xl mx-auto space-y-8">
                {/* Form Section */}
                <div className="bg-[#121212] border border-neutral-800 rounded-xl p-6 shadow-2xl">
                    <h2 className="text-lg font-medium text-white mb-4">Add New Rule</h2>
                    <form onSubmit={handleAddRule}>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm text-neutral-400">Category</label>
                                    <select 
                                        value={category} 
                                        onChange={(e) => setCategory(e.target.value)}
                                        disabled={isSubmitting}
                                        className="w-full bg-[#1a1a1a] border border-neutral-700 text-white rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary"
                                    >
                                        <option>Governing Law</option>
                                        <option>Liability Cap</option>
                                        <option>Payment Terms</option>
                                        <option>Confidentiality</option>
                                        <option>Termination</option>
                                        <option>Warranties</option>
                                        <option>Other</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm text-neutral-400">Risk Severity</label>
                                    <select 
                                        value={riskSeverity} 
                                        onChange={(e) => setRiskSeverity(e.target.value)}
                                        disabled={isSubmitting}
                                        className="w-full bg-[#1a1a1a] border border-neutral-700 text-white rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary"
                                    >
                                        <option>High Risk</option>
                                        <option>Medium Risk</option>
                                        <option>Low Risk</option>
                                    </select>
                                </div>
                            </div>
                           
                            <div className="space-y-1">
                                <label className="text-sm text-neutral-400">Standard Position <span className="text-red-500">*</span></label>
                                <textarea
                                    value={standardPosition}
                                    onChange={(e) => setStandardPosition(e.target.value)}
                                    placeholder="The required gold-standard clause..."
                                    className="w-full h-24 bg-[#1a1a1a] border border-neutral-700 text-white placeholder:text-neutral-500 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none transition-all"
                                    disabled={isSubmitting}
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm text-neutral-400">Fallback (Compromise)</label>
                                    <textarea
                                        value={fallbackPosition}
                                        onChange={(e) => setFallbackPosition(e.target.value)}
                                        placeholder="Acceptable fallbacks if standard is rejected..."
                                        className="w-full h-24 bg-[#1a1a1a] border border-neutral-700 text-white placeholder:text-neutral-500 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none transition-all"
                                        disabled={isSubmitting}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm text-neutral-400">Redline (Walk-away)</label>
                                    <textarea
                                        value={redline}
                                        onChange={(e) => setRedline(e.target.value)}
                                        placeholder="Unacceptable terms to reject completely..."
                                        className="w-full h-24 bg-[#1a1a1a] border border-neutral-700 text-white placeholder:text-neutral-500 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none transition-all"
                                        disabled={isSubmitting}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 p-3 rounded-lg border border-red-500/20">
                                    <AlertCircle className="w-4 h-4" />
                                    {error}
                                </div>
                            )}

                            {successMsg && (
                                <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-400/10 p-3 rounded-lg border border-emerald-500/20">
                                    <CheckCircle2 className="w-4 h-4" />
                                    {successMsg}
                                </div>
                            )}

                            <div className="flex justify-end">
                                <button
                                    type="submit"
                                    disabled={!standardPosition.trim() || isSubmitting}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-[#d4af37] hover:bg-[#c4a137] text-black font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Plus className="w-4 h-4 text-black" />}
                                    Save Rule
                                </button>
                            </div>
                        </div>
                    </form>
                </div>

                {/* Rules List Section */}
                <div>
                    <h2 className="text-lg font-medium text-white mb-4 px-1">Active Guidelines</h2>

                    {isLoading ? (
                        <div className="flex items-center justify-center p-12 py-24 border border-neutral-800 rounded-xl bg-[#121212]/50 border-dashed">
                            <Loader2 className="w-8 h-8 animate-spin text-neutral-600" />
                        </div>
                    ) : rules.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 py-24 border border-neutral-800 rounded-xl bg-[#121212]/50 border-dashed text-center">
                            <BookOpen className="w-12 h-12 text-neutral-700 mb-4" />
                            <h3 className="text-neutral-300 font-medium mb-1">No rules defined</h3>
                            <p className="text-neutral-500 text-sm max-w-sm">
                                Start defining your company playbook by adding a rule above.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {rules.map((rule) => (
                                <div
                                    key={rule.id}
                                    className="p-5 bg-[#121212] border border-neutral-800 rounded-xl hover:border-neutral-700 transition-colors shadow-sm group relative overflow-hidden"
                                >
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#d4af37]"></div>
                                    <div className="flex gap-4 pl-3">
                                        <div className="flex-1">
                                            {rule.standard_position ? (
                                                <div className="space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-2 py-0.5 bg-neutral-800 text-neutral-300 text-xs rounded-md font-medium border border-neutral-700">
                                                            {rule.category}
                                                        </span>
                                                        <span className={`px-2 py-0.5 text-xs rounded-md font-medium border ${
                                                            rule.risk_severity === 'High Risk' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                            rule.risk_severity === 'Medium Risk' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                                                            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                        }`}>
                                                            {rule.risk_severity}
                                                        </span>
                                                    </div>
                                                    
                                                    <div>
                                                        <p className="text-xs text-neutral-500 mb-1">Standard Position</p>
                                                        <p className="text-neutral-200 text-sm leading-relaxed">{rule.standard_position}</p>
                                                    </div>
                                                    
                                                    {(rule.fallback_position || rule.redline) && (
                                                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-neutral-800 border-dashed">
                                                            {rule.fallback_position && (
                                                                <div>
                                                                    <p className="text-xs text-emerald-500/70 mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Fallback</p>
                                                                    <p className="text-neutral-400 text-xs leading-relaxed">{rule.fallback_position}</p>
                                                                </div>
                                                            )}
                                                            {rule.redline && (
                                                                <div>
                                                                    <p className="text-xs text-red-500/70 mb-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Redline</p>
                                                                    <p className="text-neutral-400 text-xs leading-relaxed">{rule.redline}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-neutral-200 leading-relaxed text-sm">
                                                    {rule.rule_text}
                                                </p>
                                            )}
                                            <p className="text-[10px] text-neutral-500 mt-4 font-mono">
                                                ID: {rule.id} | Added: {new Date(rule.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
