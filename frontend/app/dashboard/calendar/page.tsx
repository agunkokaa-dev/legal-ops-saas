'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getPublicApiBase } from '@/lib/public-api-base';
import { AddEventModal } from './components/AddEventModal';
import { CalendarGrid } from './components/CalendarGrid';
import { CalendarHeader } from './components/CalendarHeader';
import { TodaySchedule } from './components/TodaySchedule';
import { UpcomingAgenda } from './components/UpcomingAgenda';
import { UpcomingRenewals } from './components/UpcomingRenewals';

export interface CalendarEvent {
  id: string;
  title: string;
  event_date: string;
  event_time?: string | null;
  event_type: string;
  source: string;
  priority: string;
  location?: string | null;
  contract_id?: string | null;
  matter_id?: string | null;
  notes?: string | null;
}

export interface Renewal {
  id: string;
  title: string;
  counterparty?: string | null;
  end_date: string;
  days_left: number;
  urgency: 'critical' | 'warning' | 'normal';
}

interface EventsResponse {
  events?: CalendarEvent[];
}

interface RenewalsResponse {
  renewals?: Renewal[];
}

function formatMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const { getToken, isLoaded } = useAuth();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const month = useMemo(() => formatMonthKey(currentDate), [currentDate]);

  const fetchAll = useCallback(async () => {
    if (!isLoaded) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const token = await getToken();
      if (!token) {
        setError('Calendar requires an active session.');
        return;
      }

      const api = getPublicApiBase();
      const headers = { Authorization: `Bearer ${token}` };

      const [eventsRes, todayRes, upcomingRes, renewalsRes] = await Promise.all([
        fetch(`${api}/api/v1/calendar/events?month=${month}`, { headers }),
        fetch(`${api}/api/v1/calendar/events/today`, { headers }),
        fetch(`${api}/api/v1/calendar/upcoming?days=7`, { headers }),
        fetch(`${api}/api/v1/calendar/renewals?days=90`, { headers }),
      ]);

      if (!eventsRes.ok || !todayRes.ok || !upcomingRes.ok || !renewalsRes.ok) {
        throw new Error('Calendar request failed.');
      }

      const [eventsData, todayData, upcomingData, renewalsData] = (await Promise.all([
        eventsRes.json(),
        todayRes.json(),
        upcomingRes.json(),
        renewalsRes.json(),
      ])) as [EventsResponse, EventsResponse, EventsResponse, RenewalsResponse];

      setEvents(eventsData.events ?? []);
      setTodayEvents(todayData.events ?? []);
      setUpcomingEvents(upcomingData.events ?? []);
      setRenewals(renewalsData.renewals ?? []);
    } catch (fetchError) {
      console.error('[Calendar] Fetch error:', fetchError);
      setError('Unable to load calendar data.');
      setEvents([]);
      setTodayEvents([]);
      setUpcomingEvents([]);
      setRenewals([]);
    } finally {
      setIsLoading(false);
    }
  }, [getToken, isLoaded, month]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const highPriorityCount = events.filter((event) => event.priority === 'high').length;
  const deadlineCount = upcomingEvents.filter((event) =>
    ['filing_deadline', 'signature_deadline', 'contract_renewal'].includes(event.event_type),
  ).length;

  const stats = [
    { label: 'Upcoming Events', value: events.length, sub: 'This month' },
    {
      label: 'Deadlines This Week',
      value: deadlineCount,
      sub: highPriorityCount > 0 ? `${highPriorityCount} high priority` : 'All clear',
    },
    {
      label: 'High Priority',
      value: highPriorityCount,
      sub: 'Require attention',
      urgent: true,
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-surface-border px-8 py-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Schedule Hub</h1>
            <p className="mt-1 text-sm text-text-muted">
              Contract deadlines, hearings, renewals, and internal meetings
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedDate(new Date());
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-[#3A3A3A] bg-[#1C1C1C] px-4 py-2 text-sm text-primary transition-colors hover:bg-[#222222] hover:text-[#D4D4D4]"
          >
            <span className="text-base leading-none">+</span>
            Tambah Event
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {stats.map(({ label, value, sub, urgent }) => (
            <div
              key={label}
              className="flex items-center gap-4 rounded-xl border border-surface-border bg-surface px-5 py-4"
            >
              <div
                className={`text-3xl font-light ${
                  urgent && value > 0 ? 'text-red-400' : 'text-white'
                }`}
              >
                {value}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  {label}
                </div>
                <div
                  className={`mt-0.5 text-xs ${
                    urgent && value > 0 ? 'text-red-400' : 'text-text-muted'
                  }`}
                >
                  {sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="flex min-h-full flex-col gap-6">
          <CalendarHeader
            currentDate={currentDate}
            onPrev={() => setCurrentDate((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
            onNext={() => setCurrentDate((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
            onToday={() => setCurrentDate(new Date())}
          />

          {error && (
            <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <CalendarGrid
            currentDate={currentDate}
            events={events}
            isLoading={isLoading}
            onDateClick={(date) => {
              setSelectedDate(date);
              setShowAddModal(true);
            }}
          />

          <div className="grid gap-4 xl:grid-cols-3">
            <TodaySchedule events={todayEvents} />
            <UpcomingAgenda events={upcomingEvents} />
            <UpcomingRenewals renewals={renewals} />
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddEventModal
          defaultDate={selectedDate}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            void fetchAll();
          }}
        />
      )}
    </div>
  );
}
