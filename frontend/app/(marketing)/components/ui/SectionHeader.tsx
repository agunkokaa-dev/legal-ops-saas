'use client';

import { motion } from 'framer-motion';

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'left',
}: SectionHeaderProps) {
  const isCenter = align === 'center';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`mb-10 max-w-3xl ${isCenter ? 'mx-auto text-center' : ''}`}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-white/40">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="mt-5 text-sm leading-7 text-white/55 md:text-base">
          {description}
        </p>
      )}
    </motion.div>
  );
}
