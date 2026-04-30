import type { CalendarEvent } from '../page';
import { EventDot } from './EventDot';

interface UpcomingAgendaProps {
  events: CalendarEvent[];
}

function formatDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString('id-ID', {
    month: 'short',
    day: 'numeric',
  });
}

export function UpcomingAgenda({ events }: UpcomingAgendaProps) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Upcoming Agenda</h3>
        <span className="text-xs text-text-muted">Next 7 days</span>
      </div>

      {events.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">No upcoming events</p>
      ) : (
        <div className="space-y-3">
          {events.slice(0, 5).map((event) => (
            <div key={event.id} className="flex min-w-0 items-center gap-3">
              <span className="w-12 shrink-0 text-xs text-text-muted">
                {formatDate(event.event_date)}
              </span>
              <EventDot eventType={event.event_type} priority={event.priority} />
              <span className="min-w-0 flex-1 truncate text-sm text-white">{event.title}</span>
              {event.event_time && (
                <span className="shrink-0 text-xs text-text-muted">{event.event_time}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-surface-border pt-3">
        <p className="text-xs text-text-muted">
          {events.length} event{events.length !== 1 ? 's' : ''} this week
        </p>
      </div>
    </div>
  );
}
