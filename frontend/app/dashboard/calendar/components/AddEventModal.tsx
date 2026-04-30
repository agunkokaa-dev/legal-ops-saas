'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { X } from 'lucide-react';
import { getPublicApiBase } from '@/lib/public-api-base';
import { formatLocalDateKey } from '../dateUtils';

interface AddEventModalProps {
  defaultDate: Date | null;
  onClose: () => void;
  onCreated: () => void;
}

interface EventForm {
  title: string;
  event_type: string;
  event_date: string;
  event_time: string;
  priority: string;
  location: string;
  notes: string;
}

const EVENT_TYPES = [
  { value: 'hearing', label: 'Hearing' },
  { value: 'client_meeting', label: 'Client Meeting' },
  { value: 'board_meeting', label: 'Board Meeting' },
  { value: 'internal_review', label: 'Internal Review' },
  { value: 'compliance_review', label: 'Compliance Review' },
  { value: 'filing_deadline', label: 'Filing Deadline' },
  { value: 'signature_deadline', label: 'Signature Deadline' },
  { value: 'other', label: 'Other' },
];

function buildPayload(form: EventForm) {
  return {
    title: form.title.trim(),
    event_type: form.event_type,
    event_date: form.event_date,
    priority: form.priority,
    ...(form.event_time ? { event_time: form.event_time } : {}),
    ...(form.location.trim() ? { location: form.location.trim() } : {}),
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  };
}

export function AddEventModal({ defaultDate, onClose, onCreated }: AddEventModalProps) {
  const { getToken } = useAuth();
  const [form, setForm] = useState<EventForm>({
    title: '',
    event_type: 'client_meeting',
    event_date: defaultDate ? formatLocalDateKey(defaultDate) : formatLocalDateKey(new Date()),
    event_time: '',
    priority: 'normal',
    location: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (error) {
      setError('');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.title.trim() || !form.event_date) {
      setError('Judul dan tanggal wajib diisi.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const token = await getToken();
      if (!token) {
        setError('Session tidak aktif. Silakan refresh halaman.');
        return;
      }

      const response = await fetch(`${getPublicApiBase()}/api/v1/calendar/events/legal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildPayload(form)),
      });

      if (!response.ok) {
        setError('Gagal menyimpan event. Coba lagi.');
        return;
      }

      onCreated();
    } catch {
      setError('Network error. Coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-surface-border bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Tambah Event</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-text-muted transition-colors hover:text-white"
            aria-label="Close add event modal"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="calendar-event-title" className="mb-1.5 block text-xs text-text-muted">
              Judul *
            </label>
            <input
              id="calendar-event-title"
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="Nama event"
              className="w-full rounded-xl border border-surface-border bg-zinc-900/50 px-3 py-2.5 text-sm text-white placeholder:text-text-muted transition-colors focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="calendar-event-type" className="mb-1.5 block text-xs text-text-muted">
                Tipe Event
              </label>
              <select
                id="calendar-event-type"
                name="event_type"
                value={form.event_type}
                onChange={handleChange}
                className="w-full rounded-xl border border-surface-border bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none"
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="calendar-event-priority" className="mb-1.5 block text-xs text-text-muted">
                Prioritas
              </label>
              <select
                id="calendar-event-priority"
                name="priority"
                value={form.priority}
                onChange={handleChange}
                className="w-full rounded-xl border border-surface-border bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="calendar-event-date" className="mb-1.5 block text-xs text-text-muted">
                Tanggal *
              </label>
              <input
                id="calendar-event-date"
                type="date"
                name="event_date"
                value={form.event_date}
                onChange={handleChange}
                className="w-full rounded-xl border border-surface-border bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="calendar-event-time" className="mb-1.5 block text-xs text-text-muted">
                Waktu
              </label>
              <input
                id="calendar-event-time"
                type="time"
                name="event_time"
                value={form.event_time}
                onChange={handleChange}
                className="w-full rounded-xl border border-surface-border bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="calendar-event-location" className="mb-1.5 block text-xs text-text-muted">
              Lokasi
            </label>
            <input
              id="calendar-event-location"
              name="location"
              value={form.location}
              onChange={handleChange}
              placeholder="Courtroom 3 / Virtual / Kantor"
              className="w-full rounded-xl border border-surface-border bg-zinc-900/50 px-3 py-2.5 text-sm text-white placeholder:text-text-muted transition-colors focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="calendar-event-notes" className="mb-1.5 block text-xs text-text-muted">
              Notes
            </label>
            <textarea
              id="calendar-event-notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Detail tambahan"
              className="w-full resize-none rounded-xl border border-surface-border bg-zinc-900/50 px-3 py-2.5 text-sm text-white placeholder:text-text-muted transition-colors focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-surface-border py-2.5 text-sm text-text-muted transition-colors hover:text-white"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-[#D4D4D4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Menyimpan...' : 'Simpan Event'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
