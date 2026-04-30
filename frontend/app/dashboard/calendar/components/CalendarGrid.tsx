'use client';

import type { CalendarEvent } from '../page';
import { formatLocalDateKey } from '../dateUtils';
import { EventDot } from './EventDot';

interface CalendarGridProps {
  currentDate: Date;
  events: CalendarEvent[];
  isLoading: boolean;
  onDateClick: (date: Date) => void;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface CalendarCell {
  date: Date;
  isCurrentMonth: boolean;
}

function buildCells(currentDate: Date): CalendarCell[] {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let index = firstDay - 1; index >= 0; index -= 1) {
    cells.push({
      date: new Date(year, month - 1, daysInPrevMonth - index),
      isCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
  }

  const remaining = 42 - cells.length;
  for (let day = 1; day <= remaining; day += 1) {
    cells.push({ date: new Date(year, month + 1, day), isCurrentMonth: false });
  }

  return cells;
}

export function CalendarGrid({ currentDate, events, isLoading, onDateClick }: CalendarGridProps) {
  const cells = buildCells(currentDate);
  const todayKey = formatLocalDateKey(new Date());

  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
    if (!acc[event.event_date]) {
      acc[event.event_date] = [];
    }
    acc[event.event_date].push(event);
    return acc;
  }, {});

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border bg-surface">
      <div className="grid grid-cols-7 border-b border-surface-border">
        {DAYS.map((day) => (
          <div
            key={day}
            className="py-3 text-center text-xs font-medium uppercase tracking-wider text-text-muted"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map(({ date, isCurrentMonth }, index) => {
          const dateKey = formatLocalDateKey(date);
          const dayEvents = eventsByDate[dateKey] ?? [];
          const todayCell = dateKey === todayKey;

          return (
            <button
              key={`${dateKey}-${index}`}
              type="button"
              onClick={() => isCurrentMonth && onDateClick(date)}
              className={`flex h-28 flex-col overflow-hidden border-b border-r border-surface-border p-2 text-left transition-colors ${
                isCurrentMonth
                  ? 'cursor-pointer hover:bg-zinc-900/50'
                  : 'cursor-default opacity-30'
              }`}
              disabled={!isCurrentMonth}
            >
              <div
                className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
                  todayCell ? 'bg-primary text-zinc-900' : 'text-white'
                }`}
              >
                {date.getDate()}
              </div>

              <div className="flex flex-col gap-0.5 overflow-hidden">
                {isLoading && isCurrentMonth && dayEvents.length === 0 ? (
                  <span className="h-2 w-12 rounded bg-white/5" />
                ) : (
                  dayEvents.slice(0, 3).map((event) => (
                    <div key={event.id} className="flex min-w-0 items-center gap-1.5">
                      <EventDot eventType={event.event_type} priority={event.priority} />
                      <span className="truncate text-[10px] text-white/70">{event.title}</span>
                    </div>
                  ))
                )}
                {dayEvents.length > 3 && (
                  <span className="text-[10px] text-text-muted">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
