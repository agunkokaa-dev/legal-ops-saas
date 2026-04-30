import { navLinks } from '@/lib/landing-data';
import { Logo } from './ui/Logo';

export function Footer() {
  return (
    <footer className="border-t border-white/10 px-5 py-10 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="mt-4 text-xs text-white/40">
            AI-native contract intelligence for Indonesian legal teams.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          {navLinks.map(([label, href]) => (
            <a key={label} href={href} className="text-xs text-white/45 transition-colors hover:text-white">
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
