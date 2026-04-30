'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import { Icon } from './ui/Icon';

interface DemoFormData {
  name: string;
  company: string;
  email: string;
  whatsapp: string;
  team_size: string;
  use_case: string;
}

const INITIAL_FORM: DemoFormData = {
  name: '',
  company: '',
  email: '',
  whatsapp: '',
  team_size: '',
  use_case: '',
};

const FORMSPREE_DEMO_ENDPOINT = 'https://formspree.io/f/FORMSPREE_DEMO_ID';

export function BookDemoForm() {
  const [form, setForm] = useState<DemoFormData>(INITIAL_FORM);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
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
      const response = await fetch(FORMSPREE_DEMO_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...form,
          _replyto: form.email,
          _subject: `[clause.id] Book Demo Request: ${form.company}`,
          type: 'BOOK_DEMO',
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
      <div className="rounded-[2rem] border border-emerald-400/20 bg-emerald-400/5 p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-400/10">
          <Icon name="check" className="text-[24px] text-emerald-300" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-white">Terima kasih!</h3>
        <p className="text-sm leading-6 text-white/60">
          Kami akan menghubungi Anda dalam 1x24 jam untuk menjadwalkan demo.
          Cek email dan WhatsApp Anda.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 backdrop-blur md:p-8"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="demo-name" className="mb-2 block text-xs text-white/50">
            Nama Lengkap *
          </label>
          <input
            id="demo-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Budi Santoso"
            autoComplete="name"
            required
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="demo-company" className="mb-2 block text-xs text-white/50">
            Perusahaan / Firm *
          </label>
          <input
            id="demo-company"
            name="company"
            value={form.company}
            onChange={handleChange}
            placeholder="PT Maju Bersama / Law Firm X"
            autoComplete="organization"
            required
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="demo-email" className="mb-2 block text-xs text-white/50">
            Email *
          </label>
          <input
            id="demo-email"
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            placeholder="budi@perusahaan.com"
            autoComplete="email"
            required
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="demo-whatsapp" className="mb-2 block text-xs text-white/50">
            Nomor WhatsApp
          </label>
          <input
            id="demo-whatsapp"
            name="whatsapp"
            value={form.whatsapp}
            onChange={handleChange}
            placeholder="+62 812 xxxx xxxx"
            autoComplete="tel"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 transition focus:border-white/30 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="demo-team-size" className="mb-2 block text-xs text-white/50">
            Ukuran Tim Legal
          </label>
          <select
            id="demo-team-size"
            name="team_size"
            value={form.team_size}
            onChange={handleChange}
            className="w-full rounded-xl border border-white/10 bg-[#0d0f13] px-4 py-3 text-sm text-white/80 transition focus:border-white/30 focus:outline-none"
          >
            <option value="">Pilih ukuran tim</option>
            <option value="1-2">1-2 orang (solo / startup)</option>
            <option value="3-10">3-10 orang (boutique firm)</option>
            <option value="11-50">11-50 orang (mid-size)</option>
            <option value="50+">50+ orang (enterprise)</option>
          </select>
        </div>
        <div>
          <label htmlFor="demo-use-case" className="mb-2 block text-xs text-white/50">
            Use Case Utama
          </label>
          <select
            id="demo-use-case"
            name="use_case"
            value={form.use_case}
            onChange={handleChange}
            className="w-full rounded-xl border border-white/10 bg-[#0d0f13] px-4 py-3 text-sm text-white/80 transition focus:border-white/30 focus:outline-none"
          >
            <option value="">Pilih use case</option>
            <option value="contract_review">Review kontrak rutin</option>
            <option value="negotiation">Negosiasi kontrak</option>
            <option value="compliance">Compliance & regulatory</option>
            <option value="obligation">Obligation tracking</option>
            <option value="all">Semua di atas</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={status === 'loading' || !form.name || !form.email || !form.company}
        className="w-full rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-[#08090b] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === 'loading' ? 'Mengirim...' : 'Jadwalkan Demo'}
      </button>

      {status === 'error' && (
        <p className="text-center text-xs text-red-400" role="status">
          Gagal mengirim. Hubungi kami langsung di WhatsApp.
        </p>
      )}

      <p className="text-center text-xs text-white/30">
        Kami akan menghubungi Anda dalam 1x24 jam. Tidak ada commitment.
      </p>
    </form>
  );
}
