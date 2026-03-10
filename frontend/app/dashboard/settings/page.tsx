import Link from 'next/link';
import { ListTodo } from 'lucide-react';

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

                {/* 1. Company Playbook (Active Link) */}
                <Link href="/dashboard/settings/playbook" className="group flex flex-col p-6 bg-[#121212] border border-neutral-800 rounded-xl hover:border-[#d4af37]/50 hover:bg-[#1a1a1a] transition-all duration-300 shadow-sm relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-[#d4af37] transition-colors"></div>
                    <div className="w-10 h-10 rounded-lg bg-[#d4af37]/10 flex items-center justify-center mb-4 text-[#d4af37] group-hover:scale-110 transition-transform">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                    <h2 className="text-lg font-medium text-neutral-200 mb-2">Company Playbook</h2>
                    <p className="text-sm text-neutral-500 leading-relaxed">
                        Define custom contract rules and compliance guidelines. Our AI will automatically enforce these during document review.
                    </p>
                </Link>

                {/* 2. Account Profile (Placeholder) */}
                <div className="flex flex-col p-6 bg-[#121212]/50 border border-neutral-800/50 rounded-xl opacity-75 cursor-not-allowed relative">
                    <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center mb-4 text-neutral-400">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </div>
                    <h2 className="text-lg font-medium text-neutral-400 mb-2">Account & Profile</h2>
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

                {/* 4. Task Templates (SOP) Card */}
                <Link href="/dashboard/settings/templates" className="group block bg-white/5 border border-white/10 hover:border-clause-gold/50 p-6 rounded-xl transition-all duration-300 hover:bg-white/10 cursor-pointer">
                    <div className="w-10 h-10 rounded-lg bg-clause-gold/10 flex items-center justify-center mb-4 group-hover:bg-clause-gold/20 transition-colors">
                        <ListTodo className="text-clause-gold" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-clause-gold transition-colors">Task Templates (SOP)</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                        Create and manage standardized task workflows and SOPs. Apply these templates to instantly populate your Kanban board.
                    </p>
                </Link>

            </div>
        </div>
    );
}
