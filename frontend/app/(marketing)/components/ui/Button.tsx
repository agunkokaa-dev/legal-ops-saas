import type { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  href?: string;
  variant?: 'primary' | 'secondary';
  className?: string;
  ariaLabel?: string;
}

export function Button({
  children,
  href = '#',
  variant = 'primary',
  className = '',
  ariaLabel,
}: ButtonProps) {
  const styles = variant === 'primary'
    ? 'border-white/20 bg-white text-[#08090b] hover:bg-white/90'
    : 'border-white/15 bg-white/[0.03] text-white hover:border-white/30 hover:bg-white/[0.06]';

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center rounded-full border px-5 py-3 text-sm font-medium transition-colors ${styles} ${className}`}
    >
      {children}
    </a>
  );
}
