export default function PDFViewerPlaceholder() {
    return (
        <div className="flex-1 flex flex-col bg-background relative z-10 w-full h-full">
            {/* Toolbar */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center pointer-events-none w-full">
                <div className="pointer-events-auto bg-surface/80 backdrop-blur-md rounded-full border border-surface-border/50 flex items-center px-1 py-1 shadow-lg gap-1">
                    <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-sm">search</span>
                    </button>
                    <div className="h-4 w-px bg-surface-border/50 mx-1"></div>
                    <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-sm">remove</span>
                    </button>
                    <span className="text-xs text-white font-mono px-2">100%</span>
                    <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-sm">add</span>
                    </button>
                    <div className="h-4 w-px bg-surface-border/50 mx-1"></div>
                    <div className="flex bg-black/40 rounded-full p-0.5">
                        <button className="px-3 py-1 text-[10px] font-medium rounded-full bg-white/10 text-white shadow-sm border border-white/5">Original</button>
                        <button className="px-3 py-1 text-[10px] font-medium rounded-full text-text-muted hover:text-white flex items-center gap-1 transition-colors">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#B8B8B8]"></span> AI Redline
                        </button>
                    </div>
                </div>
            </div>

            <div className="absolute top-6 right-6 z-30 pointer-events-none opacity-0">
                <div className="text-xs text-text-muted animate-pulse">Loading...</div>
            </div>

            {/* Scrollable Document Area */}
            <div className="flex-1 overflow-y-auto p-8 flex justify-center bg-background scroll-smooth pt-24">
                <div
                    className="w-full max-w-4xl bg-white min-h-[1200px] relative p-16 text-[#0A0A0A] font-sans text-sm leading-relaxed rounded-2xl shadow-2xl"
                    style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)' }}
                >
                    <div className="flex items-center justify-between mb-8 border-b border-gray-200 pb-2">
                        <div className="flex items-center gap-2 text-gray-400">
                            <span className="text-[10px] uppercase tracking-widest font-bold">Confidential</span>
                        </div>
                        <div className="text-gray-400 text-[10px] font-mono">Page 1 / 4</div>
                    </div>

                    <h1 className="text-3xl font-serif font-bold text-center mb-12 uppercase tracking-wide text-gray-900">Perjanjian Pengikatan Jual Beli (PPJB)...</h1>

                    <p className="mb-6 text-justify text-gray-800">
                        THIS AGREEMENT (the "Agreement") is made and entered into as of [Date] by and between <strong>GOJEK</strong>, a company organized under the laws of Indonesia ("Disclosing Party"), and <strong>[Counterparty Name]</strong>, a company organized under the laws of Singapore ("Receiving Party").
                    </p>
                    <p className="mb-6 text-justify text-gray-800">
                        1. <strong className="font-serif text-lg">Purpose.</strong> The parties wish to explore a business opportunity of mutual interest and in connection with this opportunity, each party may disclose to the other certain confidential technical and business information which the disclosing party desires the receiving party to treat as confidential.
                    </p>
                    <p className="mb-6 text-justify text-gray-800">
                        2. <strong className="font-serif text-lg">Confidential Information.</strong> "Confidential Information" means any information disclosed by either party to the other party, either directly or indirectly, in writing, orally or by inspection of tangible objects.
                    </p>

                    <div className="bg-[#E8E8E8] rounded-lg p-4 -mx-4 border-l-2 border-[#B8B8B8]/50 my-6">
                        <p className="mb-0 text-justify text-gray-800">
                            3. <strong className="font-serif text-lg">Exceptions.</strong> Confidential Information shall not include any information which (i) was publicly known and made generally available in the public domain prior to the time of disclosure by the disclosing party.
                        </p>
                    </div>

                    <p className="mb-6 text-justify text-gray-800">
                        4. <strong className="font-serif text-lg">Term.</strong> This Agreement shall remain in effect for a period of ten (10) years from the Effective Date unless terminated earlier by either party with thirty (30) days prior written notice.
                    </p>
                </div>
            </div>
        </div>
    )
}
