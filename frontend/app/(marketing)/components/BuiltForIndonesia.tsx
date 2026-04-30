'use client';

import { motion } from 'framer-motion';
import { indonesiaItems } from '@/lib/landing-data';
import { SectionHeader } from './ui/SectionHeader';
import { Icon } from './ui/Icon';

export function BuiltForIndonesia() {
  return (
    <section className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Built for Indonesia"
          title="Designed around Indonesian legal workflows."
          description="The product supports bilingual work, local regulatory context, and practical legal operations after signature."
          align="center"
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {indonesiaItems.map(([title, description], index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.45, delay: index * 0.04 }}
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
            >
              <Icon name="globe" className="mb-5 text-[22px] text-white/45" />
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              <p className="mt-3 text-xs leading-6 text-white/45">{description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
