'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import { FeedbackModal } from './FeedbackModal';

export function FeedbackButton() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Kirim feedback"
        className="fixed bottom-6 left-6 z-[90] flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs text-zinc-400 shadow-lg transition-all duration-200 hover:scale-105 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 active:scale-95"
      >
        <MessageSquarePlus size={13} />
        <span>Feedback</span>
      </button>

      <FeedbackModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        currentPath={pathname}
      />
    </>
  );
}
