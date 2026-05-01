'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import { Icon } from './ui/Icon';

interface TrialFormData {
  name: string;
  company: string;
  email: string;
  whatsapp: string;
  role: string;
}

const INITIAL_FORM: TrialFormData = {
  name: '',
  company: '',
  email: '',
  whatsapp: '',
  role: '',
};

const FORMSPREE_TRIAL_ENDPOINT = 'https://formspree.io/f/FORMSPREE_TRIAL_ID';

export function TrialRequestForm() {
  const [form, setForm] = useState<TrialFormData>(INITIAL_FORM);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));

    if (status === 'error') {
      setStatus('idle');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.name || !form.email || !form.company) {
      return;
    }

    setStatus('loading');

    try {
      const response = await fetch(FORMSPREE_TRIAL_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...form,
          _replyto: form.email,
          _subject: `[clause.id] Trial Request: ${form.company}`,
          type: 'TRIAL_REQUEST',
          note: 'PERLU APPROVAL FOUNDER - jangan auto-provision',
        }),
      });

      if (!response.ok) {
        setStatus('error');
        return;
      }

      setStatus('success');
      setForm(INITIAL_FORM);
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/5">
          <Icon name="check" className="text-[24px] text-white/60" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-white">Permintaan diterima</h3>
        <p className="text-sm leading-6 text-white/50">
          Tim kami akan mereview dan mengirimkan undangan akses trial ke email
          Anda dalam 1x24 jam kerja.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 backdrop-blur md:p-8"
    >
      <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <Icon name="info" className="mt-0.5 text-[18px] text-white/40" />
        <p className="text-xs leading-5 text-white/50">
          Trial gratis 14 hari. Akses dikirimkan setelah verifikasi singkat
          oleh tim kami, biasanya dalam 1x24 jam.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="trial-name" className="mb-2 block text-xs text-white/50">
            Nama Lengkap *
          </label>
          <input
            id="trial-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Nama Anda"
            autoComplete="name"
            required
            suppressHydrationWarning
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="trial-company" className="mb-2 block text-xs text-white/50">
            Perusahaan / Firm *
          </label>
          <input
            id="trial-company"
            name="company"
            value={form.company}
            onChange={handleChange}
            placeholder="Nama perusahaan"
            autoComplete="organization"
            required
            suppressHydrationWarning
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="trial-email" className="mb-2 block text-xs text-white/50">
            Email *
          </label>
          <input
            id="trial-email"
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            placeholder="email@perusahaan.com"
            autoComplete="email"
            required
            suppressHydrationWarning
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="trial-whatsapp" className="mb-2 block text-xs text-white/50">
            Nomor WhatsApp
          </label>
          <input
            id="trial-whatsapp"
            name="whatsapp"
            value={form.whatsapp}
            onChange={handleChange}
            placeholder="+62 812 xxxx xxxx"
            autoComplete="tel"
            suppressHydrationWarning
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="trial-role" className="mb-2 block text-xs text-white/50">
          Role
        </label>
        <select
          id="trial-role"
          name="role"
          value={form.role}
          onChange={handleChange}
          suppressHydrationWarning
          className="w-full rounded-xl border border-white/10 bg-[#0d0f13] px-4 py-3 text-sm text-white/80 transition focus:border-white/30 focus:outline-none"
        >
          <option value="">Pilih role</option>
          <option value="in_house_counsel">In-house Counsel</option>
          <option value="associate">Associate / Junior Lawyer</option>
          <option value="partner">Partner / Senior Lawyer</option>
          <option value="legal_ops">Legal Ops / Compliance</option>
          <option value="founder">Founder / CEO</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={status === 'loading' || !form.name || !form.email || !form.company}
        suppressHydrationWarning
        className="w-full rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === 'loading' ? 'Mengirim...' : 'Minta Akses Trial'}
      </button>

      {status === 'error' && (
        <p className="text-center text-xs text-red-400" role="status">
          Gagal mengirim. Hubungi kami langsung di WhatsApp.
        </p>
      )}

      <p className="text-center text-xs text-white/30">
        14 hari gratis. Tidak perlu kartu kredit. Akses setelah verifikasi.
      </p>
    </form>
  );
}
