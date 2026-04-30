'use client';

import { useEffect, useMemo, useState } from 'react';

interface WAFloatingButtonProps {
  phoneNumber?: string;
  message?: string;
  position?: 'bottom-right' | 'bottom-left';
  showLabel?: boolean;
}

const WA_NUMBER = '628xxxxxxxxxx';
const DEFAULT_MESSAGE = 'Halo, saya ingin bertanya tentang clause.id';

export function WAFloatingButton({
  phoneNumber = WA_NUMBER,
  message = DEFAULT_MESSAGE,
  position = 'bottom-right',
  showLabel = false,
}: WAFloatingButtonProps) {
  const [visible, setVisible] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  const waUrl = useMemo(
    () => `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`,
    [message, phoneNumber],
  );

  if (!visible) {
    return null;
  }

  const isRight = position === 'bottom-right';
  const positionClass = isRight ? 'bottom-6 right-6' : 'bottom-6 left-6';

  return (
    <div className={`fixed ${positionClass} z-[90] flex items-center gap-3`}>
      {isRight && showTooltip && (
        <div className="support-tooltip-in relative rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs whitespace-nowrap text-white/80 shadow-xl">
          Ada yang bisa kami bantu?
          <div className="absolute right-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-white/10 bg-zinc-900" />
        </div>
      )}

      {showLabel && isRight && (
        <span className="hidden rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-white/70 shadow-lg sm:inline-flex">
          Chat dengan kami
        </span>
      )}

      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat via WhatsApp"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-[#25D366]/25 transition-all duration-200 hover:scale-110 hover:bg-[#22c55e] hover:shadow-[#25D366]/40 active:scale-95"
      >
        <svg
          className="relative z-10 h-7 w-7"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>

        {showLabel && (
          <span className="absolute h-14 w-14 rounded-full bg-[#25D366]/30 opacity-75 group-hover:opacity-0 motion-safe:animate-ping" />
        )}
      </a>

      {showLabel && !isRight && (
        <span className="hidden rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-white/70 shadow-lg sm:inline-flex">
          Chat dengan kami
        </span>
      )}

      {!isRight && showTooltip && (
        <div className="support-tooltip-in relative rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs whitespace-nowrap text-white/80 shadow-xl">
          Ada yang bisa kami bantu?
          <div className="absolute left-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-white/10 bg-zinc-900" />
        </div>
      )}
    </div>
  );
}
