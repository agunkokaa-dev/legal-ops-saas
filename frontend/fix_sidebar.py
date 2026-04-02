import re

with open('/root/workspace-saas/frontend/components/war-room/WarRoomClient.tsx', 'r') as f:
    content = f.read()

pattern = re.compile(
    r'<h4 className="text-\[10px\] text-zinc-500 tracking-\[0\.2em\] uppercase font-bold mb-4">Version History</h4>.*?(<div className="pt-2">)',
    re.DOTALL
)

replacement = """<h4 className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase font-bold mb-4">Lineage Overview</h4>
                        <div className="space-y-3 mb-6">
                            <div className="p-3 bg-[#111] border border-zinc-800/60 rounded flex justify-between items-center opacity-70">
                                <div>
                                    <span className="text-xs font-bold font-serif text-zinc-400 block break-words max-w-[120px]">Baseline (V1)</span>
                                    <span className="text-[9px] text-zinc-600 uppercase">System Record</span>
                                </div>
                                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 flex-shrink-0 py-0.5 rounded border border-zinc-700">Source</span>
                            </div>
                            <div className="w-0.5 h-4 bg-zinc-800 ml-6"></div>
                            
                            <div className="p-3 bg-[#111] border border-[#D4AF37]/20 rounded flex justify-between items-center">
                                <div>
                                    <span className="text-xs font-bold font-serif text-[#D4AF37] block break-words max-w-[120px]">Round 1 (V2)</span>
                                    <span className="text-[9px] text-zinc-500 uppercase">Counterparty Upload</span>
                                </div>
                                <span className="text-[10px] bg-[#D4AF37]/10 text-[#D4AF37] px-2 flex-shrink-0 py-0.5 rounded border border-[#D4AF37]/20">Active Diff</span>
                            </div>

                            {v3_working && (
                                <>
                                    <div className="w-0.5 h-4 bg-[#D4AF37]/40 ml-6"></div>
                                    <div className="p-3 bg-[#1a2e1a] border border-emerald-900/60 rounded flex justify-between items-center shadow-[0_0_15px_rgba(16,185,129,0.05)]">
                                        <div>
                                            <span className="text-xs font-bold font-serif text-emerald-400 block break-words max-w-[120px]">Working Draft (V3)</span>
                                            <span className="text-[9px] text-emerald-600/80 uppercase">Merges</span>
                                        </div>
                                        <span className="text-[10px] bg-emerald-900/30 font-bold text-emerald-400 flex-shrink-0 px-2 py-0.5 rounded border border-emerald-800/50 flex gap-1 items-center">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                            Live
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                        \\1"""

new_content, count = pattern.subn(replacement, content)
print(f"Replacements made: {count}")

with open('/root/workspace-saas/frontend/components/war-room/WarRoomClient.tsx', 'w') as f:
    f.write(new_content)
