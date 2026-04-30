'use client';

import { useState } from 'react';
import { faqItems } from '@/lib/landing-data';
import { SectionHeader } from './ui/SectionHeader';
import { Icon } from './ui/Icon';

export function FAQ() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-4xl">
        <SectionHeader
          eyebrow="FAQ"
          title="Questions legal teams ask first."
          description="Short answers for the operational and technical questions that matter before adoption."
          align="center"
        />

        <div className="space-y-3">
          {faqItems.map(([question, answer], index) => {
            const isOpen = openIndex === index;
            return (
              <div key={question} className="rounded-2xl border border-white/10 bg-white/[0.025]">
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? -1 : index)}
                  className="flex w-full items-center justify-between gap-5 px-5 py-4 text-left"
                >
                  <span className="text-sm font-medium text-white">{question}</span>
                  <Icon name={isOpen ? 'x' : 'spark'} className="shrink-0 text-[16px] text-white/40" />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-sm leading-7 text-white/50">
                    {answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
