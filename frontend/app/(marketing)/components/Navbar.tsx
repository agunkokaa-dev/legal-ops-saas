'use client';

import { useEffect, useState } from 'react';
import { navLinks } from '@/lib/landing-data';
import { Icon } from './ui/Icon';
import { Logo } from './ui/Logo';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors ${
        isScrolled
          ? 'border-white/10 bg-[#08090b]/85 backdrop-blur-xl'
          : 'border-transparent bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
        <Logo size={44} showText={true} />

        <div className="hidden items-center gap-7 lg:flex">
          {navLinks.map(([label, href]) => (
            <a key={label} href={href} className="text-sm text-white/55 transition-colors hover:text-white">
              {label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href="https://clause.id/sign-in"
            className="px-3 py-2 text-sm text-white/60 transition-colors hover:text-white"
            aria-label="Sign in to clause.id"
          >
            Sign In
          </a>
          <a
            href="#trial"
            className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/[0.02] px-4 py-2.5 text-sm text-white transition-colors hover:border-white/30 hover:bg-white/[0.05]"
            aria-label="Start free trial"
          >
            Free Trial
          </a>
          <a
            href="#demo"
            className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white px-4 py-2.5 text-sm font-medium text-[#08090b] transition-colors hover:bg-white/90"
            aria-label="Book a demo"
          >
            Book a Demo
          </a>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white lg:hidden"
          aria-label="Toggle navigation"
          onClick={() => setIsOpen((current) => !current)}
        >
          <Icon name={isOpen ? 'x' : 'menu'} className="text-[20px]" />
        </button>
      </nav>

      {isOpen && (
        <div className="border-t border-white/10 bg-[#08090b]/95 px-5 py-4 backdrop-blur-xl lg:hidden">
          <div className="grid gap-3">
            <div className="mb-2">
              <Logo size={44} showText={true} />
            </div>
            {navLinks.map(([label, href]) => (
              <a
                key={label}
                href={href}
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70"
              >
                {label}
              </a>
            ))}
            <div className="my-1 border-t border-white/10" />
            <a
              href="https://clause.id/sign-in"
              onClick={() => setIsOpen(false)}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70"
              aria-label="Sign in"
            >
              Sign In
            </a>
            <a
              href="#trial"
              onClick={() => setIsOpen(false)}
              className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-white/80"
              aria-label="Free trial"
            >
              Start Free Trial
            </a>
            <a
              href="#demo"
              onClick={() => setIsOpen(false)}
              className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-[#08090b]"
              aria-label="Book demo"
            >
              Book a Demo
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
