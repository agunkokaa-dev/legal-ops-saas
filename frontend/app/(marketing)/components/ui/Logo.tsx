// app/(marketing)/components/ui/Logo.tsx
import Image from 'next/image';
import Link from 'next/link';

interface LogoProps {
  size?: number;        // ukuran logo dalam px, default 36
  showText?: boolean;   // tampilkan text "clause.id", default true
  href?: string;        // link tujuan, default "#top"
  className?: string;
}

export function Logo({
  size = 44,
  showText = true,
  href = "#top",
  className = "",
}: LogoProps) {
  return (
    <Link
      href={href}
      aria-label="Go to clause.id home"
      className={`flex items-center gap-3 group ${className}`}
    >
      {/* Logo image — cropped to spiral, ~square aspect */}
      <div
        className="relative shrink-0 flex items-center justify-center"
        style={{ width: size, height: size, minWidth: size }}
      >
        <Image
          src="/logo_clause.png"
          alt="clause.id logo"
          width={size * 3}
          height={size * 3}
          sizes={`${size}px`}
          className="object-contain w-full h-full"
          quality={100}
          priority
        />
      </div>

      {/* Wordmark */}
      {showText && (
        <span className="text-base font-semibold tracking-[-0.04em] text-white group-hover:text-white/80 transition-colors">
          clause.id
        </span>
      )}
    </Link>
  );
}
