'use client'
import { useState } from 'react'

export default function DocumentList({ documents }: { documents: any[] }) {
    const [selectedDoc, setSelectedDoc] = useState<any | null>(null)

    const getRiskColor = (risk: string) => {
        switch (risk?.toLowerCase()) {
            case 'high': return 'bg-red-500/20 text-red-500 border border-red-500/50 shadow-[0_0_12px_rgba(220,38,38,0.3)]'
            case 'medium': return 'bg-amber-500/20 text-amber-500 border border-amber-500/50'
            case 'low': return 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/50'
            default: return 'bg-surface-border text-text-muted border border-surface-border'
        }
    }

    return (
        <>
            <div className="bg-surface border border-surface-border rounded overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-border flex justify-between items-center bg-background-dark/30">
                    <h3 className="font-display text-xl text-white">Document Intelligence</h3>
                    <button suppressHydrationWarning className="text-sm text-primary hover:text-white transition-colors">View All Documents</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-surface-border/20 text-text-muted text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-3 font-medium">Document</th>
                                <th className="px-6 py-3 font-medium">Date</th>
                                <th className="px-6 py-3 font-medium text-right">Risk Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-border text-sm">
                            {documents.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-6 py-8 text-center text-text-muted">No documents found.</td>
                                </tr>
                            ) : (
                                documents.map((doc) => (
                                    <tr
                                        key={doc.id}
                                        onClick={() => setSelectedDoc(doc)}
                                        className="hover:bg-white/5 transition-colors cursor-pointer group"
                                    >
                                        <td className="px-6 py-4 text-white font-medium flex items-center gap-3">
                                            <span className="material-symbols-outlined text-primary/70 group-hover:text-primary transition-colors">description</span>
                                            {doc.title || 'Unknown Document'}
                                        </td>
                                        <td className="px-6 py-4 text-text-muted whitespace-nowrap font-mono text-xs">
                                            {new Date(doc.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${getRiskColor(doc.risk_level)}`}>
                                                {doc.risk_level || 'Pending'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Document Drawer / Modal */}
            {selectedDoc && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setSelectedDoc(null)}>
                    <div
                        className="w-full max-w-md bg-surface border-l border-surface-border h-full shadow-2xl flex flex-col transform transition-transform"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-surface-border flex justify-between items-start bg-background-dark/80 backdrop-blur-md">
                            <div>
                                <h2 className="font-display text-2xl text-white mb-1.5">{selectedDoc.title}</h2>
                                <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Doc ID: {selectedDoc.id}</p>
                            </div>
                            <button suppressHydrationWarning onClick={() => setSelectedDoc(null)} className="text-text-muted hover:text-white transition-colors bg-surface-border/50 hover:bg-surface-border p-1.5 rounded-full flex items-center justify-center">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">

                            {/* Intelligence Cards */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-background-dark/50 border border-surface-border p-4 rounded flex flex-col gap-1.5">
                                    <span className="text-[10px] text-text-muted uppercase tracking-widest font-semibold flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[14px]">payments</span>
                                        Contract Value
                                    </span>
                                    <span className="font-mono text-xl text-primary font-medium">{selectedDoc.contract_value || 'N/A'}</span>
                                </div>
                                <div className="bg-background-dark/50 border border-surface-border p-4 rounded flex flex-col gap-1.5">
                                    <span className="text-[10px] text-text-muted uppercase tracking-widest font-semibold flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[14px]">event</span>
                                        End Date
                                    </span>
                                    <span className="font-mono text-xl text-white font-medium">{selectedDoc.end_date || 'N/A'}</span>
                                </div>
                            </div>

                            {/* Risk Overview */}
                            <div className="bg-background-dark/50 border border-surface-border p-4 rounded flex flex-col gap-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-text-muted uppercase tracking-widest font-semibold">AI Risk Assessment</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getRiskColor(selectedDoc.risk_level)}`}>
                                        {selectedDoc.risk_level || 'Pending'}
                                    </span>
                                </div>
                            </div>

                            {/* Compliance Issues */}
                            <div>
                                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[16px]">gavel</span>
                                    Compliance Issues
                                </h3>
                                {selectedDoc.smart_metadata?.compliance_issues && selectedDoc.smart_metadata.compliance_issues.length > 0 ? (
                                    <ul className="flex flex-col gap-2">
                                        {selectedDoc.smart_metadata.compliance_issues.map((issue: string, idx: number) => (
                                            <li key={idx} className="flex gap-3 bg-red-500/5 border border-red-500/20 p-3 rounded items-start">
                                                <span className="material-symbols-outlined text-red-400 text-sm mt-0.5">warning</span>
                                                <span className="text-sm text-red-100/90 leading-relaxed font-mono">{issue}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="flex items-center gap-3 text-sm text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 p-4 rounded-lg">
                                        <span className="material-symbols-outlined text-xl">check_circle</span>
                                        <span className="font-mono">No critical compliance issues flagged by AI.</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
