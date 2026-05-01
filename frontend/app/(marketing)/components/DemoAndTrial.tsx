'use client';

import { useEffect, useState } from 'react';
import { BookDemoForm } from './BookDemoForm';
import { TrialRequestForm } from './TrialRequestForm';

type ActiveTab = 'demo' | 'trial';

export function DemoAndTrial() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('demo');

  useEffect(() => {
    const syncTabFromHash = () => {
      setActiveTab(window.location.hash === '#trial' ? 'trial' : 'demo');
    };

    syncTabFromHash();
    window.addEventListener('hashchange', syncTabFromHash);

    return () => window.removeEventListener('hashchange', syncTabFromHash);
  }, []);

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', tab === 'trial' ? '#trial' : '#demo');
  };

  return (
    <section id="demo" className="relative scroll-mt-28 overflow-hidden py-24 md:py-32">
      <span id="trial" className="absolute top-0 h-px w-px scroll-mt-28 overflow-hidden" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.04),transparent_60%)]"
      />

      <div className="relative mx-auto max-w-2xl px-5 md:px-8">
        <div className="mb-10 text-center">
          <p className="mb-4 inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
            Mulai sekarang
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
            Pilih cara yang tepat untuk Anda
          </h2>
          <p className="mt-4 text-base leading-7 text-white/50">
            Demo untuk tim yang ingin onboarding terstruktur. Trial untuk yang
            ingin eksplorasi mandiri terlebih dahulu.
          </p>
        </div>

        <div className="mb-8 flex rounded-2xl border border-white/10 bg-white/[0.02] p-1">
          <button
            type="button"
            onClick={() => selectTab('demo')}
            aria-pressed={activeTab === 'demo'}
            suppressHydrationWarning
            className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
              activeTab === 'demo'
                ? 'bg-white text-[#08090b]'
                : 'text-white/50 hover:text-white'
            }`}
          >
            Book a Demo
          </button>
          <button
            type="button"
            onClick={() => selectTab('trial')}
            aria-pressed={activeTab === 'trial'}
            suppressHydrationWarning
            className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
              activeTab === 'trial'
                ? 'bg-white text-[#08090b]'
                : 'text-white/50 hover:text-white'
            }`}
          >
            Free Trial (14 Hari)
          </button>
        </div>

        {activeTab === 'demo' ? (
          <p className="mb-6 text-center text-sm text-white/40">
            Cocok untuk: Law firm, corporate legal department, tim 3+ orang
          </p>
        ) : (
          <p className="mb-6 text-center text-sm text-white/40">
            Cocok untuk: In-house counsel, startup legal, eksplorasi mandiri
          </p>
        )}

        {activeTab === 'demo' ? <BookDemoForm /> : <TrialRequestForm />}
      </div>
    </section>
  );
}
