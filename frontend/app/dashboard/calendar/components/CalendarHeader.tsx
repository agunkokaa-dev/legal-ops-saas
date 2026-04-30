'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarHeaderProps {
  currentDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function CalendarHeader({ currentDate, onPrev, onNext, onToday }: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="grid h-8 w-8 place-items-center rounded-lg border border-surface-border text-text-muted transition-colors hover:border-zinc-600 hover:text-white"
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="min-w-[180px] text-center font-medium text-white">
          {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
        </div>
        <button
          type="button"
          onClick={onNext}
          className="grid h-8 w-8 place-items-center rounded-lg border border-surface-border text-text-muted transition-colors hover:border-zinc-600 hover:text-white"
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <button
        type="button"
        onClick={onToday}
        className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-zinc-600 hover:text-white"
      >
        Today
      </button>
    </div>
  );
}
