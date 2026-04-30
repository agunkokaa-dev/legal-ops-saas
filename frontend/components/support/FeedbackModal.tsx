'use client';

import type { ElementType, FormEvent } from 'react';
import { useState } from 'react';
import { Bug, CheckCircle2, Lightbulb, MessageSquare, X } from 'lucide-react';

type FeedbackType = 'bug' | 'feature' | 'general';
type Severity = 'blocking' | 'annoying' | 'minor';
type Status = 'idle' | 'loading' | 'success' | 'error';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath?: string;
}

interface FeedbackTypeOption {
  value: FeedbackType;
  label: string;
  Icon: ElementType<{ size?: number; className?: string }>;
}

interface SeverityOption {
  value: Severity;
  label: string;
  className: string;
}

const FORMSPREE_FEEDBACK_ID = 'FORMSPREE_FEEDBACK_ID';
const DESCRIPTION_LIMIT = 500;

const feedbackTypeOptions: FeedbackTypeOption[] = [
  { value: 'bug', label: 'Bug', Icon: Bug },
  { value: 'feature', label: 'Fitur Baru', Icon: Lightbulb },
  { value: 'general', label: 'Lainnya', Icon: MessageSquare },
];

const severityOptions: SeverityOption[] = [
  { value: 'blocking', label: 'Blocking', className: 'bg-red-400' },
  { value: 'annoying', label: 'Mengganggu', className: 'bg-yellow-400' },
  { value: 'minor', label: 'Minor', className: 'bg-emerald-400' },
];

export function FeedbackModal({ isOpen, onClose, currentPath = '' }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [severity, setSeverity] = useState<Severity>('annoying');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const handleClose = () => {
    if (status === 'loading') {
      return;
    }

    setType('bug');
    setSeverity('annoying');
    setDescription('');
    setEmail('');
    setStatus('idle');
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedDescription = description.trim();

    if (!trimmedDescription || trimmedDescription.length > DESCRIPTION_LIMIT) {
      return;
    }

    setStatus('loading');

    try {
      const response = await fetch(`https://formspree.io/f/${FORMSPREE_FEEDBACK_ID}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          severity: type === 'bug' ? severity : undefined,
          description: trimmedDescription,
          email,
          page: currentPath,
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          _subject: `[clause.id ${type.toUpperCase()}] ${trimmedDescription.slice(0, 60)}`,
        }),
      });

      setStatus(response.ok ? 'success' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (!isOpen) {
    return null;
  }

  const isDescriptionInvalid = !description.trim() || description.length > DESCRIPTION_LIMIT;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-end p-4 sm:p-6">
      <button
        type="button"
        aria-label="Tutup feedback"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        className="support-modal-in relative w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 id="feedback-modal-title" className="text-sm font-semibold text-white">
              Kirim Feedback
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">Bantu kami tingkatkan clause.id</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Tutup modal feedback"
          >
            <X size={14} />
          </button>
        </div>

        {status === 'success' ? (
          <div className="px-5 py-8 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-zinc-700 bg-zinc-800">
              <CheckCircle2 size={22} className="text-emerald-300" />
            </div>
            <h4 className="mb-2 text-sm font-medium text-white">Terima kasih!</h4>
            <p className="text-xs leading-5 text-zinc-500">
              Feedback Anda sudah kami terima dan akan ditinjau segera.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-5 w-full rounded-xl border border-zinc-700 py-2.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
              Tutup
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
            <div>
              <label className="mb-2 block text-xs text-zinc-500">Jenis Feedback</label>
              <div className="grid grid-cols-3 gap-2">
                {feedbackTypeOptions.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setType(value);
                      setStatus('idle');
                    }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs transition-colors ${
                      type === value
                        ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                        : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700'
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {type === 'bug' && (
              <div>
                <label className="mb-2 block text-xs text-zinc-500">Seberapa parah?</label>
                <div className="grid grid-cols-3 gap-2">
                  {severityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSeverity(option.value);
                        setStatus('idle');
                      }}
                      className={`rounded-xl border px-2 py-2 text-[11px] transition-colors ${
                        severity === option.value
                          ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                          : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${option.className}`} />
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="feedback-description" className="mb-2 block text-xs text-zinc-500">
                {type === 'bug'
                  ? 'Apa yang terjadi? Langkah untuk reproduce?'
                  : type === 'feature'
                    ? 'Fitur apa yang Anda inginkan?'
                    : 'Ceritakan feedback Anda'}
              </label>
              <textarea
                id="feedback-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (status === 'error') {
                    setStatus('idle');
                  }
                }}
                rows={4}
                maxLength={DESCRIPTION_LIMIT}
                placeholder={
                  type === 'bug'
                    ? 'Contoh: Saat klik tombol X di halaman Y, muncul error...'
                    : type === 'feature'
                      ? 'Contoh: Saya ingin bisa export findings ke PDF...'
                      : 'Tulis feedback Anda di sini...'
                }
                className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-xs leading-relaxed text-white transition-colors placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <div className="mt-1 flex justify-end">
                <span
                  className={`text-[10px] ${
                    description.length >= DESCRIPTION_LIMIT ? 'text-amber-400' : 'text-zinc-600'
                  }`}
                >
                  {description.length}/{DESCRIPTION_LIMIT}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="feedback-email" className="mb-2 block text-xs text-zinc-500">
                Email (opsional - untuk follow-up)
              </label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="email@perusahaan.com"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-xs text-white transition-colors placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </div>

            {currentPath && (
              <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
                <span className="truncate">Halaman: {currentPath}</span>
              </div>
            )}

            {status === 'error' && (
              <p className="text-center text-[11px] text-red-400" role="status">
                Gagal mengirim. Coba lagi atau hubungi via WhatsApp.
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'loading' || isDescriptionInvalid}
              className="w-full rounded-xl bg-zinc-100 py-2.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === 'loading' ? 'Mengirim...' : 'Kirim Feedback'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
