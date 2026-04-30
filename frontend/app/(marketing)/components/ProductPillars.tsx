'use client';

import { motion } from 'framer-motion';
import { pillars } from '@/lib/landing-data';
import { GlassCard } from './ui/GlassCard';
import { SectionHeader } from './ui/SectionHeader';
import { Tag } from './ui/Tag';

function EmptyDemoPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 rounded-full border border-white/10 bg-white/5" />
        <p className="text-xs text-white/25">{label}</p>
      </div>
    </div>
  );
}

function WarRoomDemo() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-red-400/15 bg-red-400/[0.04] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-red-200/45">Counterparty Edit</p>
          <p className="mt-3 text-sm text-white/75">Liability carve-outs expanded without reciprocal protection.</p>
        </div>
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-emerald-200/45">Fallback Position</p>
          <p className="mt-3 text-sm text-white/75">Accept carve-outs only with a mutual cap and notice obligation.</p>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-white">BATNA reasoning</span>
          <Tag>Medium</Tag>
        </div>
        <p className="text-xs leading-6 text-white/45">
          Version comparison stays tied to issue severity, fallback options, and negotiation evidence.
        </p>
      </div>
    </div>
  );
}

function PlaybookDemo() {
  return (
    <div className="space-y-4">
      {[
        ['Rule', 'Liability cap should not exceed fees paid in the prior 12 months.'],
        ['Fallback', 'If uncapped liability is required, restrict it to fraud, willful misconduct, and confidentiality.'],
        ['Severity', 'Escalate any unilateral indemnity above standard position.'],
      ].map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-white/30">{label}</p>
          <p className="mt-3 text-sm leading-6 text-white/70">{value}</p>
        </div>
      ))}
    </div>
  );
}

function IndonesiaDemo() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="mb-3 text-xs uppercase tracking-[0.22em] text-white/30">Bahasa Indonesia</p>
        <p className="text-sm leading-6 text-white/70">
          Para Pihak sepakat untuk memproses data pribadi sesuai ketentuan hukum yang berlaku.
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="mb-3 text-xs uppercase tracking-[0.22em] text-white/30">English</p>
        <p className="text-sm leading-6 text-white/70">
          The Parties agree to process personal data in accordance with applicable law.
        </p>
      </div>
    </div>
  );
}

function MiniDemo({ index }: { index: number }) {
  if (index === 0) return <EmptyDemoPlaceholder label="AI Review Preview" />;
  if (index === 1) return <WarRoomDemo />;
  if (index === 2) return <EmptyDemoPlaceholder label="Clause Assistant Preview" />;
  if (index === 3) return <EmptyDemoPlaceholder label="Document Genealogy Preview" />;
  if (index === 4) return <PlaybookDemo />;
  return <IndonesiaDemo />;
}

export function ProductPillars() {
  return (
    <section id="features" className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Product pillars"
          title="One workspace for contract review, negotiation, and legal operations."
          description="Each module is designed to keep legal judgment close to source evidence, internal standards, and execution work."
          align="center"
        />

        <div className="grid gap-6">
          {pillars.map(([name, title, description, tags], index) => (
            <motion.div
              key={name}
              id={index === 1 ? 'war-room' : index === 2 ? 'assistant' : undefined}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45, delay: index * 0.04 }}
            >
              <GlassCard className="grid gap-8 p-6 md:grid-cols-[0.9fr_1.1fr] md:p-8">
                <div className="flex flex-col justify-between gap-8">
                  <div>
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-white/35">
                      {name}
                    </p>
                    <h3 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                      {title}
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-white/55">{description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                </div>
                <MiniDemo index={index} />
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
