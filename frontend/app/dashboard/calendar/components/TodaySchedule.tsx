import type { CalendarEvent } from '../page';
import { EventDot } from './EventDot';

interface TodayScheduleProps {
  events: CalendarEvent[];
}

export function TodaySchedule({ events }: TodayScheduleProps) {
  const dateText = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Today&apos;s Schedule</h3>
        <span className="shrink-0 text-xs text-text-muted">{dateText}</span>
      </div>

      {events.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">No events today</p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-3">
              <div className="mt-1.5">
                <EventDot eventType={event.event_type} priority={event.priority} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{event.title}</p>
                <p className="text-xs text-text-muted">
                  {event.event_time || 'All day'}
                  {event.location ? ` - ${event.location}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-surface-border pt-3">
        <p className="text-xs text-text-muted">
          {events.length} event{events.length !== 1 ? 's' : ''} today
        </p>
      </div>
    </div>
  );
}
