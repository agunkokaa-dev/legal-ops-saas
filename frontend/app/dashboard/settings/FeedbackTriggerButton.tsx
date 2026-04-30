'use client';

import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { FeedbackModal } from '@/components/support/FeedbackModal';

export function FeedbackTriggerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white w-full hover:border-zinc-600 hover:bg-zinc-900 transition-colors group text-left"
      >
        <MessageSquarePlus size={16} className="text-zinc-400 shrink-0" />
        <span>Kirim Feedback atau Laporkan Bug</span>
        <span className="ml-auto text-xs text-zinc-500">→</span>
      </button>
      <FeedbackModal isOpen={open} onClose={() => setOpen(false)} currentPath="/dashboard/settings" />
    </>
  );
}
