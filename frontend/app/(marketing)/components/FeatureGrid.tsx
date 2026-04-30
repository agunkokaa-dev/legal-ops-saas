'use client';

import { motion } from 'framer-motion';
import { features } from '@/lib/landing-data';
import { SectionHeader } from './ui/SectionHeader';
import { Icon } from './ui/Icon';

export function FeatureGrid() {
  return (
    <section className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Features"
          title="A complete legal workspace, not another document viewer."
          description="Review, negotiation, drafting, obligations, and task operations stay connected."
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, description], index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.42, delay: index * 0.025 }}
              className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.035]"
            >
              <Icon name="spark" className="mb-5 text-[22px] text-white/35 transition-colors group-hover:text-white/60" />
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              <p className="mt-3 text-xs leading-6 text-white/45">{description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
