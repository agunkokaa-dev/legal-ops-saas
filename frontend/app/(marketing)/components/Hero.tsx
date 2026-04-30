'use client';

import { motion } from 'framer-motion';
import { Button } from './ui/Button';
import { DashboardMockup } from './DashboardMockup';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-20 md:px-8 md:pb-28 md:pt-28">
      <div className="absolute left-1/2 top-0 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-white/[0.06] blur-3xl" />
      <div className="relative mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="mx-auto max-w-4xl text-center"
        >
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.32em] text-white/40">
            AI-Native Contract Intelligence for Indonesia
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-white md:text-7xl">
            Review contracts, negotiate with evidence, and manage legal execution.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-white/58 md:text-lg">
            An AI-native workspace for Indonesian legal teams to move from contract review to negotiation, execution, and obligations with source-backed reasoning.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="#demo">Book a Demo</Button>
            <Button href="#features" variant="secondary">
              Explore Features
            </Button>
          </div>
        </motion.div>
        <DashboardMockup />
      </div>
    </section>
  );
}
