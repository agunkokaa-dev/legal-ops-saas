'use client';

import { motion } from 'framer-motion';
import { GlassCard } from './ui/GlassCard';
import { Tag } from './ui/Tag';
import { Logo } from './ui/Logo';

export function DashboardMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
      className="relative mx-auto mt-14 max-w-6xl"
    >
      <div className="absolute inset-0 rounded-[2rem] bg-white/10 blur-3xl" />
      <GlassCard className="relative overflow-hidden rounded-[2rem] p-3">
        <div className="rounded-[1.5rem] border border-white/10 bg-[#0b0d12]">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-400/80" />
              <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
            </div>
            <div className="text-xs text-white/35">Agreement Intelligence Workspace</div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[240px_1fr_300px]">
            <aside className="hidden border-r border-white/10 p-5 lg:block">
              <div className="mb-6">
                <Logo size={32} showText={true} />
              </div>
              <p className="mb-4 text-xs uppercase tracking-[0.25em] text-white/30">Matter</p>
              {['MSA Master Agreement', 'Data Processing Addendum', 'Statement of Work'].map((item, index) => (
                <div
                  key={item}
                  className={`mb-3 rounded-xl border px-3 py-3 text-xs ${
                    index === 0
                      ? 'border-white/15 bg-white/[0.06] text-white'
                      : 'border-white/10 bg-white/[0.02] text-white/45'
                  }`}
                >
                  {item}
                </div>
              ))}
            </aside>

            <main className="p-5">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <Tag>Risk Score 42</Tag>
                <Tag>4 obligations</Tag>
                <Tag>2 negotiation issues</Tag>
              </div>
              <div className="space-y-3">
                {[
                  ['Liability Cap', 'Cap aligned with standard position, but carve-outs require review.'],
                  ['Data Processing', 'Processing purpose and transfer language require source-backed review.'],
                  ['Termination', 'Notice period is present and mapped to the source clause.'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-white">{title}</p>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Source</span>
                    </div>
                    <p className="text-xs leading-5 text-white/45">{body}</p>
                  </div>
                ))}
              </div>
            </main>

            <aside className="border-t border-white/10 p-5 lg:border-l lg:border-t-0">
              <p className="mb-4 text-xs uppercase tracking-[0.25em] text-white/30">Counsel Notes</p>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">Source-backed summary</p>
                <p className="mt-3 text-xs leading-6 text-white/45">
                  Findings stay tied to contract text, playbook standards, and regulatory context.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
