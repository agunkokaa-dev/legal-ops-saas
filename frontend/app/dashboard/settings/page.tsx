import Link from 'next/link';
import { ListTodo, BookOpenText, Headphones } from 'lucide-react';
import { FeedbackTriggerButton } from './FeedbackTriggerButton';

export default function SettingsPage() {
    return (
        <div className="flex-1 w-full h-full p-8 bg-[#0a0a0a] text-white overflow-y-auto">

            {/* Page Header */}
            <div className="mb-10 max-w-5xl mx-auto">
                <h1 className="text-3xl font-serif font-medium tracking-tight mb-2">Settings</h1>
                <p className="text-neutral-400 text-sm">Manage your workspace preferences, compliance rules, and account details.</p>
            </div>

            {/* Settings Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">

                {/* 1. Company Playbook */}
                <Link href="/dashboard/settings/playbook" className="group flex flex-col p-6 bg-[#121212] border border-neutral-800 rounded-xl hover:border-[#B8B8B8]/50 hover:bg-[#1a1a1a] transition-all duration-300 shadow-sm relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-[#D4D4D4] transition-colors"></div>
                    <div className="w-10 h-10 rounded-lg bg-[#B8B8B8]/10 flex items-center justify-center mb-4 text-[#B8B8B8] group-hover:scale-110 transition-transform">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                    <h2 className="text-lg font-medium text-neutral-200 mb-2">Company Playbook</h2>
                    <p className="text-sm text-neutral-500 leading-relaxed">
                        Define custom contract rules and compliance guidelines. Our AI will automatically enforce these during document review.
                    </p>
                </Link>

                {/* 1A. Clause Library */}
                <Link href="/dashboard/settings/clause-library" className="group">
                    <div className="h-full bg-[#141414] border border-white/5 hover:border-[#B8B8B8]/50 rounded-xl p-6 transition-all duration-300 shadow-lg hover:shadow-[#B8B8B8]/10 flex flex-col gap-4 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-[#B8B8B8]/0 via-transparent to-[#B8B8B8]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        <div className="w-10 h-10 rounded-lg bg-[#0f0f0f] border border-white/10 group-hover:border-[#B8B8B8]/30 flex items-center justify-center transition-colors">
                            <BookOpenText className="w-5 h-5 text-zinc-400 group-hover:text-[#B8B8B8] transition-colors" />
                        </div>
                        <div>
                            <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-[#B8B8B8] transition-colors">Clause Library</h3>
                            <p className="text-sm text-zinc-500 leading-relaxed">
                                Manage approved standard and fallback clauses. Our AI will suggest these semantically during contract reviews and drafting.
                            </p>
                        </div>
                    </div>
                </Link>

                {/* 2. Account Profile (Placeholder) */}
                <div className="flex flex-col p-6 bg-[#121212]/50 border border-neutral-800/50 rounded-xl opacity-75 cursor-not-allowed relative">
                    <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center mb-4 text-neutral-400">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </div>
                    <h2 className="text-lg font-medium text-neutral-400 mb-2">Account &amp; Profile</h2>
                    <p className="text-sm text-neutral-600 leading-relaxed">Manage your personal information, security, and preferences.</p>
                    <span className="mt-4 text-[10px] uppercase tracking-widest text-neutral-600 font-semibold">Coming Soon</span>
                </div>

                {/* 3. Team Management (Placeholder) */}
                <div className="flex flex-col p-6 bg-[#121212]/50 border border-neutral-800/50 rounded-xl opacity-75 cursor-not-allowed relative">
                    <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center mb-4 text-neutral-400">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    </div>
                    <h2 className="text-lg font-medium text-neutral-400 mb-2">Workspace Team</h2>
                    <p className="text-sm text-neutral-600 leading-relaxed">Invite colleagues, assign roles, and manage permissions.</p>
                    <span className="mt-4 text-[10px] uppercase tracking-widest text-neutral-600 font-semibold">Coming Soon</span>
                </div>

                {/* 4. Task Templates (SOP) */}
                <Link href="/dashboard/settings/templates" className="group block bg-white/5 border border-white/10 hover:border-[#3A3A3A] p-6 rounded-xl transition-all duration-300 hover:bg-white/10 cursor-pointer">
                    <div className="w-10 h-10 rounded-lg bg-[#B8B8B8]/10 flex items-center justify-center mb-4 group-hover:bg-[#B8B8B8]/20 transition-colors">
                        <ListTodo className="text-[#B8B8B8]" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-[#B8B8B8] transition-colors">Task Templates (SOP)</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                        Create and manage standardized task workflows and SOPs. Apply these templates to instantly populate your Kanban board.
                    </p>
                </Link>

                {/* 5. Customer Support */}
                <div className="flex flex-col p-6 bg-white/5 border border-white/10 hover:border-zinc-600 rounded-xl transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center mb-4">
                        <Headphones size={18} className="text-zinc-400" />
                    </div>
                    <h3 className="text-base font-semibold text-white mb-2">Customer Support</h3>
                    <p className="text-sm text-zinc-500 leading-6 mb-5">
                        Butuh bantuan atau ingin memberikan masukan? Hubungi tim kami atau kirim feedback langsung dari sini.
                    </p>

                    <div className="flex flex-col gap-2 mt-auto">
                        {/* WhatsApp */}
                        <a
                            href="https://wa.me/6281288858870?text=Halo%2C%20saya%20butuh%20bantuan%20dengan%20clause.id"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white hover:border-[#25D366]/40 hover:bg-[#25D366]/5 transition-colors group"
                        >
                            <svg className="h-4 w-4 text-[#25D366] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                            </svg>
                            <span>Chat via WhatsApp</span>
                            <span className="ml-auto text-xs text-zinc-500 group-hover:text-[#25D366] transition-colors">→</span>
                        </a>

                        {/* Feedback */}
                        <FeedbackTriggerButton />
                    </div>
                </div>

            </div>
        </div>
    );
}
