'use client';

import { motion } from 'framer-motion';
import { workflowSteps } from '@/lib/landing-data';
import { SectionHeader } from './ui/SectionHeader';

export function HowItWorks() {
  return (
    <section className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="How it works"
          title="From upload to execution, every decision stays traceable."
          description="The workflow is designed for legal teams that need speed without losing professional control."
        />

        <div className="grid gap-4 md:grid-cols-5">
          {workflowSteps.map(([title, description], index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.45, delay: index * 0.05 }}
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
            >
              <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-xs text-white/50">
                {String(index + 1).padStart(2, '0')}
              </div>
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              <p className="mt-3 text-xs leading-6 text-white/45">{description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
